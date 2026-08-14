import { writeFileSync, unlinkSync, readFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { h, Fragment, type ComponentChildren } from "preact";
import renderToString from "preact-render-to-string";
import { parse as parseMermaid } from "mermaid-parser-bundle";

export type CompileResult =
  | { ok: true; js: string }
  | { ok: false; error: string };

type RequiredPropKind = "array" | "string";

/**
 * One name the compiler makes available to authored JSX without an import.
 *
 * `requiredProps` is enforced during the render validation pass below, so a
 * canvas that forgets a prop fails at push time with a precise message instead
 * of rendering blank in the browser.
 */
export interface CanvasComponentSpec {
  requiredProps?: Record<string, RequiredPropKind>;
}

export type CanvasComponents = Record<string, CanvasComponentSpec>;

/**
 * The components every canvas host provides. Order is the order they appear in
 * the injected destructure, so keep it stable for readable generated code.
 */
export const KERNEL_COMPONENTS: CanvasComponents = {
  Section: { requiredProps: { title: "string" } },
  Item: { requiredProps: { id: "string", label: "string" } },
  Task: { requiredProps: { id: "string", label: "string" } },
  FilePreview: { requiredProps: { path: "string" } },
  CodeBlock: {},
  Callout: {},
  Mermaid: {},
  Table: { requiredProps: { headers: "array", rows: "array" } },
  Priority: { requiredProps: { level: "string" } },
  Checklist: { requiredProps: { items: "array" } },
  Note: {},
  Diff: { requiredProps: { before: "string", after: "string" } },
  Choice: { requiredProps: { id: "string", label: "string", options: "array" } },
  MultiChoice: { requiredProps: { id: "string", label: "string", options: "array" } },
  UserInput: { requiredProps: { id: "string", label: "string" } },
  RangeInput: { requiredProps: { id: "string", label: "string" } },
  ImageView: { requiredProps: { src: "string" } },
  Markdown: {},
  useFeedback: {},
  useAnnotations: {},
};

export interface CompileOptions {
  /** Resolves `<FilePreview>` / `<Markdown file>` references at compile time. */
  projectRoot?: string;
  /** Scratch dir for the temp `.jsx` handed to Bun.build. Created on demand. */
  tempDir?: string;
  /**
   * Host components to add on top of KERNEL_COMPONENTS, keyed by name. Each one
   * must also be exported from the host's `#canvas/components` barrel — that is
   * what the injected import actually reads at runtime. Re-declaring a kernel
   * name overrides its spec.
   */
  components?: CanvasComponents;
}

/** Fallback scratch dir for hosts that compile without wiring CanvasPaths. */
const FALLBACK_COMPILE_DIR = join(tmpdir(), "canvas-kernel", "compile");

function componentImports(components: CanvasComponents): string {
  return `import React from 'react';
import * as C from '#canvas/components';
const { ${Object.keys(components).join(", ")} } = C;
`;
}

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

// Mermaid stub collects diagram sources for post-render validation
let collectedMermaidSources: string[] = [];

/** Names whose stub does more than check props, so a manifest entry cannot
 *  describe them. Hooks return shapes that survive destructuring. */
const SPECIAL_STUBS: Record<string, any> = {
  Mermaid: ({ children }: any) => {
    const source = typeof children === "string" ? children : String(children ?? "");
    if (source.trim()) collectedMermaidSources.push(source.trim());
    return null;
  },
  useFeedback: () => ({ submit: () => {}, value: null }),
  useAnnotations: () => ({ annotations: [], addAnnotation: () => {} }),
};

function buildStubs(components: CanvasComponents): Record<string, any> {
  const stubs: Record<string, any> = {};
  for (const [name, spec] of Object.entries(components)) {
    const special = SPECIAL_STUBS[name];
    stubs[name] = special ?? (spec.requiredProps ? validatingStub(name, spec.requiredProps) : Stub);
  }
  return stubs;
}

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

async function validateCompiledPlan(js: string, stubs: Record<string, any>): Promise<{ ok: true } | { ok: false; error: string }> {
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
    const vnode = fn(MOCK_REACT, stubs, mockJsxDEV, mockJsxDEV, Fragment);
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

export async function compileJsx(jsx: string, options: CompileOptions = {}): Promise<CompileResult> {
  const { projectRoot } = options;
  const components = options.components ? { ...KERNEL_COMPONENTS, ...options.components } : KERNEL_COMPONENTS;
  const componentPreamble = componentImports(components);
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
    ? `${componentPreamble}\n${jsx}`
    : `${componentPreamble}\nexport default function Plan() {\n  return (<>${jsx}</>);\n}\n`;

  // Offset: injected import lines + wrapper lines (export default function
  // Plan() + return). Used to map Bun's line numbers back to the authored file.
  const wrapperLines = hasDefaultExport ? 1 : 2;
  const lineOffset = componentPreamble.split("\n").length - 1 + wrapperLines;

  // Pre-validate syntax with Bun.Transpiler — gives precise error positions,
  // unlike Bun.build() which throws opaque "Bundle failed" for syntax errors.
  try {
    const transpiler = new Bun.Transpiler({ loader: "jsx" });
    transpiler.transformSync(source);
  } catch (syntaxError: any) {
    return { ok: false, error: formatBuildError(syntaxError, lineOffset) };
  }

  const compileDir = options.tempDir ?? FALLBACK_COMPILE_DIR;
  mkdirSync(compileDir, { recursive: true });
  const tmpFile = join(compileDir, `plan-${randomUUID()}.jsx`);

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
      const validation = await validateCompiledPlan(js, buildStubs(components));
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

/** @deprecated Use `compileJsx(jsx, { projectRoot, tempDir })`. */
export async function compilePlan(jsx: string, projectRoot?: string): Promise<CompileResult> {
  return compileJsx(jsx, { projectRoot });
}
