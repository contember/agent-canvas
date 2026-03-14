#!/usr/bin/env bun

import { spawn } from "child_process";
import { readFileSync, existsSync, writeFileSync, mkdirSync, unlinkSync, cpSync } from "fs";
import { join, resolve, dirname } from "path";
import { homedir, tmpdir } from "os";
import { randomUUID } from "crypto";

const PACKAGE_ROOT = resolve(join(dirname(import.meta.path), ".."));
const DATA_DIR = join(homedir(), ".claude", "agent-canvas");
const TEMP_DIR = join(tmpdir(), "agent-canvas");
const DAEMON_PORT = parseInt(process.env.CANVAS_PORT || process.env.PLANNER_PORT || "19400", 10);
const BASE_URL = `http://localhost:${DAEMON_PORT}`;
const WS_URL = `ws://localhost:${DAEMON_PORT}`;
const TIMEOUT_MS = parseInt(process.env.CANVAS_TIMEOUT || String(60 * 60 * 1000), 10);
const PID_FILE = join(TEMP_DIR, "daemon.pid");

function getSessionId(): string {
  return process.env.CANVAS_SESSION_ID || process.env.PLANNER_SESSION_ID || (() => {
    const id = randomUUID();
    console.error(`Warning: CANVAS_SESSION_ID not set, using generated ID: ${id}`);
    return id;
  })();
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printUsage();
    process.exit(1);
  }

  const command = args[0];

  switch (command) {
    case "push": return handlePush(args.slice(1));
    case "wait": return handleWait(args.slice(1));
    case "install": return handleInstall(args.slice(1));
    case "daemon": return handleDaemon(args.slice(1));
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

function printUsage() {
  console.error(`agent-canvas — Interactive visual canvas for Claude Code

Commands:
  agent-canvas install [local|global]  Install skill & hooks for Claude Code
  agent-canvas push <file.jsx>         Push a canvas, open browser
  agent-canvas wait                    Wait for user feedback (prints to stdout)
  agent-canvas daemon status           Show daemon status
  agent-canvas daemon stop             Stop the daemon

Environment:
  CANVAS_SESSION_ID     Session ID (set automatically by hooks)
  CANVAS_PROJECT_ROOT   Project root (set automatically by hooks)
  CANVAS_PORT           Daemon port (default: 19400)`);
}

// ── install ──

async function handleInstall(args: string[]) {
  let mode = args[0] as "local" | "global" | undefined;

  if (!mode) {
    // Interactive prompt
    process.stderr.write("Install canvas skill and hooks for Claude Code.\n\n");
    process.stderr.write("  local  — install to .claude/ in current project\n");
    process.stderr.write("  global — install to ~/.claude/ for all projects\n\n");
    process.stderr.write("Choose [local/global]: ");

    const input = await readLine();
    mode = input.trim().toLowerCase() as "local" | "global";
  }

  if (mode !== "local" && mode !== "global") {
    console.error("Error: specify 'local' or 'global'");
    process.exit(1);
  }

  const targetBase = mode === "global"
    ? join(homedir(), ".claude")
    : join(process.cwd(), ".claude");

  // Install skill
  const skillTarget = join(targetBase, "commands", "canvas");
  mkdirSync(skillTarget, { recursive: true });

  const skillSrc = join(PACKAGE_ROOT, "skills", "canvas");
  for (const file of ["SKILL.md", "components.md", "flows.md"]) {
    const src = join(skillSrc, file);
    if (existsSync(src)) {
      cpSync(src, join(skillTarget, file));
    }
  }

  console.error(`  Skill installed to ${skillTarget}`);

  // Install hooks
  const hooksTarget = join(targetBase, "settings.json");
  const hookScript = join(PACKAGE_ROOT, "hooks", "inject-session-id.sh");

  // Read existing settings or create new
  let settings: any = {};
  if (existsSync(hooksTarget)) {
    try {
      settings = JSON.parse(readFileSync(hooksTarget, "utf-8"));
    } catch {}
  }

  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks.SessionStart) settings.hooks.SessionStart = [];

  // Check if our hook is already there
  const hookCommand = `bash -c 'INPUT=$(cat); SESSION_ID=$(echo "$INPUT" | grep -o \'"session_id":"[^"]*"\' | cut -d\\" -f4); CWD=$(echo "$INPUT" | grep -o \'"cwd":"[^"]*"\' | cut -d\\" -f4); if [ -n "$SESSION_ID" ] && [ -n "$CLAUDE_ENV_FILE" ]; then echo "export CANVAS_SESSION_ID=$SESSION_ID" >> "$CLAUDE_ENV_FILE"; echo "export CANVAS_PROJECT_ROOT=$CWD" >> "$CLAUDE_ENV_FILE"; fi'`;

  const hasHook = settings.hooks.SessionStart.some((h: any) =>
    h.hooks?.some((hh: any) => hh.command?.includes("CANVAS_SESSION_ID"))
  );

  if (!hasHook) {
    settings.hooks.SessionStart.push({
      matcher: "*",
      hooks: [{
        type: "command",
        command: hookCommand,
      }],
    });

    mkdirSync(dirname(hooksTarget), { recursive: true });
    writeFileSync(hooksTarget, JSON.stringify(settings, null, 2));
    console.error(`  Hook added to ${hooksTarget}`);
  } else {
    console.error(`  Hook already present in ${hooksTarget}`);
  }

  console.error(`\nInstalled! The /canvas command is now available in Claude Code.`);
  if (mode === "local") {
    console.error(`Add .claude/commands/ to .gitignore if you haven't already.`);
  }
}

