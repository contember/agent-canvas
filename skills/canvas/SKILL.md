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

## Session

Your canvas session ID is: `${CLAUDE_SESSION_ID}`

Use this value for:
- File paths: `.claude/agent-canvas/${CLAUDE_SESSION_ID}/`
- CLI flags: `--session ${CLAUDE_SESSION_ID}`

## Instructions

!`bunx agent-canvas instructions`

!`bunx agent-canvas instructions --list`

**Getting detailed docs**: Run `bunx agent-canvas instructions <topic>` for detailed documentation on any component or flow. For example: `bunx agent-canvas instructions component-mermaid` or `bunx agent-canvas instructions flow-feature`.
