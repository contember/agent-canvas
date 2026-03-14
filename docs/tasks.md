# Planner — Implementation Tasks

Ordered sequence of tasks. Each task should be completable independently and testable before moving on.

---

## Phase 1: Project Skeleton & Daemon Core

### Task 1: Project scaffolding

Set up the monorepo structure, `package.json` files, and TypeScript/Bun config.

**Deliverables:**
- `daemon/package.json` with dependencies: `react`, `react-dom`, `tailwindcss`
- `daemon/tsconfig.json`
- `daemon/bunfig.toml`
- `cli/package.json`
- `cli/tsconfig.json`
- Root `package.json` with workspace config (if using workspaces) or simple scripts
- `.gitignore`
- Directory structure:
  ```
  planner/
  ├── cli/
  │   └── planner.ts        (empty placeholder)
  ├── daemon/
  │   ├── src/               (empty)
  │   ├── client/            (empty)
  │   └── package.json
  └── docs/
      └── tasks.md
  ```

**Verify:** `cd daemon && bun install` succeeds.

---

### Task 2: Daemon HTTP server + health endpoint

Implement the basic Bun HTTP server that listens on port 19400 with a health check endpoint.

**Deliverables:**
- `daemon/src/server.ts` — Bun.serve with routing
- `GET /health` → `{ ok: true, sessions: [] }`
- Port configurable via `$PLANNER_PORT` env var (default 19400)
- Localhost-only binding

**Verify:** `bun run daemon/src/server.ts` starts, `curl http://localhost:19400/health` returns OK.

---

### Task 3: Session management

In-memory session store with filesystem persistence.

**Deliverables:**
- `daemon/src/session.ts` — `SessionManager` class
  - `upsert(id, jsx, projectRoot)` — creates or updates a session
  - `get(id)` — returns session data
  - `list()` — returns all active sessions with metadata
  - `remove(id)` — deletes session
- Session data stored in `~/.planner/sessions/{id}/`:
  - `plan.jsx` — current source
  - `meta.json` — `{ projectRoot, createdAt, updatedAt, version }`
  - `history/001.jsx`, `002.jsx`, ... — previous versions on each update
- Stale session cleanup (24h inactivity, configurable)

**Verify:** Unit test or manual test — create session, update it, check files on disk, list sessions.

---

### Task 4: JSX compiler

Compile plan JSX fragments into ES modules using Bun.build.

**Deliverables:**
- `daemon/src/compiler.ts` — `compilePlan(jsx: string): Promise<{ ok: true, js: string } | { ok: false, error: string }>`
- Wraps JSX in module boilerplate (imports React, `@planner/components`, exports default `Plan` function)
- Uses `Bun.build` with `stdin` loader and externals for `react`, `react-dom`, `@planner/components`
- Returns compilation errors as structured data (not throws)
- Compiled output cached to `~/.planner/sessions/{id}/plan.compiled.js`

**Verify:** Compile a sample JSX fragment:
```jsx
<Section title="Test">
  <Task id="t1" label="Hello" status="todo">Description</Task>
</Section>
```
Output should be valid JS module.

---

### Task 5: Plan upsert API + serve compiled JS

Wire together sessions, compiler, and HTTP endpoints for pushing and fetching plans.

**Deliverables:**
- `POST /api/session/:id/plan` — body `{ jsx, projectRoot }`. Upserts session, compiles JSX, returns `{ ok, browserUrl, error? }`
- `GET /api/session/:id/plan.js` — serves compiled JS module with `Content-Type: application/javascript`
- `GET /api/session/:id/meta` — returns session metadata
- `GET /api/sessions` — returns list of all active sessions

**Verify:**
```bash
curl -X POST http://localhost:19400/api/session/test1/plan \
  -H 'Content-Type: application/json' \
  -d '{"jsx":"<Section title=\"Hello\"><Task id=\"t1\" label=\"Test\" status=\"todo\">Desc</Task></Section>","projectRoot":"/tmp"}'
# Should return { ok: true, browserUrl: "http://localhost:19400/s/test1" }

curl http://localhost:19400/api/session/test1/plan.js
# Should return compiled JS
```

---

### Task 6: File serving endpoints

Serve project files for `<FilePreview>` and file browser.

**Deliverables:**
- `GET /api/file?session=:id&path=:rel` — serves text file content from session's `projectRoot`
  - Path traversal protection (resolved path must be inside projectRoot)
  - Reject binary files and files over 1MB
  - Returns `{ content, language }` (language detected from extension)
- `GET /api/tree?session=:id&path=:rel` — returns directory listing as JSON
  - `{ entries: [{ name, type: "file"|"dir", size? }] }`
  - Optional `path` for subdirectory (default: root)
  - Same path traversal protection
  - Ignore `.git`, `node_modules`, common binary dirs

