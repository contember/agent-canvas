# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Agent Canvas — an interactive browser-based visual canvas for Claude Code. Users author JSX documents that get compiled and rendered in the browser with annotation, feedback, and file browsing capabilities.

## Architecture

Three processes communicate via HTTP and WebSocket over three packages maintained in
[`fabrika-platform`](https://github.com/contember/fabrika-platform):

- **CLI** (`bin/agent-canvas.ts`) — pushes JSX canvases to the daemon, waits for user feedback, manages daemon lifecycle
- **Daemon** (`daemon/src/server.ts`) — Bun HTTP+WS server on port 19400 (`CANVAS_PORT`). Compiles JSX, manages sessions, serves the browser UI
- **Browser UI** (`daemon/client/`) — React-typed app running on bundled Preact compat with ESM import maps. Handles annotations, revision history, feedback collection, file browsing

Consume three published source packages:

| Package | Responsibility |
|---|---|
| `@fabrika/daemon-kit` | WebSocket channel, CLI waiter, process lifecycle, HTTP router/helpers; no canvas or UI dependencies |
| `@fabrika/annotations` | Annotation state, editor/list/popovers, text/block/region locators and markdown; no canvas or daemon dependencies |
| `@fabrika/canvas-kernel` | `/server`: compiler, revisions, watcher, canvas WS and paths; `/client`: renderer, canvas draft persistence, responses, sidebar and components |

Use package imports across boundaries. Their source lives in `fabrika-platform/packages/`, not this repository.
Keep dependencies one-way: canvas server → daemon-kit; canvas client → annotations.
Keep revisions, response pruning and canvas module loading out of annotations.
Read each package's `README.md` in `fabrika-platform` for its API and the 0.2 migration.

**Data flow:** CLI pushes JSX → daemon compiles via `Bun.build()` → browser loads compiled JS module → user annotates/responds → feedback sent back to CLI via WebSocket

**Session model:** Each canvas push creates/updates a session identified by `CANVAS_SESSION_ID` (set by hook). Sessions are stored on disk at `~/.claude/agent-canvas/sessions/{id}/` with a revision system (`revisions/{rev}/plan.jsx`, `plan.compiled.js`, `feedback.md`).

## Build

```bash
bun install
bun run build              # builds client assets to daemon/dist/
bun daemon/build.ts --watch  # watch mode with debounced rebuild
```

The build produces Preact compat, annotation runtime, canvas runtime, components and client bundles plus Tailwind CSS. Externalize `@fabrika/annotations/runtime` and `#canvas/runtime` from all consuming bundles and map each to one asset; duplicate context instances break annotations and responses.

## Typecheck

```bash
bun run typecheck          # CLI/scripts and daemon/client
```

CI runs typecheck on every push and PR. Run `bun test` for the host tests. The shared package tests run in `fabrika-platform`.

## Key Technical Details

- **Runtime is Bun only** — no Node.js compatibility needed
- **JSX compilation** uses temp files because `Bun.build()` doesn't support `stdin`. See `packages/canvas-kernel/src/engine/compiler.ts` in `fabrika-platform`
- **Component imports are injected** by the compiler — authored JSX can use `Section`, `Task`, `CodeBlock`, etc. without imports
- **Adding a new component:** edit `packages/canvas-kernel/` in `fabrika-platform`, export the component, add it to `KERNEL_COMPONENTS`, then update this host's dependency
- **Adding a new annotation kind:** edit `packages/annotations/` in `fabrika-platform`; creation and lookup must read the same selector
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

`agent-canvas` pins all three `@fabrika` dependencies to its exact release version. Their source and
release pipeline live in `fabrika-platform`; publish that version there before tagging this repository.

To release a new version after its dependencies exist on npm:

1. Bump the root `version` and the three dependency pins to the same version
2. Run `bun install` and `bun run check:versions`
3. Commit the change and create a git tag: `git tag v<version>`
4. Push both the commit and the tag: `git push && git push origin v<version>`

The CI pipeline publishes only `agent-canvas`. A consumer cannot install until its exact dependencies
exist. Do not run `npm publish` manually.

The `agent-canvas` tarball ships `bin/`, `daemon/` and `skills/` — named by the
`files` field, because without it npm sends everything not gitignored, which
meant the Cloudflare worker sources, the README screenshots and a second copy of
the kernel. `daemon/dist/` is gitignored but must ship; the `files` allow-list is
what lets it through, so do not replace it with an `.npmignore`.

This package publishes through npm **trusted publishing** (OIDC), so no npm token lives in the repo or
in CI secrets. The trust on npmjs.com names this repo plus `.github/workflows/release.yml`; renaming that
workflow file breaks publishing until the trust is updated to match.

## Bundled Skill

This package distributes a Claude Code skill in `skills/canvas/`. It teaches Claude Code how to use Agent Canvas — writing JSX canvases, pushing, waiting for feedback, iterating, and responding to user feedback. The skill is automatically available to users who install this package.

## Environment Variables

- `CANVAS_SESSION_ID` — current session (set by SessionStart hook)
- `CANVAS_PROJECT_ROOT` — project directory for file serving
- `CANVAS_PORT` — daemon port (default: 19400)
- `CANVAS_TIMEOUT` — CLI feedback wait timeout (default: 1 hour)
