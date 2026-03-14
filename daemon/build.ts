import { mkdirSync, cpSync, writeFileSync, existsSync, watch as fsWatch } from "fs";
import { join, dirname } from "path";
import { $ } from "bun";

const ROOT = dirname(import.meta.path);
const DIST = join(ROOT, "dist");

async function build() {
  console.log("Building planner client...");

  mkdirSync(DIST, { recursive: true });

  const REACT_EXTERNALS = ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime"];

  // 1. Build runtime (shared context between app and components)
  console.log("  Building @canvas/runtime...");
  const runtimeResult = await Bun.build({
    entrypoints: [join(ROOT, "client/runtime.ts")],
    outdir: DIST,
    format: "esm",
    external: [...REACT_EXTERNALS],
    naming: "runtime.js",
    minify: true,
  });

  if (!runtimeResult.success) {
    console.error("Runtime build failed:", runtimeResult.logs);
    process.exit(1);
  }

  // 2. Build the components library (ESM, React + runtime external)
  console.log("  Building @canvas/components...");
  const componentsResult = await Bun.build({
    entrypoints: [join(ROOT, "client/components/index.ts")],
    outdir: DIST,
    format: "esm",
    external: [...REACT_EXTERNALS, "@canvas/runtime"],
    naming: "components.js",
    minify: true,
  });

  if (!componentsResult.success) {
    console.error("Components build failed:", componentsResult.logs);
    process.exit(1);
  }

  // 3. Build the main client app (ESM, React + components + runtime external)
  console.log("  Building client app...");
  const clientResult = await Bun.build({
    entrypoints: [join(ROOT, "client/App.tsx")],
    outdir: DIST,
    format: "esm",
    external: [...REACT_EXTERNALS, "@canvas/components", "@canvas/runtime"],
    naming: "client.js",
    minify: true,
  });

  if (!clientResult.success) {
    console.error("Client build failed:", clientResult.logs);
    process.exit(1);
  }

  // 4. Build Tailwind CSS
  console.log("  Building CSS...");
  await $`cd ${ROOT} && npx tailwindcss -i client/styles.css -o dist/client.css --minify`.quiet();

  // 5. Create React shims for import maps
  // These re-export from the global React loaded via UMD
  console.log("  Creating React shims...");

  // Write the index.html to use CDN React
  const indexHtml = `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Planner</title>
  <script>document.documentElement.dataset.theme = localStorage.getItem('planner-theme') || 'dark';</script>
  <link rel="stylesheet" href="/assets/client.css" />
  <link rel="stylesheet" href="https://unpkg.com/@highlightjs/cdn-assets@11.11.1/styles/github-dark-dimmed.min.css" />
</head>
<body class="min-h-screen">
  <div id="root"></div>
  <script src="https://unpkg.com/@highlightjs/cdn-assets@11.11.1/highlight.min.js"></script>
  <script src="https://unpkg.com/mermaid@11.4.1/dist/mermaid.min.js"></script>
  <script>mermaid.initialize({ startOnLoad: false, theme: document.documentElement.dataset.theme === 'light' ? 'default' : 'dark' });</script>
  <script src="https://unpkg.com/react@18.3.1/umd/react.production.min.js"></script>
  <script src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js"></script>
  <script>
    // Create ESM modules from UMD globals
    window.__REACT_ESM__ = Object.keys(React).reduce((m, k) => { m[k] = React[k]; return m; }, { default: React, __esModule: true });
    window.__REACT_DOM_ESM__ = Object.keys(ReactDOM).reduce((m, k) => { m[k] = ReactDOM[k]; return m; }, { default: ReactDOM, __esModule: true });
  </script>
  <script type="importmap">
  {
    "imports": {
      "react": "/assets/react-shim.js",
      "react-dom": "/assets/react-dom-shim.js",
      "react-dom/client": "/assets/react-dom-client-shim.js",
      "react/jsx-runtime": "/assets/jsx-runtime-shim.js",
      "react/jsx-dev-runtime": "/assets/jsx-dev-runtime-shim.js",
      "@canvas/components": "/assets/components.js",
      "@canvas/runtime": "/assets/runtime.js"
    }
  }
  </script>
  <script type="module" src="/assets/client.js"></script>
</body>
</html>`;

  writeFileSync(join(DIST, "index.html"), indexHtml);

  // React ESM shims
  writeFileSync(join(DIST, "react-shim.js"), `
const R = window.React;
export default R;
export const { useState, useEffect, useRef, useCallback, useContext, useMemo, useReducer, createContext, createElement, Fragment, Children, cloneElement, isValidElement, memo, forwardRef, lazy, Suspense, startTransition, useTransition, useDeferredValue, useId, useSyncExternalStore, useInsertionEffect, useImperativeHandle, useLayoutEffect, useDebugValue, Component, PureComponent } = R;
`);

  writeFileSync(join(DIST, "react-dom-shim.js"), `
const RD = window.ReactDOM;
export default RD;
export const { createPortal, flushSync, hydrate, render, unmountComponentAtNode, findDOMNode, unstable_batchedUpdates } = RD;
`);

  writeFileSync(join(DIST, "react-dom-client-shim.js"), `
const RD = window.ReactDOM;
export const { createRoot, hydrateRoot } = RD;
export default { createRoot: RD.createRoot, hydrateRoot: RD.hydrateRoot };
`);

  // jsxDEV signature: (type, props, key, isStaticChildren, source, self)
  // jsx/jsxs signature: (type, props, key)
  // createElement signature: (type, props, ...children)
  // We need to adapt: extract children from props and pass to createElement
  const jsxShimCode = `
const R = window.React;
export const Fragment = R.Fragment;
function _jsx(type, props, key) {
  if (props && 'children' in props) {
    const { children, ...rest } = props;
    if (key !== undefined && key !== null) rest.key = key;
    return Array.isArray(children)
      ? R.createElement(type, rest, ...children)
      : R.createElement(type, rest, children);
  }
  if (key !== undefined && key !== null) props = { ...props, key };
  return R.createElement(type, props);
}
export const jsx = _jsx;
export const jsxs = _jsx;
export function jsxDEV(type, props, key) { return _jsx(type, props, key); }
`;

  writeFileSync(join(DIST, "jsx-runtime-shim.js"), jsxShimCode);
  writeFileSync(join(DIST, "jsx-dev-runtime-shim.js"), jsxShimCode);

  console.log("Build complete! Output in dist/");
}

build().then(() => {
  if (process.argv.includes("--watch")) {
    const clientDir = join(ROOT, "client");
    let timeout: ReturnType<typeof setTimeout> | null = null;
    console.log("Watching for changes in client/...");
    fsWatch(clientDir, { recursive: true }, (_event: string, filename: string | null) => {
      if (!filename || filename.endsWith("~")) return;
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        console.log(`\n  Changed: ${filename}`);
        build().catch((e) => console.error("Rebuild failed:", e));
      }, 200);
    });
  }
}).catch((e) => {
  console.error("Build failed:", e);
  process.exit(1);
});