**Verify:** Start daemon with a session pointing to a real project, fetch file and tree endpoints with curl.

---

## Phase 2: CLI

### Task 7: CLI `planner push` — basic flow

Implement the CLI that posts a plan and opens the browser.

**Deliverables:**
- `cli/planner.ts` — CLI entry point, parses `push <file>` command
- Reads `$PLANNER_SESSION_ID` (or generates UUID + warns)
- Reads `$PLANNER_PROJECT_ROOT` (or uses `cwd`)
- Checks daemon health, if not running: spawns `bun daemon/src/server.ts` as detached process, writes PID to `~/.planner/daemon.pid`, waits up to 3s for health
- POSTs plan to daemon
- Opens browser URL on first push (`xdg-open` on Linux, `open` on macOS)
- Prints any compilation errors to stderr

**Verify:**
```bash
echo '<Section title="Test"><Task id="t1" label="Hi" status="todo">X</Task></Section>' > /tmp/plan.jsx
PLANNER_SESSION_ID=test1 PLANNER_PROJECT_ROOT=/tmp bun run cli/planner.ts push /tmp/plan.jsx
# Should start daemon (if needed), open browser, print browserUrl
```

---

### Task 8: CLI WebSocket wait + feedback

Make `planner push` block until user submits feedback.

**Deliverables:**
- After POSTing plan, CLI connects to `ws://localhost:19400/ws/wait/:id`
- Daemon implements `ws/wait/:id` WebSocket endpoint — holds connection open, sends `{ type: "submit", feedback }` when browser submits
- CLI prints `feedback` to stdout on receipt, exits 0
- On disconnect or timeout (default 1h, configurable via `$PLANNER_TIMEOUT`), exit 1

**Verify:**
1. Run `planner push` in one terminal (blocks)
2. Send mock submit via wscat or script: `wscat -c ws://localhost:19400/ws/session/test1` and send `{"type":"submit","feedback":"looks good"}`
3. CLI should print "looks good" and exit

---

### Task 9: CLI secondary subcommands

**Deliverables:**
- `planner daemon stop` — sends shutdown signal (POST /shutdown or kills PID from daemon.pid)
- `planner daemon status` — fetches /health, prints session list
- `planner push --from-hook` — reads JSX from stdin instead of file argument (for ExitPlanMode hook)

**Verify:** Test each subcommand manually.

---

## Phase 3: Browser UI — Shell

### Task 10: Client build pipeline

Set up the build that produces the static assets the daemon serves.

**Deliverables:**
- `daemon/build.ts` — Bun build script that:
  - Bundles `daemon/client/App.tsx` → `dist/client.js` + `dist/client.css` (with Tailwind)
  - Bundles `daemon/client/components/index.ts` → `dist/components.js` (ESM, React external)
  - Copies `index.html` template to `dist/`
- `daemon/client/index.html` — HTML shell that loads React, components, and client app via import maps or script tags
- Daemon serves `GET /s/:id` → `dist/index.html` and `GET /assets/*` → `dist/*`
- Daemon serves `GET /` → redirect to last active session or session list

**Verify:** `bun run daemon/build.ts` produces `dist/` with all files. Opening `http://localhost:19400/s/test1` shows a blank page with no JS errors.

---

### Task 11: Plan renderer + WebSocket live reload

Render the compiled plan JSX in the browser, with live updates.

**Deliverables:**
- `daemon/client/PlanRenderer.tsx` — fetches `/api/session/:id/plan.js`, dynamic-imports it, renders the exported `Plan` component
- `daemon/client/App.tsx` — main app shell, extracts session ID from URL, renders PlanRenderer
- WebSocket client connects to `ws://localhost:19400/ws/session/:id`
- Daemon implements `ws/session/:id` — on plan update, broadcasts `{ type: "plan-updated", version }` to all connected browsers
- On `plan-updated` message, PlanRenderer re-fetches and re-renders the plan
- Show compilation errors inline if plan failed to compile

**Verify:**
1. Push a plan via CLI
2. Open browser — plan renders
3. Edit the plan.jsx on disk (or push again) — browser updates automatically

---

### Task 12: Session tabs

**Deliverables:**
- `daemon/client/SessionTabs.tsx` — tab bar at top showing all active sessions
- Fetches `/api/sessions` on mount, polls every 5s
- Click tab → navigates to `/s/:id`
- Visual indicator: green dot for sessions with plans, gray for stale
- Current session highlighted

**Verify:** Create two sessions via CLI, browser shows both tabs, clicking switches.

---

## Phase 4: `@planner/components`

### Task 13: Core components — Section, Task, CodeBlock, Callout, Note

The basic building blocks for plans.

