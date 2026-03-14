#!/bin/bash
INPUT=$(cat /dev/stdin)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

if [ -n "$SESSION_ID" ] && [ -n "$CLAUDE_ENV_FILE" ]; then
  echo "export PLANNER_SESSION_ID=$SESSION_ID" >> "$CLAUDE_ENV_FILE"
  echo "export PLANNER_PROJECT_ROOT=$CWD" >> "$CLAUDE_ENV_FILE"
fi
