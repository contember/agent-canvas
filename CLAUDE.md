# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Agent Canvas — an interactive browser-based visual canvas for Claude Code. Users author JSX documents that get compiled and rendered in the browser with annotation, feedback, and file browsing capabilities.

## Architecture

Three processes communicate via HTTP and WebSocket, over a shared kernel:

- **CLI** (`bin/agent-canvas.ts`) — pushes JSX canvases to the daemon, waits for user feedback, manages daemon lifecycle
- **Daemon** (`daemon/src/server.ts`) — Bun HTTP+WS server on port 19400 (`CANVAS_PORT`). Compiles JSX, manages sessions, serves the browser UI
- **Browser UI** (`daemon/client/`) — React 18 app loaded via CDN UMD with ESM import maps. Handles annotations, revision history, feedback collection, file browsing

**Kernel** (`packages/canvas-kernel/`, `@fabrika/canvas-kernel`) — the reusable half, source-shipped and consumed by this repo plus `~/projects/contember/fabrika`. Three rings, each with its own entry:

| Entry | Ring | What it holds |
|---|---|---|
| `/daemon` | daemon runtime | WebSocket channel, CLI waiter, process lifecycle, router, paths — knows nothing about canvases |
| `/client` | annotation surface | annotation state, sidebar, popovers, and the locator strategies (text, block, region) |
| `/server` | canvas engine | JSX compiler, session/revision store, watcher, the canvas WS vocabulary |

A host takes only the rings it needs. The kernel is published, so nothing under `packages/canvas-kernel/` may import from outside it.

**Data flow:** CLI pushes JSX → daemon compiles via `Bun.build()` → browser loads compiled JS module → user annotates/responds → feedback sent back to CLI via WebSocket

**Session model:** Each canvas push creates/updates a session identified by `CANVAS_SESSION_ID` (set by hook). Sessions are stored on disk at `~/.claude/agent-canvas/sessions/{id}/` with a revision system (`revisions/{rev}/plan.jsx`, `plan.compiled.js`, `feedback.md`).

## Build

```bash
bun install
bun run build              # builds client assets to daemon/dist/
bun daemon/build.ts --watch  # watch mode with debounced rebuild
```

The build produces three bundles (runtime.js, components.js, client.js) plus Tailwind CSS. React is loaded from CDN, not bundled. Import maps route `#canvas/components` and `#canvas/runtime` to the local bundles.

## Typecheck

```bash
bun run typecheck          # runs tsc --noEmit across all three projects
```

Three tsconfig files: `tsconfig.json` (root, covers `bin/`), `packages/canvas-kernel/tsconfig.json`, and `daemon/tsconfig.json` (covers `daemon/src/` and `daemon/client/`). The kernel's is the strictest — it ships as sources, so it is checked under the flags its strictest consumer sets. CI runs typecheck on every push and PR.

## Key Technical Details

- **Runtime is Bun only** — no Node.js compatibility needed
- **JSX compilation** uses temp files because `Bun.build()` doesn't support `stdin`. See `packages/canvas-kernel/src/engine/compiler.ts`
- **Component imports are injected** by the compiler — authored JSX can use `Section`, `Task`, `CodeBlock`, etc. without imports
- **Adding a new component:** create in `packages/canvas-kernel/src/client/components/`, export from `index.ts`, add to `KERNEL_COMPONENTS` in `packages/canvas-kernel/src/engine/compiler.ts`, rebuild
- **Adding a new annotation kind:** write an `AnnotationTarget` and register it in `ANNOTATION_TARGETS` (`packages/canvas-kernel/src/client/annotationDom.ts`). Creation and lookup must read the same selector — an annotation minted where the lookup does not scan can never be found again
- **Bun's `spawn` throws synchronously** on missing executables — always check with `which` before spawning

## Testing with Demo

A demo JSX file lives at `example/plan.jsx` in the project root. To test UI changes:

```bash
# 1. Start daemon (if not running)
bun bin/agent-canvas.ts daemon start

# 2. Build client assets (use --watch for live reload)
bun daemon/build.ts --watch

# 3. Push the demo plan
CANVAS_SESSION_ID=planner-demo bun bin/agent-canvas.ts push example --label "Demo"

# 4. Open in browser
#    http://localhost:19400/s/planner-demo
```

The CLI blocks waiting for feedback after push — press Ctrl+C to exit without submitting. Each push creates a new revision visible in the browser's revision selector.

## Publishing

To release a new version:

1. Bump the version in `package.json`
2. Commit the change and create a git tag: `git tag v<version>`
3. Push both the commit and the tag: `git push && git push origin v<version>`

The CI pipeline handles `npm publish` automatically when a new version tag is pushed. Do not run `npm publish` manually.

## Bundled Skill

This package distributes a Claude Code skill in `skills/canvas/`. It teaches Claude Code how to use Agent Canvas — writing JSX canvases, pushing, waiting for feedback, iterating, and responding to user feedback. The skill is automatically available to users who install this package.

## Environment Variables

- `CANVAS_SESSION_ID` — current session (set by SessionStart hook)
- `CANVAS_PROJECT_ROOT` — project directory for file serving
- `CANVAS_PORT` — daemon port (default: 19400)
- `CANVAS_TIMEOUT` — CLI feedback wait timeout (default: 1 hour)