**Deliverables:**
- `daemon/client/components/Section.tsx` — collapsible card with h2 title, border, expand/collapse toggle
- `daemon/client/components/Task.tsx` — task item with status badge (todo=gray, done=green, blocked=red), label as header, children as description
- `daemon/client/components/CodeBlock.tsx` — syntax-highlighted code block. Use a simple highlighter (e.g., bundled highlight.js with common languages or Shiki)
- `daemon/client/components/Callout.tsx` — styled box with icon for info/warning/danger/tip
- `daemon/client/components/Note.tsx` — lighter aside block
- `daemon/client/components/index.ts` — re-exports all components

**Verify:** Push a plan that uses all five components, renders correctly in browser.

---

### Task 14: Data components — Table, Checklist, Priority

**Deliverables:**
- `daemon/client/components/Table.tsx` — `headers` + `rows` props, styled table
- `daemon/client/components/Checklist.tsx` — `items` prop `[{label, checked}]`, visual checkboxes (read-only)
- `daemon/client/components/Priority.tsx` — inline badge, color-coded (high=red, medium=yellow, low=green)

**Verify:** Push a plan using all three, renders correctly.

---

### Task 15: FilePreview component

Fetches and displays file content with syntax highlighting.

**Deliverables:**
- `daemon/client/components/FilePreview.tsx`
  - Props: `path: string`, `lines?: [number, number]`
  - Fetches content from `/api/file?session=...&path=...` (session ID from React context)
  - Shows filename header, line numbers, syntax highlighting
  - If `lines` provided, shows only that range with surrounding context indicator
  - Loading and error states

**Verify:** Push a plan with `<FilePreview path="package.json" />` pointing to a real project, file renders with highlighting.

---

### Task 16: Mermaid component

**Deliverables:**
- `daemon/client/components/Mermaid.tsx`
  - Takes children text content as mermaid diagram source
  - Renders using mermaid.js (bundled or loaded from CDN as fallback)
  - Error state for invalid diagrams

**Verify:** Push a plan with a simple flowchart mermaid diagram, renders as SVG.

---

### Task 17: Diff component

**Deliverables:**
- `daemon/client/components/Diff.tsx`
  - Props: `before: string`, `after: string`, `language?: string`
  - Side-by-side or unified diff view
  - Syntax highlighting for the language
  - Use a simple diff algorithm (bundled `diff` library or custom)

**Verify:** Push a plan with `<Diff before="..." after="..." language="ts" />`, shows colored diff.

---

## Phase 5: Annotation Layer

### Task 18: Annotation data model + context

Set up the annotation state management.

**Deliverables:**
- `daemon/client/AnnotationProvider.tsx` — React context providing:
  - `annotations: Annotation[]` — `{ id, snippet, note, createdAt }`
  - `addAnnotation(snippet, note)`
  - `updateAnnotation(id, note)`
  - `removeAnnotation(id)`
  - `generalNote: string` + `setGeneralNote(text)`
  - `contextFiles: string[]` + `addContextFile(path)` + `removeContextFile(path)`
  - `clearAll()` — called when plan updates (new version)
