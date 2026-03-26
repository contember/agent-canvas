import { spawn } from "child_process";
import { openSync, closeSync, readFileSync, existsSync, mkdirSync, unlinkSync } from "fs";
import { join } from "path";
import { PACKAGE_ROOT, TEMP_DIR, BASE_URL, PID_FILE, VERSION } from "./config.ts";

export async function isDaemonRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(1000) });
    const data = await res.json() as any;
    return data.ok === true;
  } catch {
    return false;
  }
}

async function getDaemonVersion(): Promise<string | null> {
  try {
    const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(1000) });
    const data = await res.json() as any;
    return data.version || null;
  } catch {
    return null;
  }
}

export async function startDaemon(): Promise<void> {
  console.error("Starting canvas daemon...");
  mkdirSync(TEMP_DIR, { recursive: true });

  const daemonScript = join(PACKAGE_ROOT, "daemon", "src", "server.ts");
  const stderrPath = join(TEMP_DIR, "daemon-startup.log");
  const stderrFd = openSync(stderrPath, "w");

  const child = spawn("bun", ["run", daemonScript], {
    detached: true,
    stdio: ["ignore", "ignore", stderrFd],
    cwd: join(PACKAGE_ROOT, "daemon"),
  });

  child.unref();
  closeSync(stderrFd);

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (await isDaemonRunning()) {
      console.error("Daemon started.");
      return;
    }
  }

  if (existsSync(stderrPath)) {
    const stderr = readFileSync(stderrPath, "utf-8").trim();
    if (stderr) {
      console.error("Daemon stderr:\n" + stderr);
    }
  }

  console.error("Error: Daemon failed to start within 3 seconds.");
  process.exit(1);
}

export async function ensureDaemon(): Promise<void> {
  if (await isDaemonRunning()) {
    const daemonVersion = await getDaemonVersion();
    if (daemonVersion && daemonVersion !== VERSION) {
      console.error(`Daemon version mismatch (daemon: ${daemonVersion}, CLI: ${VERSION}), restarting...`);
      stopDaemon();
      await startDaemon();
    }
    return;
  }
  await startDaemon();
}

export function stopDaemon(): boolean {
  if (existsSync(PID_FILE)) {
    const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
    try {
      process.kill(pid, "SIGTERM");
      console.log("Daemon stopped.");
      try { unlinkSync(PID_FILE); } catch {}
      return true;
    } catch {
      console.log("Daemon was not running (stale PID file).");
      try { unlinkSync(PID_FILE); } catch {}
      return false;
    }
  } else {
    console.log("No daemon PID file found.");
    return false;
  }
}
