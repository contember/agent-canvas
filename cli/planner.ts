#!/usr/bin/env bun

import { spawn } from "child_process";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";

const DAEMON_PORT = parseInt(process.env.PLANNER_PORT || "19400", 10);
const BASE_URL = `http://localhost:${DAEMON_PORT}`;
const WS_URL = `ws://localhost:${DAEMON_PORT}`;
const TIMEOUT_MS = parseInt(process.env.PLANNER_TIMEOUT || String(60 * 60 * 1000), 10);
const PID_FILE = join(homedir(), ".planner", "daemon.pid");

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printUsage();
    process.exit(1);
  }

  const command = args[0];

  if (command === "push") {
    await handlePush(args.slice(1));
  } else if (command === "daemon") {
    await handleDaemon(args.slice(1));
  } else {
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exit(1);
  }
}

function printUsage() {
  console.error(`Usage:
  planner push <file.jsx>       Push a plan and wait for feedback
  planner push --from-hook      Read plan from stdin
  planner daemon status         Show daemon status
  planner daemon stop           Stop the daemon`);
}

async function handlePush(args: string[]) {
  const fromHook = args.includes("--from-hook");
  let jsx: string;
  let filePath: string | undefined;

  if (fromHook) {
    // Read from stdin
    jsx = await readStdin();
  } else {
    filePath = args.find((a) => !a.startsWith("--"));
    if (!filePath) {
      console.error("Error: No file specified. Usage: planner push <file.jsx>");
      process.exit(1);
    }
    filePath = resolve(filePath);
    if (!existsSync(filePath)) {
      console.error(`Error: File not found: ${filePath}`);
      process.exit(1);
    }
    jsx = readFileSync(filePath, "utf-8");
  }

  const sessionId = process.env.PLANNER_SESSION_ID || (() => {
    const id = randomUUID();
    console.error(`Warning: PLANNER_SESSION_ID not set, using generated ID: ${id}`);
    return id;
  })();

  const projectRoot = process.env.PLANNER_PROJECT_ROOT || process.cwd();

  // Ensure daemon is running
  await ensureDaemon();

  // POST the plan
  const response = await fetch(`${BASE_URL}/api/session/${sessionId}/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsx, projectRoot }),
  });

  const result = await response.json() as any;

  if (!result.ok) {
    console.error(`Compilation error:\n${result.error}`);
    process.exit(1);
  }

  // Open browser on first push for this session
  if (result.isNew) {
    openBrowser(result.browserUrl);
  }

  console.error(`Plan pushed: ${result.browserUrl}`);

  // Connect WebSocket and wait for feedback
  await waitForFeedback(sessionId);
}

async function ensureDaemon(): Promise<void> {
  // Check if daemon is already running
  if (await isDaemonRunning()) return;

  console.error("Starting planner daemon...");
  mkdirSync(join(homedir(), ".planner"), { recursive: true });

  // Find the server.ts path relative to this CLI
  const daemonScript = resolve(join(import.meta.dir, "..", "daemon", "src", "server.ts"));

  const child = spawn("bun", ["run", daemonScript], {
    detached: true,
    stdio: "ignore",
    cwd: resolve(join(import.meta.dir, "..", "daemon")),
  });

  child.unref();

  if (child.pid) {
    writeFileSync(PID_FILE, String(child.pid));
  }

  // Wait up to 3 seconds for health check
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (await isDaemonRunning()) {
      console.error("Daemon started.");
      return;
    }
  }

  console.error("Error: Daemon failed to start within 3 seconds.");
  process.exit(1);
}

async function isDaemonRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(1000) });
    const data = await res.json() as any;
    return data.ok === true;
  } catch {
    return false;
  }
}

function openBrowser(url: string) {
  const platform = process.platform;
  const candidates = platform === "darwin"
    ? ["open"]
    : ["xdg-open", "wslview", "sensible-browser"];

  for (const cmd of candidates) {
    const which = Bun.spawnSync(["which", cmd]);
    if (which.exitCode === 0) {
      spawn(cmd, [url], { detached: true, stdio: "ignore" }).unref();
      return;
    }
  }
  console.error(`Open this URL in your browser: ${url}`);
}

async function waitForFeedback(sessionId: string): Promise<void> {
  return new Promise((resolveP, rejectP) => {
    const ws = new WebSocket(`${WS_URL}/ws/wait/${sessionId}`);
    const timeout = setTimeout(() => {
      ws.close();
      console.error("Error: Timeout waiting for feedback.");
      process.exit(1);
    }, TIMEOUT_MS);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(typeof event.data === "string" ? event.data : "");
        if (data.type === "submit") {
          clearTimeout(timeout);
          // Print feedback to stdout
          process.stdout.write(data.feedback);
          ws.close();
          process.exit(0);
        }
      } catch {}
    };

    ws.onerror = () => {
      clearTimeout(timeout);
      console.error("Error: WebSocket connection failed.");
      process.exit(1);
    };

    ws.onclose = () => {
      clearTimeout(timeout);
      // If we get here without receiving feedback, it's an error
    };
  });
}

async function handleDaemon(args: string[]) {
  const subcommand = args[0];

  if (subcommand === "status") {
    try {
      const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(2000) });
      const data = await res.json() as any;
      console.log(`Daemon: running`);
      console.log(`Sessions: ${data.sessions.length > 0 ? data.sessions.join(", ") : "none"}`);
    } catch {
      console.log("Daemon: not running");
    }
  } else if (subcommand === "stop") {
    if (existsSync(PID_FILE)) {
      const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
      try {
        process.kill(pid, "SIGTERM");
        console.log("Daemon stopped.");
      } catch {
        console.log("Daemon was not running (stale PID file).");
      }
      try {
        const { unlinkSync } = await import("fs");
        unlinkSync(PID_FILE);
      } catch {}
    } else {
      console.log("No daemon PID file found.");
    }
  } else {
    console.error("Usage: planner daemon [status|stop]");
    process.exit(1);
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
