---
name: canvas
description: >
  Interactive visual canvas for structured communication between agent and user.
  Opens a rich annotatable document in the user's browser where the user reviews,
  comments, answers questions, and submits feedback.

  Supports planning, architecture reviews, code reviews, discovery interviews,
  implementation summaries, proposals, decision documents, and explanations.
disable-model-invocation: true

---

# Canvas — Interactive Visual Documents

Canvas opens a rich, annotatable document in the user's browser. You write JSX, the user reviews and annotates it like Google Docs, and feedback comes back as markdown. Use it whenever structured visual communication beats inline chat.

**Read the flow reference before starting**: Check `${CLAUDE_SKILL_DIR}/flows.md` to pick the right flow for your task. Each flow has a specific sequence of canvases with templates.

**Read the component reference as needed**: Check `${CLAUDE_SKILL_DIR}/components.md` for the full component API.

## Core Mechanics

### Writing a Canvas

Use the **Write** tool to create a `.jsx` file in `.claude/agent-canvas/${CLAUDE_SESSION_ID}/`:

```jsx
// Write to: .claude/agent-canvas/${CLAUDE_SESSION_ID}/plan.jsx

<Section title="Authentication Redesign">
  A proposal to replace session-based auth with JWT tokens.
  
  <Item label="Current state" badge="context" badgeVariant="info">
    The app uses express-session with Redis store.
    <FilePreview path="src/auth/session.ts" lines={[1, 45]} />
  </Item>

  <Item label="Proposed change" badge="proposal">
    Switch to stateless JWT with refresh token rotation.
    <Callout type="warning">This will invalidate all existing sessions.</Callout>
  </Item>
</Section>
```

Components are auto-available — no imports needed. The file is a JSX fragment (just tags) or a full module with `export default`.

### Pushing

After writing the file, push it to open the canvas in the browser:

```bash
bunx agent-canvas push .claude/agent-canvas/${CLAUDE_SESSION_ID}/plan.jsx --session ${CLAUDE_SESSION_ID} --label "Implementation Plan"
```

This opens the canvas in the user's browser (first time) and exits immediately. The round label defaults to the filename if `--label` is omitted. **Always show the `browserUrl` from the push output to the user** so they can open the canvas manually if auto-open didn't work.

### Waiting for feedback

After pushing, wait for the user to review and submit:

```bash
bunx agent-canvas watch --session ${CLAUDE_SESSION_ID}
```

This **blocks until the user submits feedback**, then prints feedback markdown to stdout. If feedback was already submitted but not yet consumed, it returns immediately with the existing feedback.

**Timeout handling**: The watch command may time out if the user takes a while to review. If it times out, don't retry automatically — wait for the user to tell you they've submitted feedback, then run the watch command again (or use `fetch`) to retrieve it.

### Checking for feedback without blocking

Use `fetch` to check for feedback without waiting:

```bash
bunx agent-canvas fetch --session ${CLAUDE_SESSION_ID}
```

Returns immediately — prints feedback to stdout if available, otherwise produces no output. Use this to retry after a timeout or when the user tells you they've submitted.

### Iterating

Use the **Edit** tool to modify the existing JSX based on feedback — targeted edits, not full rewrites. Then push and wait again:

```bash
bunx agent-canvas push .claude/agent-canvas/${CLAUDE_SESSION_ID}/plan.jsx --session ${CLAUDE_SESSION_ID} --label "Implementation Plan (revised)"
bunx agent-canvas watch --session ${CLAUDE_SESSION_ID}
```

Each push creates a new **round** — the user sees previous rounds and their feedback in the UI.

### Multiple Canvases

Maintain separate files for different phases:

