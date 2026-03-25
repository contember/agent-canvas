# Agent Canvas — Instruction Guide

Canvas opens a rich, annotatable document in the user's browser. You write JSX, the user reviews and annotates it like Google Docs, and feedback comes back as markdown.

Use it whenever structured visual communication beats inline chat: plans, reviews, decisions, explanations, discovery interviews.

**Note**: Replace all `<session-id>` references below with your actual canvas session ID (provided in the skill header).

## Core Workflow

### 1. Write JSX

Use the **Write** tool to create `.jsx` files in `.claude/agent-canvas/<session-id>/`:

```jsx
// .claude/agent-canvas/<session-id>/plan.jsx

<Section title="Authentication Redesign">
  A proposal to replace session-based auth with JWT tokens.

  <Item id="current" label="Current state" badge="context" badgeVariant="info">
    The app uses express-session with Redis store.
    <FilePreview path="src/auth/session.ts" lines={[1, 45]} />
  </Item>

  <Item id="proposal" label="Proposed change" badge="proposal">
    Switch to stateless JWT with refresh token rotation.
    <Callout type="warning">This will invalidate all existing sessions.</Callout>
  </Item>
</Section>
```

Components are auto-available — no imports needed. The file can be a JSX fragment (just tags) or a full module with `export default`.

### 2. Push

Push the directory to open all canvases in the browser:

```bash
bunx agent-canvas push .claude/agent-canvas/<session-id>/ --session <session-id> --label "Implementation Plan"
```

All `*.jsx` files in the directory are pushed as a snapshot. Each file appears as a separate tab. **Always show the `browserUrl` from the output to the user.**

Options:
- `--label <text>` — revision label shown in the UI
- `--response <text>` — short banner explaining how you addressed prior feedback (2-4 sentences, focus on "why" not "what")

### 3. Watch for feedback

Run the watch command **in the background** using the Bash tool's `run_in_background` parameter:

```bash
# Use Bash tool with run_in_background: true
bunx agent-canvas watch --session <session-id>
```

You will be **automatically notified** when the user submits feedback. Do NOT poll, sleep, or proactively check. Just stop and wait.

**Important**: The push → watch sequence is atomic. Never push without watching. After starting the background watch, do not continue with other work unless instructed.

### 4. Iterate

Use the **Edit** tool to modify existing JSX based on feedback — targeted edits, not full rewrites. Then push and watch again.

### 5. Fetch (non-blocking alternative)

If the user tells you they've already submitted feedback:

```bash
bunx agent-canvas fetch --session <session-id>
```

Returns immediately — prints feedback if available, otherwise no output.

## Multiple Canvases

Use different files for different phases or concerns:

```
.claude/agent-canvas/<session-id>/
  discovery.jsx    # Discovery interview
  requirements.jsx # Requirements spec
  plan.jsx         # Implementation plan
```

Write new files as phases progress, then push the directory. Previous files remain visible as context.

## File Location

All canvas files go in `.claude/agent-canvas/<session-id>/` within the project root. Add `.claude/agent-canvas/` to `.gitignore`.

## Components

All components are globally available in canvas JSX — no imports needed. For inline styling use `style={{ ... }}` — Tailwind is NOT available.

**Never hardcode hex colors** — use CSS variables: `var(--color-text-primary)`, `var(--color-bg-surface)`, `var(--color-accent-blue)`, etc.

### Layout
- **Section** — top-level collapsible grouping with serif heading. Props: `title`, `collapsed`

### Content
- **Item** — primary content block (tasks, findings, requirements). Props: `id`, `label`, `badge`, `badgeVariant`, `status`
- **CodeBlock** — syntax-highlighted code. Props: `language`
- **FilePreview** — project file preview. Props: `path`, `lines` ([start, end])
- **Markdown** — renders markdown content. Props: `file` (path) or children (inline markdown string)
- **ImageView** — displays an image. Props: `src`, `alt`, `caption`, `width`
- **Diff** — side-by-side diff view. Props: `before`, `after`, `language`
- **Table** — data table. Props: `headers`, `rows`
- **Checklist** — checkbox list. Props: `items` ([{ label, checked }])
- **Mermaid** — diagram rendering. Children: mermaid syntax string
- **Callout** — alert box. Props: `type` (info/warning/danger/tip)
- **Note** — soft aside for non-critical info
- **Priority** — inline priority badge. Props: `level` (high/medium/low)

### Interactive (User Input)
- **Choice** — single-select radio group. Props: `id`, `label`, `options`, `required`
- **MultiChoice** — multi-select checkboxes. Props: `id`, `label`, `options`, `required`
- **UserInput** — free text input. Props: `id`, `label`, `placeholder`, `required`
- **RangeInput** — numeric slider. Props: `id`, `label`, `min`, `max`, `minLabel`, `maxLabel`, `required`

### Advanced
- **useFeedback** — hook for custom components to contribute computed data to feedback
- **Custom components** — use `export default function Canvas()` module format to define helpers

Run `bunx agent-canvas instructions <topic>` for detailed docs on any component or flow.

## Choosing a Flow

```
User wants something built/changed?
├─ Vague request → FEATURE flow (discovery → requirements → plan → implement → summary)
├─ Clear request with specifics → PLAN flow (plan → implement → summary)
├─ Complete instructions → skip canvas, implement directly, optionally push summary

User wants to understand something? → EXPLAIN flow
User wants review/audit? → REVIEW flow
User wants to make a decision? → DECISION flow
```

**Adapt dynamically**: flows are guidelines, not rigid pipelines. Skip or combine phases when appropriate:

| Situation | Action |
|---|---|
| User gave a detailed spec | Skip to PLAN (skip discovery + requirements) |
| User said "just do it" with clear instructions | Implement directly, push summary after |
| Simple change (< 3 files) | Probably skip canvas entirely |
| User explicitly says "don't plan, just code" | Implement, push summary |
| Mid-flow user says "looks good, go ahead" | Skip remaining review rounds |
| Discovery reveals it's trivial | Collapse remaining phases into one canvas |

**Always push a summary after implementation** unless the change was trivially small (1-2 file edit).

## Flow Execution Pattern

1. **Determine flow** from user intent
2. **Announce** briefly: "I'll start with discovery, then create a detailed plan."
3. **Write canvas JSX** with the Write tool
4. **Push + show browserUrl** to the user
5. **IMMEDIATELY watch in background** — the push → watch sequence is atomic
6. **Read feedback** — check for annotations, answers, context files
7. **Edit and re-push + watch**, or advance to next phase
8. **After implementation**, push a summary canvas and **watch for feedback** — the user may want to respond

## Important Rules

- **Write** canvas files using the Write tool. Never use bash heredocs.
- **Edit** canvas files using the Edit tool. Never rewrite entire files.
- Every `<Item>` and interactive component needs a unique `id`.
- `<FilePreview path="...">` paths are relative to project root.
- Read any files the user added to context (listed under "Added context" in feedback).
- Always push a summary canvas after implementation, even if brief.
- When the user approves, confirm what you'll do next before proceeding.
