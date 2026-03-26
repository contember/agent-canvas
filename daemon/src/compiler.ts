import { writeFileSync, unlinkSync, readFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { h, Fragment } from "preact";
import renderToString from "preact-render-to-string";
import mermaid from "mermaid";
import { COMPILE_TEMP_DIR } from "./paths";

mermaid.initialize({ startOnLoad: false });

type CompileResult =
  | { ok: true; js: string }
  | { ok: false; error: string };

const COMPONENT_IMPORTS = `import React from 'react';
import * as C from '#canvas/components';
const { Section, Item, Task, FilePreview, CodeBlock, Callout,
        Mermaid, Table, Priority, Checklist, Note, Diff,
        Choice, MultiChoice, UserInput, RangeInput, ImageView,
        Markdown, useFeedback, useAnnotations } = C;
`;

// --- Validation via Preact --------------------------------------------------
// After Bun.build() succeeds we strip ESM syntax from the compiled output,
// provide Preact as the React implementation with lightweight stub components,
// and actually render the component tree.  Any runtime error (undefined vars,
// broken template literals, …) is caught and reported back to the CLI.

/** jsxDEV(type, props, key, isStaticChildren, source, self) → VNode */
function mockJsxDEV(type: any, props: any, key?: any) {
  const { children, ...rest } = props || {};
  return h(type, { ...rest, key }, children);
}

/** Passthrough component — just renders its children */
const Stub = ({ children }: any) => h(Fragment, null, children);

const STUB_COMPONENTS: Record<string, any> = {};
for (const name of [
  "Section", "Item", "Task", "FilePreview", "CodeBlock", "Callout",
  "Table", "Priority", "Checklist", "Note", "Diff",
  "Choice", "MultiChoice", "UserInput", "RangeInput", "ImageView", "Markdown",
]) {
  STUB_COMPONENTS[name] = Stub;
}
// Mermaid stub collects diagram sources for post-render validation
let collectedMermaidSources: string[] = [];
STUB_COMPONENTS.Mermaid = ({ children }: any) => {
  const source = typeof children === "string" ? children : String(children ?? "");
  if (source.trim()) collectedMermaidSources.push(source.trim());
  return null;
};
// Hook stubs — return shapes that won't blow up when destructured
STUB_COMPONENTS.useFeedback = () => ({ submit: () => {}, value: null });
STUB_COMPONENTS.useAnnotations = () => ({ annotations: [], addAnnotation: () => {} });

const MOCK_REACT = {
  createElement: h,
  Fragment,
  useState: (init: any) => [init, () => {}],
  useEffect: () => {},
  useRef: (init: any) => ({ current: init }),
  useMemo: (fn: any) => fn(),
  useCallback: (fn: any) => fn,
  useReducer: (r: any, init: any) => [init, () => {}],
  useContext: () => ({}),
  createContext: () => ({ Provider: Stub, Consumer: Stub }),
  useLayoutEffect: () => {},
  useImperativeHandle: () => {},
  useDebugValue: () => {},
  useDeferredValue: (v: any) => v,
  useTransition: () => [false, (fn: any) => fn()],
  useId: () => "mock",
  useSyncExternalStore: (sub: any, get: any) => get(),
  memo: (c: any) => c,
  forwardRef: (c: any) => c,
  lazy: (c: any) => c,
  Children: { map: (c: any, fn: any) => (Array.isArray(c) ? c : [c]).map(fn), toArray: (c: any) => (Array.isArray(c) ? c : [c]) },
  isValidElement: () => true,
  cloneElement: h,
  Suspense: Stub,
  StrictMode: Stub,
};

async function validateCompiledPlan(js: string): Promise<{ ok: true } | { ok: false; error: string }> {
  let code = js;

  // Strip ESM import statements
  code = code.replace(/import\s+\w+\s+from\s+"[^"]+";?/g, "");
  code = code.replace(/import\s+\*\s+as\s+\w+\s+from\s+"[^"]+";?/g, "");
  code = code.replace(/import\s*\{[^}]*\}\s*from\s+"[^"]+";?/g, "");

  // Strip export, extract default name
  let defaultName: string | null = null;
  code = code.replace(/export\s*\{\s*(\w+)\s+as\s+default\s*\};?/g, (_, name) => {
    defaultName = name;
    return "";
  });
  if (!defaultName) {
    code = code.replace(/export\s+default\s+(\w+);?/g, (_, name) => {
      defaultName = name;
      return "";
    });
  }

  const callDefault = defaultName
    ? `\nreturn typeof ${defaultName} === "function" ? ${defaultName}() : null;`
    : "\nreturn null;";

  try {
    collectedMermaidSources = [];
    const fn = new Function("React", "C", "jsxDEV", "jsx", "Fragment", code + callDefault);
    const vnode = fn(MOCK_REACT, STUB_COMPONENTS, mockJsxDEV, mockJsxDEV, Fragment);
    if (vnode) renderToString(vnode);
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }

  // Validate collected Mermaid diagram sources
  for (const source of collectedMermaidSources) {
    try {
      await mermaid.parse(source);
    } catch (e: any) {
      return { ok: false, error: `Mermaid syntax error: ${e?.message || String(e)}` };
    }
  }

  return { ok: true };
}

