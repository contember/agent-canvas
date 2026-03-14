#!/usr/bin/env node

const { execFileSync } = require("child_process");
const { join } = require("path");

const script = join(__dirname, "agent-canvas.ts");

try {
  execFileSync("bun", [script, ...process.argv.slice(2)], { stdio: "inherit" });
} catch (e) {
  if (e.status != null) process.exit(e.status);
  console.error("Failed to run agent-canvas. Is Bun installed? https://bun.sh");
  process.exit(1);
}
