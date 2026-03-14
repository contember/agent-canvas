# Interactive Planner for Claude Code


Build an interactive web-based plan review tool for Claude Code. The tool lets Claude Code write plans as JSX files, renders them in a browser with a Google Docs-style annotation layer, and sends user feedback back to Claude Code via a blocking CLI command.


## Architecture Overview


```

Claude Code ──write──► plan.jsx ──planner push──► Daemon ──compile+serve──► Browser

                                                                              │

Claude Code ◄──stdout── planner push (unblocks) ◄──WebSocket── Browser submit─┘

     │

  str_replace plan.jsx (iterate)

```


Three components:

1. **`planner` CLI** — single binary, one command: `planner push <file>`. Lazy-starts daemon, upserts plan, opens browser, blocks until user submits feedback, prints feedback markdown to stdout.

2. **Planner Daemon** — Bun HTTP+WebSocket server. Compiles JSX, serves UI, manages sessions, broadcasts plan updates on file change.

3. **`@planner/components`** — Presentation-only React component library used in plan JSX. Ships bundled with the daemon.


Plus:

4. **Claude Code Plugin** — hooks.json + SessionStart script + SKILL.md for `/planner` command.


## Technology Stack


- **Runtime**: Bun (for daemon, CLI, and JSX compilation)

- **UI Framework**: React 18 + Tailwind CSS (bundled, no npm install at runtime)

- **JSX Compilation**: Bun.build or sucrase (JSX → JS transform, no TypeScript)

- **IPC**: WebSocket between CLI↔Daemon and Daemon↔Browser


## 1. `planner` CLI


Single Bun executable. Entry point: `planner push <plan.jsx>`.


### Behavior


```bash

planner push plan.jsx

```


1. Read `$PLANNER_SESSION_ID` from env (set by SessionStart hook). If missing, generate a random UUID and warn.

2. Read `$PLANNER_PROJECT_ROOT` from env. If missing, use `$(pwd)`.

3. Check if daemon is running: `GET http://localhost:19400/health`

   - If not responding: spawn daemon as detached background process, write PID to `~/.planner/daemon.pid`, wait up to 3 seconds for health check to pass.

4. `POST http://localhost:19400/api/session/${SESSION_ID}/plan` with body `{ jsx: <file contents>, projectRoot: <path> }`

   - Daemon upserts the session (creates if new, updates if exists).

5. Check response for `browserUrl`. If this is the first push for this session, open the URL in default browser (`open` on macOS, `xdg-open` on Linux).

6. Connect to `ws://localhost:19400/ws/wait/${SESSION_ID}`.

7. Block. When a `{ type: "submit", feedback: "..." }` message arrives, print `feedback` to stdout and exit 0.

8. On WebSocket disconnect or timeout (configurable, default 1 hour), exit 1 with error message.


### Additional subcommands (secondary priority)


- `planner daemon stop` — send shutdown signal

- `planner daemon status` — show running sessions

- `planner push --from-hook` — read plan content from stdin instead of file (for ExitPlanMode hook integration)


## 2. Planner Daemon


Bun server on port 19400 (configurable via `~/.planner/config.json` or `$PLANNER_PORT`).


### HTTP Endpoints


```

GET  /health                          → { ok: true, sessions: [...ids] }

POST /api/session/:id/plan            → upsert session, compile JSX, broadcast to browser

GET  /api/session/:id/plan.js         → compiled JS module for current plan

GET  /api/session/:id/meta            → { projectRoot, version, createdAt, updatedAt }

GET  /api/sessions                    → list active sessions with metadata

GET  /api/file?session=:id&path=:rel  → serve file from project (for FilePreview)

GET  /api/tree?session=:id&path=:rel  → directory listing (for file browser)

GET  /s/:id                           → serve the React app for a session

GET  /                                → serve session list / redirect to last active

GET  /assets/*                        → static assets (bundled React app, components, CSS)

```


### WebSocket Endpoints


```

ws://localhost:19400/ws/session/:id   → browser connects here. Receives:

                                        { type: "plan-updated", js: "...", version: N }

                                        Sends:

                                        { type: "submit", feedback: "..." }


ws://localhost:19400/ws/wait/:id      → CLI connects here. Receives:

                                        { type: "submit", feedback: "..." }

                                        (then server closes connection)

```


### JSX Compilation


When a plan is pushed or the plan file changes on disk:


