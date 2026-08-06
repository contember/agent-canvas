---
name: canvas
description: >
  Interactive visual canvas for structured communication between agent and user.
  Opens a rich annotatable document in the user's browser where the user reviews,
  comments, answers questions, and submits feedback.

  Supports planning, architecture reviews, code reviews, discovery interviews,
  implementation summaries, proposals, decision documents, explanations, and
  runbooks that hand local secrets to commands without putting values in context.
disable-model-invocation: true

---

## Session

Resolve the canvas session ID **once**, then reuse the literal value for the
entire workflow:

```bash
echo "${CANVAS_SESSION_ID:-${CODEX_THREAD_ID:-${CLAUDE_CODE_SESSION_ID:-$(uuidgen)}}}"
```

Write the printed value into every canvas command as `--session "<id>"`, and
store canvas files in `${TMPDIR:-/tmp}/agent-canvas/<id>/`.

Do NOT rely on `export` — in some hosts (Claude Code) each shell call starts
fresh, so the variable will not survive between commands.

## Instructions

Run these commands from the user's project root before using Canvas:

```bash
bunx agent-canvas instructions
bunx agent-canvas instructions --list
```

**Getting detailed docs**: Run `bunx agent-canvas instructions <topic>` for detailed documentation on any component or flow. For example: `bunx agent-canvas instructions component-mermaid` or `bunx agent-canvas instructions flow-feature`.
