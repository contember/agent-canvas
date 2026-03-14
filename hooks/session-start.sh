#!/bin/bash
# Injects CANVAS_SESSION_ID and CANVAS_PROJECT_ROOT into Claude Code environment.
# Called by Claude Code's SessionStart hook.
INPUT=$(cat /dev/stdin)
SESSION_ID=$(echo "$INPUT" | grep -o '"session_id":"[^"]*"' | cut -d'"' -f4)
CWD=$(echo "$INPUT" | grep -o '"cwd":"[^"]*"' | cut -d'"' -f4)

if [ -n "$SESSION_ID" ] && [ -n "$CLAUDE_ENV_FILE" ]; then
  echo "export CANVAS_SESSION_ID=$SESSION_ID" >> "$CLAUDE_ENV_FILE"
  echo "export CANVAS_PROJECT_ROOT=$CWD" >> "$CLAUDE_ENV_FILE"
fi
