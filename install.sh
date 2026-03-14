#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Build the client
echo "Building client..."
cd "$SCRIPT_DIR/daemon"
bun install
bun run build.ts

# Build the CLI (single executable)
echo "Building CLI..."
cd "$SCRIPT_DIR/cli"
bun build planner.ts --compile --outfile planner

# Install
mkdir -p ~/.planner/bin
cp planner ~/.planner/bin/planner
chmod +x ~/.planner/bin/planner

# Copy daemon assets
cp -r "$SCRIPT_DIR/daemon/dist" ~/.planner/daemon

# Copy daemon source (needed for spawning)
mkdir -p ~/.planner/daemon-src
cp -r "$SCRIPT_DIR/daemon/src" ~/.planner/daemon-src/src
cp "$SCRIPT_DIR/daemon/package.json" ~/.planner/daemon-src/
cp -r "$SCRIPT_DIR/daemon/node_modules" ~/.planner/daemon-src/ 2>/dev/null || true

echo ""
echo "Installation complete!"
echo "Add to PATH: export PATH=\"\$HOME/.planner/bin:\$PATH\""
echo "Or add to your shell profile (.bashrc, .zshrc, etc.)"