// ── push ──

async function handlePush(args: string[]) {
  const fromHook = args.includes("--from-hook");
  let jsx: string;
  let filePath: string | undefined;

  if (fromHook) {
    jsx = await readStdin();
  } else {
    filePath = args.find((a) => !a.startsWith("--"));
    if (!filePath) {
      console.error("Error: No file specified. Usage: agent-canvas push <file.jsx>");
      process.exit(1);
    }
    filePath = resolve(filePath);
    if (!existsSync(filePath)) {
      console.error(`Error: File not found: ${filePath}`);
      process.exit(1);
    }
    jsx = readFileSync(filePath, "utf-8");
  }

  const sessionId = getSessionId();
  const projectRoot = process.env.CANVAS_PROJECT_ROOT || process.env.PLANNER_PROJECT_ROOT || process.cwd();

  // Extract --label flag
  const labelIdx = args.indexOf("--label");
  const label = labelIdx !== -1 && args[labelIdx + 1] ? args[labelIdx + 1] : undefined;
  const autoLabel = !label && filePath ? filePath.split("/").pop()?.replace(/\.jsx$/, "") : undefined;

  await ensureDaemon();

  const response = await fetch(`${BASE_URL}/api/session/${sessionId}/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsx, projectRoot, label: label || autoLabel }),
  });

  const result = await response.json() as any;

  if (!result.ok) {
    console.error(`Compilation error:\n${result.error}`);
    process.exit(1);
  }

  if (result.isNew) {
    openBrowser(result.browserUrl);
  }

  console.log(JSON.stringify({
    ok: true,
    browserUrl: result.browserUrl,
    revision: result.revision,
    sessionId,
  }));
}

// ── wait ──

async function handleWait(args: string[]) {
  const sessionId = getSessionId();

  await ensureDaemon();

  // Check if feedback already exists
  try {
    const metaRes = await fetch(`${BASE_URL}/api/session/${sessionId}/meta`);
    const meta = await metaRes.json() as any;
    if (meta.currentRevision && meta.revisions) {
      const currentRev = meta.revisions.find((r: any) => r.revision === meta.currentRevision);
      if (currentRev?.hasFeedback) {
        const fbRes = await fetch(`${BASE_URL}/api/session/${sessionId}/revision/${meta.currentRevision}/feedback`);
        const fbData = await fbRes.json() as any;
        if (fbData.feedback) {
          process.stdout.write(fbData.feedback);
          process.exit(0);
        }
      }
    }
  } catch {}

  await waitForFeedback(sessionId);
}

// ── daemon ──

async function handleDaemon(args: string[]) {
  const subcommand = args[0];

  if (subcommand === "status") {
    try {
      const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(2000) });
      const data = await res.json() as any;
      console.log(`Daemon: running on port ${DAEMON_PORT}`);
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
      try { unlinkSync(PID_FILE); } catch {}
    } else {
      console.log("No daemon PID file found.");
    }
  } else {
    console.error("Usage: agent-canvas daemon [status|stop]");
    process.exit(1);
  }
}

// ── helpers ──

async function ensureDaemon(): Promise<void> {
  if (await isDaemonRunning()) return;

  console.error("Starting canvas daemon...");
  mkdirSync(TEMP_DIR, { recursive: true });

  const daemonScript = join(PACKAGE_ROOT, "daemon", "src", "server.ts");

  const child = spawn("bun", ["run", daemonScript], {
    detached: true,
    stdio: "ignore",
    cwd: join(PACKAGE_ROOT, "daemon"),
  });

  child.unref();

  if (child.pid) {
    writeFileSync(PID_FILE, String(child.pid));
  }

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
  const candidates = process.platform === "darwin"
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
    };
  });
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

async function readLine(): Promise<string> {
  const buf: number[] = [];
  for await (const chunk of Bun.stdin.stream()) {
    for (const byte of chunk) {
      if (byte === 10) return Buffer.from(buf).toString("utf-8");
      buf.push(byte);
    }
  }
  return Buffer.from(buf).toString("utf-8");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
