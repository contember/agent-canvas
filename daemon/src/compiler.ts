import { writeFileSync, unlinkSync, readFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { h, Fragment, type ComponentChildren } from "preact";
import renderToString from "preact-render-to-string";
import { parse as parseMermaid } from "mermaid-parser-bundle";
import { COMPILE_TEMP_DIR } from "./paths";

type CompileResult =
  | { ok: true; js: string }
  | { ok: false; error: string };

const COMPONENT_IMPORTS = `import React from 'react';
import * as C from '#canvas/components';
const { Section, Item, Task, FilePreview, CodeBlock, Callout,
        Mermaid, Table, Priority, Checklist, Note, Diff,
        Choice, MultiChoice, UserInput, RangeInput, SecretInput, ImageView,
        Markdown, useFeedback, useAnnotations } = C;
`;

/** Number of lines in COMPONENT_IMPORTS — used to adjust error line numbers */
const COMPONENT_IMPORTS_LINES = COMPONENT_IMPORTS.split("\n").length - 1;

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

interface StubProps {
  children?: ComponentChildren;
  [key: string]: unknown;
}

/** Passthrough component — just renders its children */
const Stub = ({ children }: StubProps) => h(Fragment, null, children);

type RequiredPropKind = "array" | "string";

function validatingStub(component: string, requiredProps: Record<string, RequiredPropKind>) {
  return (props: StubProps) => {
    for (const [prop, kind] of Object.entries(requiredProps)) {
      const value = props[prop];
      const valid = kind === "array" ? Array.isArray(value) : typeof value === kind;
      if (!valid) {
        throw new Error(`${component}: required prop \`${prop}\` must be ${kind === "array" ? "an array" : `a ${kind}`}`);
      }
    }
    return h(Fragment, null, props.children);
  };
}

const STUB_COMPONENTS: Record<string, any> = {};
for (const name of [
  "CodeBlock", "Callout", "Note", "Markdown",
]) {
  STUB_COMPONENTS[name] = Stub;
}
Object.assign(STUB_COMPONENTS, {
  Section: validatingStub("Section", { title: "string" }),
  Item: validatingStub("Item", { id: "string", label: "string" }),
  Task: validatingStub("Task", { id: "string", label: "string" }),
  FilePreview: validatingStub("FilePreview", { path: "string" }),
  Table: validatingStub("Table", { headers: "array", rows: "array" }),
  Priority: validatingStub("Priority", { level: "string" }),
  Checklist: validatingStub("Checklist", { items: "array" }),
  Diff: validatingStub("Diff", { before: "string", after: "string" }),
  Choice: validatingStub("Choice", { id: "string", label: "string", options: "array" }),
  MultiChoice: validatingStub("MultiChoice", { id: "string", label: "string", options: "array" }),
  UserInput: validatingStub("UserInput", { id: "string", label: "string" }),
  RangeInput: validatingStub("RangeInput", { id: "string", label: "string" }),
  SecretInput: validatingStub("SecretInput", { id: "string", label: "string", env: "string" }),
  ImageView: validatingStub("ImageView", { src: "string" }),
});
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
      await parseMermaid(source);
    } catch (e: any) {
      const msg = (e?.message || "Invalid diagram").split("\n")[0];
      return { ok: false, error: `Mermaid syntax error: ${msg}` };
    }
  }

  return { ok: true };
}

/**
 * Normalize a Bun build/transpile failure into a precise, actionable string.
 *
 * Bun surfaces JSX syntax errors through three different shapes, all handled
 * here so the CLI never again prints a bare "Parse error" / "Bundle failed":
 *   - `Bun.Transpiler.transformSync` throws a `BuildMessage` (has `.position`).
 *   - `Bun.build()` returns `{ success: false, logs: [BuildMessage] }`.
 *   - `Bun.build()` throws an `AggregateError` whose `.errors[0]` is a
 *     `BuildMessage` — the case the old catch discarded, returning only the
 *     useless top-level "Bundle failed".
 *
 * `lineOffset` is the number of lines Canvas prepended (component imports +
 * wrapper) so the reported line maps back to the user's authored file. When a
 * position is available we append `(line N, col M)` plus a one-line code frame
 * with a caret — that suffix is also what lets the CLI classify the error as a
 * user error and skip a pointless daemon restart (see push.ts).
 */
