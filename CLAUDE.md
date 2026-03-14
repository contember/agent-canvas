# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Agent Canvas — an interactive browser-based visual canvas for Claude Code. Users author JSX documents that get compiled and rendered in the browser with annotation, feedback, and file browsing capabilities.

## Architecture

Three components communicate via HTTP and WebSocket:

- **CLI** (`bin/agent-canvas.ts`) — pushes JSX canvases to the daemon, waits for user feedback, manages daemon lifecycle
- **Daemon** (`daemon/src/server.ts`) — Bun HTTP+WS server on port 19400 (`CANVAS_PORT`). Compiles JSX, manages sessions, serves the browser UI
- **Browser UI** (`daemon/client/`) — React 18 app loaded via CDN UMD with ESM import maps. Handles annotations, revision history, feedback collection, file browsing

**Data flow:** CLI pushes JSX → daemon compiles via `Bun.build()` → browser loads compiled JS module → user annotates/responds → feedback sent back to CLI via WebSocket

**Session model:** Each canvas push creates/updates a session identified by `CANVAS_SESSION_ID` (set by hook). Sessions are stored on disk at `~/.claude/agent-canvas/sessions/{id}/` with a revision system (`revisions/{rev}/plan.jsx`, `plan.compiled.js`, `feedback.md`).

## Build

```bash
bun install
bun run build              # builds client assets to daemon/dist/
bun daemon/build.ts --watch  # watch mode with debounced rebuild
```

The build produces three bundles (runtime.js, components.js, client.js) plus Tailwind CSS. React is loaded from CDN, not bundled. Import maps route `#canvas/components` and `#canvas/runtime` to the local bundles.

No test runner or linter is configured.

## Key Technical Details

- **Runtime is Bun only** — no Node.js compatibility needed
- **JSX compilation** uses temp files because `Bun.build()` doesn't support `stdin`. See `daemon/src/compiler.ts`
- **Component imports are injected** by the compiler — authored JSX can use `Section`, `Task`, `CodeBlock`, etc. without imports
- **Adding a new component:** create in `daemon/client/components/`, export from `index.ts`, add to `COMPONENT_IMPORTS` in `daemon/src/compiler.ts`, rebuild
- **Bun's `spawn` throws synchronously** on missing executables — always check with `which` before spawning

## Testing with Demo

A demo JSX file lives at `example/plan.jsx` in the project root. To test UI changes:

```bash
# 1. Start daemon (if not running)
bun bin/agent-canvas.ts daemon start

# 2. Build client assets (use --watch for live reload)
bun daemon/build.ts --watch

# 3. Push the demo plan
CANVAS_SESSION_ID=planner-demo bun bin/agent-canvas.ts push example/plan.jsx --label "Demo"

# 4. Open in browser
#    http://localhost:19400/s/planner-demo
```

The CLI blocks waiting for feedback after push — press Ctrl+C to exit without submitting. Each push creates a new revision visible in the browser's revision selector.

## Environment Variables

- `CANVAS_SESSION_ID` — current session (set by SessionStart hook)
- `CANVAS_PROJECT_ROOT` — project directory for file serving
- `CANVAS_PORT` — daemon port (default: 19400)
- `CANVAS_TIMEOUT` — CLI feedback wait timeout (default: 1 hour)