export async function compilePlan(jsx: string, projectRoot?: string): Promise<CompileResult> {
  // Resolve file contents at compile time
  if (projectRoot) {
    jsx = resolveFilePreviews(jsx, projectRoot);
    jsx = resolveMarkdownFiles(jsx, projectRoot);
  }

  // Strip template literals and strings so `export default` inside CodeBlock
  // content (e.g. {`export default defineConfig(...)`}) doesn't false-positive.
  const strippedJsx = jsx
    .replace(/\{`[^`]*`\}/gs, "")   // {`...`} template expressions
    .replace(/`[^`]*`/gs, "")        // standalone template literals
    .replace(/"[^"]*"/g, "")         // double-quoted strings
    .replace(/'[^']*'/g, "");        // single-quoted strings
  const hasDefaultExport = /export\s+default\b/.test(strippedJsx);

  const source = hasDefaultExport
    ? `${COMPONENT_IMPORTS}\n${jsx}`
    : `${COMPONENT_IMPORTS}\nexport default function Plan() {\n  return (<>${jsx}</>);\n}\n`;

  const tmpFile = join(COMPILE_TEMP_DIR, `plan-${randomUUID()}.jsx`);

  try {
    writeFileSync(tmpFile, source);

    try {
      const result = await Bun.build({
        entrypoints: [tmpFile],
        format: "esm",
        external: ["react", "react-dom", "#canvas/components", "#canvas/runtime"],
        jsx: { runtime: "automatic", importSource: "react" },
      });

      if (!result.success) {
        const errors = result.logs
          .filter((l) => l.level === "error")
          .map((l) => l.message)
          .join("\n");
        return { ok: false, error: errors || "Compilation failed" };
      }

      const js = await result.outputs[0].text();
      const validation = await validateCompiledPlan(js);
      if (!validation.ok) {
        return { ok: false, error: `Runtime error: ${validation.error}` };
      }
      return { ok: true, js };
    } catch (buildError: any) {
      // Bun.build() can throw "Unknown Error, TODO" in long-running processes
      // when its internal bundler state gets corrupted. Let the CLI handle restart.
      return { ok: false, error: buildError?.message || "Unknown Error" };
    }
  } catch (e: any) {
    return { ok: false, error: e.message };
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

/**
 * Find <Markdown file="..." /> tags and inject __content with the file contents
 * resolved at compile time.
 */
function resolveMarkdownFiles(jsx: string, projectRoot: string): string {
  return jsx.replace(
    /<Markdown\b([^>]*?)\/>/g,
    (match, attrs: string) => {
      const fileMatch = attrs.match(/file=["']([^"']+)["']/);
      if (!fileMatch) return match;

      const filePath = fileMatch[1];
      const absPath = join(projectRoot, filePath);

      try {
        const content = readFileSync(absPath, "utf-8");
        const escaped = JSON.stringify(content);
        return `<Markdown${attrs} __content={${escaped}} />`;
      } catch {
        return match;
      }
    }
  );
}

/**
 * Find <FilePreview path="..." /> tags and inject __content with the file contents
 * resolved at compile time so the browser doesn't need to fetch.
 */
function resolveFilePreviews(jsx: string, projectRoot: string): string {
  // Match <FilePreview ... /> (self-closing)
  return jsx.replace(
    /<FilePreview\b([^>]*?)\/>/g,
    (match, attrs: string) => {
      const pathMatch = attrs.match(/path=["']([^"']+)["']/);
      if (!pathMatch) return match;

      const filePath = pathMatch[1];
      const absPath = join(projectRoot, filePath);

      try {
        let content = readFileSync(absPath, "utf-8");

        // Apply lines filter if present
        const linesMatch = attrs.match(/lines=\{?\[(\d+)\s*,\s*(\d+)\]\}?/);
        if (linesMatch) {
          const start = parseInt(linesMatch[1], 10);
          const end = parseInt(linesMatch[2], 10);
          content = content.split("\n").slice(start - 1, end).join("\n");
        }

        // Escape for embedding in JSX string
        const escaped = JSON.stringify(content);
        return `<FilePreview${attrs} __content={${escaped}} />`;
      } catch {
        return match;
      }
    }
  );
}
