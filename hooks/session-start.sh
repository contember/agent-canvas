#!/bin/bash
# Injects CANVAS_SESSION_ID and CANVAS_PROJECT_ROOT into Claude Code environment.
# Called by Claude Code's SessionStart hook.

if [ -n "$CLAUDE_ENV_FILE" ]; then
  # Extract session ID from CLAUDE_ENV_FILE path:
  # /home/.../.claude/session-env/<SESSION_ID>/sessionstart-hook-0.sh
  SESSION_ID=$(basename "$(dirname "$CLAUDE_ENV_FILE")")
  CWD="${CLAUDE_PROJECT_DIR:-$(pwd)}"

  echo "export CANVAS_SESSION_ID=$SESSION_ID" >> "$CLAUDE_ENV_FILE"
  echo "export CANVAS_PROJECT_ROOT=$CWD" >> "$CLAUDE_ENV_FILE"
fi
