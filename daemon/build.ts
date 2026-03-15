import { mkdirSync, cpSync, writeFileSync, readFileSync, existsSync, watch as fsWatch } from "fs";
import { join, dirname } from "path";
import { $ } from "bun";

const ROOT = dirname(import.meta.path);
const DIST = join(ROOT, "dist");

async function build() {
  console.log("Building canvas client...");

  mkdirSync(DIST, { recursive: true });

  const REACT_EXTERNALS = ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime"];

  // 0. Build preact-compat bundle
  console.log("  Building preact-compat...");
  const preactResult = await Bun.build({
    entrypoints: [join(ROOT, "client/compat/preact-all.ts")],
    outdir: DIST,
    format: "esm",
    naming: "preact-compat.js",
    minify: true,
  });

  if (!preactResult.success) {
    console.error("Preact-compat build failed:", preactResult.logs);
    process.exit(1);
  }

  // Write jsx-runtime shim
  writeFileSync(join(DIST, "jsx-runtime.js"),
    `import { jsx, jsxs, Fragment } from "./preact-compat.js";\nexport { jsx, jsxs, Fragment };\nexport const jsxDEV = jsx;\n`
  );

  // 1. Build runtime (shared context between app and components)
  console.log("  Building #canvas/runtime...");
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
  console.log("  Building #canvas/components...");
  const componentsResult = await Bun.build({
    entrypoints: [join(ROOT, "client/components/index.ts")],
    outdir: DIST,
    format: "esm",
    external: [...REACT_EXTERNALS, "#canvas/runtime"],
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
    external: [...REACT_EXTERNALS, "#canvas/components", "#canvas/runtime"],
    naming: "client.js",
    minify: true,
  });

  if (!clientResult.success) {
    console.error("Client build failed:", clientResult.logs);
    process.exit(1);
  }

  // 4. Build Tailwind CSS
  console.log("  Building CSS...");
  await $`cd ${ROOT} && npx @tailwindcss/cli -i client/styles.css -o dist/client.css --minify`.quiet();

  // 5. Read theme.css to inline into HTML for browser Tailwind runtime
  const themeCss = readFileSync(join(ROOT, "client/theme.css"), "utf-8");

  // 6. Create index.html
  console.log("  Creating index.html...");

  const indexHtml = `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Agent Canvas</title>
  <script>!function(){var p=localStorage.getItem('canvas-theme')||'auto';document.documentElement.dataset.theme=p==='auto'?(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light'):p}()</script>
  <link rel="stylesheet" href="/assets/client.css" />
  <link rel="stylesheet" href="https://unpkg.com/@highlightjs/cdn-assets@11.11.1/styles/github-dark-dimmed.min.css" />
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
  <style type="text/tailwindcss">
${themeCss}
  </style>
</head>
<body class="min-h-screen">
  <div id="root"></div>
  <script src="https://unpkg.com/@highlightjs/cdn-assets@11.11.1/highlight.min.js"></script>
  <script src="https://unpkg.com/mermaid@11.4.1/dist/mermaid.min.js"></script>
  <script>mermaid.initialize({ startOnLoad: false, theme: document.documentElement.dataset.theme === 'light' ? 'default' : 'dark' });</script>
  <script type="importmap">
  {
    "imports": {
      "react": "/assets/preact-compat.js",
      "react-dom": "/assets/preact-compat.js",
      "react-dom/client": "/assets/preact-compat.js",
      "react/jsx-runtime": "/assets/jsx-runtime.js",
      "react/jsx-dev-runtime": "/assets/jsx-runtime.js",
      "#canvas/components": "/assets/components.js",
      "#canvas/runtime": "/assets/runtime.js"
    }
  }
  </script>
  <script type="module" src="/assets/client.js"></script>
</body>
</html>`;

  writeFileSync(join(DIST, "index.html"), indexHtml);

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
