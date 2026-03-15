#!/usr/bin/env bun

import { handlePush } from "./lib/commands/push.ts";
import { handleFetch } from "./lib/commands/fetch.ts";
import { handleWatch } from "./lib/commands/watch.ts";
import { handleDaemon } from "./lib/commands/daemon.ts";
import { handleInstall } from "./lib/commands/install.ts";

function printUsage() {
  console.error(`agent-canvas — Interactive visual canvas for Claude Code

Commands:
  agent-canvas install [local|global]  Install skill for Claude Code
  agent-canvas push <file.jsx>         Push a canvas, open browser
  agent-canvas fetch [--session <id>]  Check for feedback (returns immediately)
  agent-canvas watch [--session <id>]  Wait for user feedback (blocks until submitted)
  agent-canvas daemon status           Show daemon status
  agent-canvas daemon stop             Stop the daemon
  agent-canvas daemon start            Start the daemon
  agent-canvas daemon restart          Restart the daemon

Environment:
  CANVAS_PORT           Daemon port (default: 19400)`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printUsage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  const command = args[0];
  const rest = args.slice(1);

  switch (command) {
    case "push": return handlePush(rest);
    case "fetch": return handleFetch(rest);
    case "watch": return handleWatch(rest);
    case "install": return handleInstall(rest);
    case "daemon": return handleDaemon(rest);
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