```bash
bunx agent-canvas push .claude/agent-canvas/${CLAUDE_SESSION_ID}/discovery.jsx --session ${CLAUDE_SESSION_ID} --label "Discovery"
bunx agent-canvas watch --session ${CLAUDE_SESSION_ID}
# ... process feedback ...
bunx agent-canvas push .claude/agent-canvas/${CLAUDE_SESSION_ID}/requirements.jsx --session ${CLAUDE_SESSION_ID} --label "Requirements"
bunx agent-canvas watch --session ${CLAUDE_SESSION_ID}
# ... process feedback ...
bunx agent-canvas push .claude/agent-canvas/${CLAUDE_SESSION_ID}/plan.jsx --session ${CLAUDE_SESSION_ID} --label "Implementation Plan"
bunx agent-canvas watch --session ${CLAUDE_SESSION_ID}
```

### File Location

All canvas files go in `.claude/agent-canvas/${CLAUDE_SESSION_ID}/` within the project root. Add `.claude/agent-canvas/` to `.gitignore` — these are ephemeral working files.

## Choosing a Flow

Determine which flow fits before starting. See `${CLAUDE_SKILL_DIR}/flows.md` for full details with templates.

```
User wants something built/changed?
├─ Vague request ("add auth", "refactor the API")
│  └─ FEATURE flow: discovery → requirements → plan → [implement] → summary
├─ Clear request with specifics
│  └─ PLAN flow: plan → [implement] → summary
├─ Complete instructions, just wants execution
│  └─ Skip canvas, implement directly, optionally push summary

User wants to understand something?
├─ "How does X work?", "Explain the auth system"
│  └─ EXPLAIN flow: single explanatory canvas

User wants review/audit?
├─ "Review this code", "Check for issues"
│  └─ REVIEW flow: findings canvas with categorized issues

User wants to make a decision?
├─ "Should we use X or Y?", "What database?"
│  └─ DECISION flow: options with tradeoffs, recommendation
```

**Adapt dynamically**: flows are guidelines, not rigid pipelines. Pivot if needed, skip if the user says so.

## Flow Execution Pattern

1. **Determine flow** from user intent
2. **Announce** briefly: "I'll start with discovery, then create a detailed plan."
3. **Write canvas JSX** with the Write tool to `.claude/agent-canvas/${CLAUDE_SESSION_ID}/<name>.jsx`
4. **Push**: `bunx agent-canvas push .claude/agent-canvas/${CLAUDE_SESSION_ID}/<name>.jsx --session ${CLAUDE_SESSION_ID} --label "<Label>"`
5. **Tell the user** the canvas is ready for review (they see it in their browser)
6. **Wait**: `bunx agent-canvas watch --session ${CLAUDE_SESSION_ID}` — this blocks until the user submits feedback
7. **Read feedback** — check for annotations, answers, added context files, approval
8. **Edit with the Edit tool and re-push + wait**, or advance to next phase
9. **After implementation**, push a summary canvas

## Interview Integration

For discovery phases, use iterative canvases or offer a checklist:

```jsx
<Section title="Before we start">
  Which areas should we discuss in depth?
  
  <MultiChoice id="interview-areas" label="Select areas to cover" required
    options={[
      "Backend architecture & data model",
      "API design & contracts", 
      "Frontend / UI behavior",
      "Edge cases & error handling",
      "Performance & scaling",
      "Security considerations",
      "Testing strategy",
      "Migration / deployment"
    ]} />
  
  <UserInput id="anything-else" label="Anything else I should know upfront?" />
</Section>
```

Then interview deeply in each selected area across subsequent rounds. Or ask in chat first: "Would you prefer a thorough interview before I plan, or should I make assumptions and you correct in review?"

## Important Rules

- **Write** canvas files to `.claude/agent-canvas/${CLAUDE_SESSION_ID}/` using the Write tool. Never use bash heredocs or cat.
- **Edit** canvas files using the Edit tool. Never rewrite entire files — make targeted edits.
- JSX can be a fragment (just tags) or a full module with `export default function Canvas()`.
- Every `<Item>` and interactive component needs a unique `id`.
- `<FilePreview path="...">` paths are relative to project root.
- For inline styling use `style={{ ... }}` — Tailwind is NOT available in canvas JSX.
- Read any files the user added to context (listed under "Added context" in feedback) with the Read tool before the next iteration.
- Always push a summary canvas after implementation, even if brief.
- When the user approves, confirm what you'll do next before proceeding.