```ts

async function compilePlan(jsx: string): Promise<string> {

  const wrapped = `

    import React from 'react';

    import * as C from '@planner/components';

    const { Section, Task, FilePreview, CodeBlock, Callout, 

            Mermaid, Table, Priority, Checklist, Note } = C;

    export default function Plan() {

      return (<>${jsx}</>);

    }

  `;

  const result = await Bun.build({

    stdin: { contents: wrapped, loader: 'jsx' },

    format: 'esm',

    external: ['react', 'react-dom', '@planner/components'],

  });

  return await result.outputs[0].text();

}

```


If compilation fails, broadcast the error to the browser so UI shows it. Also return the error from the POST endpoint so Claude Code sees it and can fix the JSX.


### File Watching


After a session is created, watch `plan.jsx` on disk (using Bun's `fs.watch` or the path provided). When it changes (Claude Code did `str_replace`), recompile and broadcast. This enables the live-edit loop where Claude Code edits the file and the browser updates immediately.


### Session Lifecycle


- Sessions are created on first `push` (upsert).

- Sessions are stored in `~/.planner/sessions/{id}/`:

  - `plan.jsx` — current plan source

  - `plan.compiled.js` — cached compilation

  - `meta.json` — `{ projectRoot, createdAt, updatedAt, version, revisions: [] }`

  - `history/001.jsx`, `history/002.jsx`, ... — previous versions (saved on each push)

- Sessions are removed after 24h of inactivity (configurable).

- Daemon auto-exits after 5 minutes with no active sessions and no connected WebSockets.


### File Serving Security


The `/api/file` and `/api/tree` endpoints serve files from the project directory:

- Resolve the requested path against `session.projectRoot`.

- Reject if resolved path is outside `projectRoot` (path traversal protection).

- Reject binary files over 1MB.

- Only serve text files (detect via extension or content sniffing).

- Read-only, localhost-only.


## 3. Browser UI (React App)


Bundled as static assets with the daemon. No build step at runtime.


### Layout


```

┌──────────────────────────────────────────────────────────────┐

│ Sessions: [auth-refactor ●] [api-migration ●] [tests ○]     │

├────────────────────────────────┬─────────────────────────────┤

│                                │ Annotations (sidebar)       │

│   Rendered Plan                │                             │

│   (JSX output with             │ ┌─ "Use jose instead" ────┐│

│    annotation overlay)         │ │  > Extract JWT valid...  ││

│                                │ └──────────────────────────┘│

│                                │                             │

│                                │ ┌─ "Tightly coupled" ─────┐│

│                                │ │  > Split the monolith... ││

│                                │ └──────────────────────────┘│

│                                │                             │

│                                │ [+ Add general note]        │

├────────────────────────────────┼─────────────────────────────┤

│ File Browser (collapsible)     │ Response Preview            │

│ src/                           │                             │

│ ├─ auth.ts          [+ add]   │ ## Annotations              │

│ ├─ middleware.ts     [+ add]   │ > Extract JWT valid...      │

│ └─ session.ts        [added]   │ Use jose instead of jwt     │

│                                │                             │

│                                │ ## Added context            │

│                                │ - src/session.ts            │

│                                │                             │

│                                │ [Edit before sending]       │

│                                │                             │

│                                │ [██████ Submit ██████████]  │

└────────────────────────────────┴─────────────────────────────┘

```


### Annotation Layer (Core UX)


This is the key differentiator — Google Docs-style commenting on any rendered content.


**Selection → Annotate flow:**

1. User selects text anywhere in the rendered plan (mouseup event on plan container).

2. A floating popover appears near the selection with a textarea.

3. User types their note and clicks "Add" (or Ctrl+Enter).

4. The annotation appears in the sidebar, linked to the highlighted text.

5. Clicking an annotation in the sidebar scrolls to and highlights the referenced text in the plan.

6. Clicking a highlight in the plan scrolls to the annotation in the sidebar.


**Implementation approach:**

- On selection, capture `window.getSelection()` text, and the DOM range.

- Store annotations as `{ id, snippet: string, note: string, rangeInfo: { startOffset, endOffset, containerPath } }`.

- Render highlights using CSS `::highlight` API or `<mark>` wrapper elements.

- Sidebar shows annotations in document order.


**Annotation actions:**

- Edit annotation text

- Delete annotation

- Each annotation is a text snippet (what was selected) + a note (what the user wrote)


### General Notes


Besides inline annotations, there's a "General note" textarea at the bottom of the sidebar for overall feedback that doesn't reference a specific part of the plan.


### File Browser


- Shows project directory tree from `/api/tree` endpoint.

- User can click files to preview them (opens in a modal/panel with syntax highlighting).

- Each file has an "Add to context" button. Added files appear in the response preview.

- Tree is lazy-loaded (expand folders on click).


### Response Preview


Auto-generated markdown from annotations + added files. **Editable** — user can freely modify before submitting.


```markdown

## Annotations


> Extract JWT validation from auth.ts

Use jose instead of jsonwebtoken, it's better maintained


> Split the monolithic auth.ts

Also handle session.ts, it's tightly coupled


## Added context

- src/session.ts


## General

Add a testing step before the refactor

```


The preview updates live as user adds/edits/removes annotations or files. But the textarea is freely editable — user can completely rewrite it if they want.


**Submit** button sends the final markdown content (whatever is in the textarea) via WebSocket as `{ type: "submit", feedback: "<markdown>" }`.


### Plan Rendering


- Fetch compiled plan JS from `/api/session/:id/plan.js`

- Dynamic import: `const { default: Plan } = await import(url)`

- Render inside `<AnnotationProvider>` context

- On WebSocket `plan-updated` event: re-fetch and re-render, clear annotations (plan has changed)

- Show compilation errors inline if the JSX failed to compile


### Session Switching


- Tab bar at top shows all active sessions (from `/api/sessions`)

- Click to switch — each session has independent annotations and response preview

- Visual indicator: green dot = has plan, gray = stale/waiting

- Poll `/api/sessions` every 5 seconds or use a separate WebSocket channel


### Styling


- Tailwind CSS, dark mode by default, light mode toggle

- Clean, minimal design. Monospace font for code/plan content.

- Sidebar width resizable (CSS resize or drag handle)

- Responsive: on narrow screens, sidebar collapses to bottom


## 4. `@planner/components` — Presentation Component Library


These are the React components available in plan JSX. They are purely presentational — no feedback/annotation logic. The annotation layer wraps around them generically.


All components are pre-bundled with the daemon and available in the JSX scope automatically.


### Components


#### `<Section title="string">` 

Collapsible section with heading. Children are the section content. Renders as a bordered card with the title as h2.


#### `<Task id="string" label="string" status="todo|done|blocked">`

A task item with optional checkbox visual. `id` is required and unique within the plan. Children are task details/description. Status controls visual styling (no interactivity — annotation is the feedback mechanism).


#### `<FilePreview path="string" lines={[start, end]}>`

Renders a file preview with syntax highlighting. Fetches content from `/api/file?session=...&path=...`. Shows filename header, line numbers, and language-appropriate highlighting (use highlight.js or shiki, bundled). `lines` prop is optional — if provided, shows only that range with context.


#### `<CodeBlock language="string">`

Inline code block with syntax highlighting. For code that's part of the plan narrative, not from a file.


#### `<Callout type="info|warning|danger|tip">`

Styled callout box. Children are the content.


#### `<Mermaid>`

Renders Mermaid diagram from children text content. Bundle mermaid.js with the daemon.


#### `<Table headers={["col1", "col2"]} rows={[["a", "b"], ...]}>`

Simple table component.


#### `<Priority level="high|medium|low">`

Inline badge showing priority level with color coding.


#### `<Checklist items={[{label: "string", checked: boolean}]}>`

Visual checklist (read-only display, not interactive — feedback via annotations).


#### `<Note>`

Styled note/aside block. Lighter styling than Callout.


#### `<Diff before="string" after="string" language="string">`

Side-by-side or unified diff view. For showing proposed changes.


## 5. Claude Code Plugin


### Directory Structure


```

planner/

├── .claude-plugin/

│   └── plugin.json

├── hooks/

│   ├── hooks.json

│   └── inject-session-id.sh

├── commands/

│   └── planner.md          # /planner slash command

├── skills/

│   └── planner/

│       └── SKILL.md

├── daemon/

│   ├── src/

│   │   ├── server.ts       # Bun HTTP + WebSocket server

│   │   ├── compiler.ts     # JSX compilation

│   │   ├── session.ts      # Session management

│   │   └── watcher.ts      # File watching

│   ├── client/

│   │   ├── App.tsx          # Main React app

│   │   ├── AnnotationProvider.tsx

│   │   ├── AnnotationSidebar.tsx

│   │   ├── ResponsePreview.tsx

│   │   ├── FileBrowser.tsx

│   │   ├── PlanRenderer.tsx

│   │   ├── SessionTabs.tsx

│   │   └── components/     # @planner/components source

│   │       ├── Section.tsx

│   │       ├── Task.tsx

│   │       ├── FilePreview.tsx

│   │       ├── CodeBlock.tsx

│   │       ├── Callout.tsx

│   │       ├── Mermaid.tsx

│   │       ├── Table.tsx

│   │       ├── Priority.tsx

│   │       ├── Checklist.tsx

│   │       ├── Note.tsx

│   │       ├── Diff.tsx

│   │       └── index.ts

│   ├── build.ts             # Build script: bundles client + components

│   ├── package.json

│   └── bunfig.toml

├── cli/

│   └── planner.ts           # CLI entry point

└── install.sh               # Builds daemon + CLI, installs binary

```


### plugin.json


```json

{

  "name": "planner",

  "description": "Interactive visual plan review with annotation-based feedback",

  "version": "0.1.0"

}

```


### hooks.json


```json

{

  "hooks": {

    "SessionStart": [

      {

        "matcher": "*",

        "hooks": [

          {

            "type": "command",

            "command": "bash \"${CLAUDE_PLUGIN_ROOT}/hooks/inject-session-id.sh\""

          }

        ]

      }

    ],

    "PermissionRequest": [

      {

        "matcher": "ExitPlanMode",

        "hooks": [

          {

            "type": "command",

            "command": "planner push --from-hook",

            "timeout": 345600

          }

        ]

      }

    ]

  }

}

```


### inject-session-id.sh


```bash

#!/bin/bash

INPUT=$(cat /dev/stdin)

SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')

CWD=$(echo "$INPUT" | jq -r '.cwd // empty')


if [ -n "$SESSION_ID" ] && [ -n "$CLAUDE_ENV_FILE" ]; then

  echo "export PLANNER_SESSION_ID=$SESSION_ID" >> "$CLAUDE_ENV_FILE"

  echo "export PLANNER_PROJECT_ROOT=$CWD" >> "$CLAUDE_ENV_FILE"

fi

```


### SKILL.md (`/planner` command)


```markdown

---

name: planner

description: >

  Interactive visual plan review. Use when creating implementation plans, 

  refactoring plans, migration plans, or any multi-step plan that benefits 

  from user review and annotation. Trigger on: "create a plan", "let me 

  review the plan", "plan this refactor", "show me what you'll change", 

  or when the user asks to review proposed changes interactively.

---


# Interactive Planner


Create visual, annotatable implementation plans that open in the user's browser.


## How to use


1. Write your plan as JSX to a file using the available components:


   ```jsx

   <Section title="Phase 1: Extract modules">

     High-level description of this phase.

     

     <Task id="extract-auth" label="Extract auth module" status="todo">

       Move JWT validation from monolith to dedicated module.

       <FilePreview path="src/auth.ts" lines={[42, 87]} />

     </Task>


     <Task id="add-tests" label="Add unit tests" status="todo">

       Cover the extracted module with tests.

       <Priority level="high" />

     </Task>

   </Section>


   <Section title="Phase 2: Update imports">

     <Callout type="warning">

       This will break existing imports. Run codemod first.

     </Callout>

     

     <Task id="codemod" label="Run import codemod" status="todo">

       <CodeBlock language="bash">

         npx jscodeshift -t transforms/update-imports.ts src/

       </CodeBlock>

     </Task>

   </Section>

   ```


2. Save the plan and push it to the planner UI:


   ```bash

   cat > ~/.planner/sessions/$PLANNER_SESSION_ID/plan.jsx << 'PLAN_EOF'

   ... your JSX plan here ...

   PLAN_EOF


   planner push ~/.planner/sessions/$PLANNER_SESSION_ID/plan.jsx

   ```


   This opens the plan in the user's browser and **blocks until they submit feedback**.


3. Read the feedback from stdout. It will be markdown with the user's annotations:


   ```markdown

   ## Annotations

   > Extract JWT validation from monolith

   Use jose library instead of jsonwebtoken

   

   ## Added context

   - src/session.ts

   

   ## General

   Looks good, but add error handling step

   ```


4. Based on the feedback, edit `plan.jsx` using str_replace (do NOT regenerate the whole file). Then push again:


   ```bash

   planner push ~/.planner/sessions/$PLANNER_SESSION_ID/plan.jsx

   ```


5. Repeat until the user approves (feedback will say something like "approved" or "looks good, go ahead").


## Available JSX Components


- `<Section title="...">` — collapsible section with heading

- `<Task id="..." label="..." status="todo|done|blocked">` — task item

- `<FilePreview path="..." lines={[start, end]} />` — syntax-highlighted file preview

- `<CodeBlock language="...">` — inline code

- `<Callout type="info|warning|danger|tip">` — callout box

- `<Mermaid>` — mermaid diagram

- `<Table headers={[...]} rows={[[...], ...]} />` — table

- `<Priority level="high|medium|low" />` — priority badge

- `<Checklist items={[{label, checked}]} />` — visual checklist

- `<Note>` — aside/note

- `<Diff before="..." after="..." language="..." />` — diff view


## Important rules


- Always use `$PLANNER_SESSION_ID` for the session directory — this is set automatically.

- `plan.jsx` is a JSX fragment — do NOT include import statements or function declarations. Just write the JSX directly.

- Every `<Task>` must have a unique `id` prop.

- `<FilePreview path="...">` paths are relative to the project root. The planner serves them from disk.

- After receiving feedback, use `str_replace` to edit plan.jsx — do NOT rewrite the entire file.

- The user can add files to context via the file browser. These appear under "Added context" in the feedback. Read those files before the next iteration.

- When the user is satisfied, proceed with implementation based on the final plan.

```


## Build & Install


### `install.sh`


```bash

#!/bin/bash

set -e


SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"


# Build the client

cd "$SCRIPT_DIR/daemon"

bun install

bun run build.ts  # outputs dist/ with bundled client + components


# Build the CLI (single executable)

cd "$SCRIPT_DIR/cli"

bun build planner.ts --compile --outfile planner


# Install

mkdir -p ~/.planner/bin

cp planner ~/.planner/bin/planner

chmod +x ~/.planner/bin/planner


# Copy daemon assets

cp -r "$SCRIPT_DIR/daemon/dist" ~/.planner/daemon


echo "Add to PATH: export PATH=\"\$HOME/.planner/bin:\$PATH\""

echo "Or add to CLAUDE_ENV_FILE in your SessionStart hook"

```


### `daemon/build.ts`


Bundles:

1. Client React app → `dist/client.js` + `dist/client.css`

2. `@planner/components` → `dist/components.js` (ESM, React as external)

3. Server stays as TypeScript (Bun runs it directly)


## Implementation Order


Build in this sequence, testing each layer before moving on:


1. **Daemon core** — HTTP server, session management, health endpoint. Test with curl.

2. **JSX compiler** — compile a sample plan.jsx, serve it. Test by fetching compiled JS.

3. **CLI `planner push`** — lazy daemon start, POST plan, open browser, WebSocket wait. Test end-to-end with a static HTML page.

4. **React app shell** — session tabs, plan rendering via dynamic import, WebSocket connection for live reload. Test by pushing plans from CLI and seeing them render.

5. **`@planner/components`** — Section, Task, CodeBlock, Callout first. FilePreview (needs `/api/file` endpoint). Then Mermaid, Table, Diff, etc.

6. **Annotation layer** — text selection, popover, sidebar, highlights, general notes. This is the hardest part.

7. **Response Preview** — auto-generated markdown from annotations + added files, editable textarea, submit button.

8. **File Browser** — tree view from `/api/tree`, add-to-context functionality.

9. **Plugin integration** — hooks.json, SessionStart script, SKILL.md, install.sh.

10. **Polish** — error handling, dark mode, responsive layout, daemon auto-shutdown.


## Key Design Decisions


- **JSX over MDX/JSON**: JSX gives layout flexibility, Claude generates it reliably, and it's a fragment (no imports/exports needed in the plan file).

- **Annotation layer is generic**: It doesn't know about plan components. It works on any rendered DOM content via text selection. This means we don't need special "feedback-aware" components.

- **File-based plans**: Plans live on disk as `.jsx` files. Claude Code edits them with `str_replace` like any other file. The daemon watches for changes. No special protocol needed.

- **One daemon, many sessions**: Avoids port conflicts and startup overhead. Sessions are isolated by ID.

- **Feedback is markdown**: The user's final output is a markdown string. Easy for Claude to parse, easy for users to edit. No structured format to maintain.

- **Browser does NOT write to disk**: Only the daemon writes files. Browser communicates only via WebSocket to daemon. This keeps the security model simple.