function formatBuildError(err: any, lineOffset: number): string {
  // Collect every candidate that might carry a `.position`, most specific first.
  const candidates: any[] = [];
  if (err?.position) candidates.push(err);
  if (Array.isArray(err?.errors)) candidates.push(...err.errors);
  if (!candidates.length && err && typeof err[Symbol.iterator] === "function") {
    try { candidates.push(...err); } catch {}
  }
  const detail = candidates.find((c) => c?.position) ?? candidates[0] ?? err;
  const message = String(detail?.message || err?.message || "Syntax error").split("\n")[0];

  const pos = detail?.position;
  if (!pos || typeof pos.line !== "number") return message;

  const loc = ` (line ${pos.line - lineOffset}, col ${pos.column})`;
  let frame = "";
  if (typeof pos.lineText === "string") {
    const caret = " ".repeat(Math.max(0, pos.column ?? 0)) + "^";
    frame = `\n  ${pos.lineText}\n  ${caret}`;
  }
  return `${message}${loc}${frame}`;
}

export async function compilePlan(jsx: string, projectRoot?: string): Promise<CompileResult> {
  // Strip leading pragma / block / line comments (e.g. `/** @jsxImportSource ... */`).
  // Authored JSX sometimes carries a JSX-runtime pragma from another toolchain;
  // Canvas injects its own imports and uses the React automatic runtime, so the
  // pragma is unused. Left in place it sits at the top level of the wrapped
  // fragment as plain text (JSX only treats `{/* */}` as a comment) and renders
  // literally on the page.
  let stripped: string;
  do {
    stripped = jsx;
    jsx = jsx.replace(/^\s*(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*)\s*/, "");
  } while (jsx !== stripped);

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

  // Offset: COMPONENT_IMPORTS lines + wrapper lines (export default function
  // Plan() + return). Used to map Bun's line numbers back to the authored file.
  const wrapperLines = hasDefaultExport ? 1 : 2;
  const lineOffset = COMPONENT_IMPORTS_LINES + wrapperLines;

  // Pre-validate syntax with Bun.Transpiler — gives precise error positions,
  // unlike Bun.build() which throws opaque "Bundle failed" for syntax errors.
  try {
    const transpiler = new Bun.Transpiler({ loader: "jsx" });
    transpiler.transformSync(source);
  } catch (syntaxError: any) {
    return { ok: false, error: formatBuildError(syntaxError, lineOffset) };
  }

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
        const errorLogs = result.logs.filter((l) => l.level === "error");
        const errors = errorLogs
          .map((l) => formatBuildError(l, lineOffset))
          .join("\n");
        return { ok: false, error: errors || "Bundle failed" };
      }

      const js = await result.outputs[0].text();
      const validation = await validateCompiledPlan(js);
      if (!validation.ok) {
        return { ok: false, error: `Runtime error: ${validation.error}` };
      }
      return { ok: true, js };
    } catch (buildError: any) {
      // A real syntax error surfaces as an AggregateError carrying BuildMessages
      // (with positions) — format it precisely. The opaque "Unknown Error, TODO"
      // corruption case (internal bundler state gets corrupted in long-running
      // processes) has no sub-errors; pass it through so the CLI restarts the
      // daemon and retries.
      const hasDetail =
        buildError?.position ||
        (Array.isArray(buildError?.errors) && buildError.errors.length > 0);
      if (hasDetail) {
        return { ok: false, error: formatBuildError(buildError, lineOffset) };
      }
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