- Annotations stored in component state (not persisted — they're ephemeral per review session)

**Verify:** Unit test or manual — add/edit/remove annotations via context, state updates correctly.

---

### Task 19: Text selection → annotation popover

The core annotation UX: select text in the plan, type a note.

**Deliverables:**
- `mouseup` event listener on the plan container
- On text selection (`window.getSelection()`), show a floating popover positioned near the selection
- Popover contains: selected text preview (truncated), textarea for note, "Add" button, keyboard shortcut (Ctrl+Enter)
- On add: creates annotation via context, clears selection
- Popover dismisses on click outside or Escape

**Verify:** Render a plan, select text, popover appears, type note, click Add — annotation is created.

---

### Task 20: Annotation sidebar

Display and manage annotations.

**Deliverables:**
- `daemon/client/AnnotationSidebar.tsx`
  - Lists all annotations in document order
  - Each annotation shows: quoted snippet (truncated), note text, edit/delete buttons
  - Edit inline — click edit, note becomes textarea, save/cancel
  - "Add general note" section at bottom with textarea
  - Clicking an annotation scrolls the plan to the relevant text (best-effort text search + highlight)

**Verify:** Create several annotations, sidebar lists them, edit/delete works, clicking scrolls to text.

---

### Task 21: Highlight rendering

Highlight annotated text in the plan.

**Deliverables:**
- When annotations exist, find and highlight matching text snippets in the plan DOM
- Use `<mark>` elements or CSS `::highlight` API
- Clicking a highlight in the plan scrolls to and highlights the annotation in the sidebar
- Highlights update when annotations change

**Verify:** Add annotation, corresponding text in plan gets highlighted, clicking it activates the sidebar entry.

---

## Phase 6: Response & Submit

### Task 22: Response preview + submit

Auto-generate feedback markdown and submit.

**Deliverables:**
- `daemon/client/ResponsePreview.tsx`
  - Auto-generates markdown from annotations + context files + general note:
    ```
    ## Annotations
    > snippet
    note

    ## Added context
    - file1.ts

    ## General
    general note text
    ```
  - Rendered in an editable textarea (user can freely modify)
  - Updates live as annotations/files change
  - "Submit" button sends `{ type: "submit", feedback: <textarea content> }` via WebSocket
  - After submit, show "Feedback sent" confirmation

**Verify:** Add annotations, preview updates. Edit preview freely. Click submit — CLI receives feedback and exits.

---

## Phase 7: File Browser

### Task 23: File browser panel

Browse project files and add to context.

**Deliverables:**
- `daemon/client/FileBrowser.tsx`
  - Collapsible panel below the plan
  - Shows project directory tree from `/api/tree`
  - Lazy-loaded: expand folders on click
  - Click file → opens preview modal with syntax-highlighted content (fetched from `/api/file`)
  - "Add to context" button on each file → adds to `contextFiles` in annotation context
  - Added files shown with "added" badge and remove option
  - Ignore `.git`, `node_modules` in display

**Verify:** Open file browser, navigate directories, preview a file, add it to context, see it in response preview.

---

## Phase 8: Integration & Polish

### Task 24: Full layout + styling

Assemble all pieces into the final layout.

**Deliverables:**
- Wire up the full layout from the spec:
  - Top: session tabs
  - Left: rendered plan (with annotation overlay)
  - Right sidebar: annotations
  - Bottom left: file browser (collapsible)
  - Bottom right: response preview + submit
- Tailwind CSS styling, dark mode by default, light mode toggle
- Resizable sidebar (CSS resize or drag handle)
- Responsive: sidebar collapses to bottom on narrow screens
- Monospace font for code content

**Verify:** Full visual check in browser — all panels present, layout works, dark/light toggle.

---

### Task 25: Daemon auto-shutdown + file watching

**Deliverables:**
- File watcher: after session created, watch `plan.jsx` on disk. On change, recompile and broadcast to browser via WebSocket.
- Auto-shutdown: daemon exits after 5 minutes with no active sessions and no connected WebSockets
- Cleanup: remove sessions stale for 24h+

**Verify:**
1. Edit plan.jsx on disk → browser updates
2. Close all sessions, wait 5min → daemon exits
3. Create session, leave for 24h → session cleaned up (or test with short timeout)

---

### Task 26: Claude Code plugin — hooks + SKILL.md

Create the plugin structure for Claude Code integration.

**Deliverables:**
- `hooks/hooks.json` — SessionStart hook to inject session ID, ExitPlanMode hook for `--from-hook`
- `hooks/inject-session-id.sh` — sets `PLANNER_SESSION_ID` and `PLANNER_PROJECT_ROOT` env vars
- `skills/planner/SKILL.md` — the `/planner` slash command as specified in the PRD
- `commands/planner.md` — command file (if needed separately from SKILL.md)

**Verify:** Install plugin in Claude Code, start session — env vars set. Use `/planner` — skill activates.

---

### Task 27: Install script + build

**Deliverables:**
- `install.sh`:
  - Builds client (`bun run daemon/build.ts`)
  - Builds CLI as single executable (`bun build cli/planner.ts --compile --outfile planner`)
  - Installs binary to `~/.planner/bin/`
  - Copies daemon dist to `~/.planner/daemon/`
  - Prints PATH instructions
- Update READMEs / usage docs if needed

**Verify:** Run `./install.sh`, then `planner push` works from anywhere.

---

### Task 28: Error handling + edge cases

Final hardening pass.

**Deliverables:**
- Daemon: graceful error responses for all endpoints, CORS headers for localhost
- CLI: clear error messages for all failure modes (daemon won't start, compilation failed, timeout, etc.)
- Browser: connection lost indicator + auto-reconnect for WebSocket
- Plan re-render: clear annotations when plan version changes (with confirmation if annotations exist)
- Handle concurrent sessions correctly (multiple CLIs pushing to different sessions)

**Verify:** Test error scenarios: kill daemon while CLI waits, push invalid JSX, disconnect browser, push to two sessions simultaneously.

---

## Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| 1 | 1–6 | Project setup, daemon core (HTTP, sessions, compiler, file serving) |
| 2 | 7–9 | CLI (`planner push`, WebSocket wait, subcommands) |
| 3 | 10–12 | Browser shell (build pipeline, plan rendering, session tabs) |
| 4 | 13–17 | `@planner/components` (Section, Task, CodeBlock, etc.) |
| 5 | 18–21 | Annotation layer (data model, selection, sidebar, highlights) |
| 6 | 22 | Response preview + submit |
| 7 | 23 | File browser |
| 8 | 24–28 | Layout, styling, file watching, plugin, install, polish |
