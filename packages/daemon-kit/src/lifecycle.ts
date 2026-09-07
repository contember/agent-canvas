/**
 * Daemon process lifecycle: is it up, start it, stop it, keep it in step with
 * the CLI that talks to it.
 *
 * The kernel owns the algorithm — health probing, the concurrent-start race,
 * which pid may be signalled — and the host owns every location: base URL, pid
 * file, spawn argv, log file, health shape, timeouts.
 *
 * The daemon's own pid, reported through `/health`, is the only pid this module
 * will signal. A pid file is written at spawn and read only to notice that
 * *someone* is already booting a daemon; a stale file or a reused pid must
 * never let the CLI kill an unrelated process.
 */

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "fs";
import { dirname } from "path";

/** Every host health shape must carry the daemon's own pid. */
export interface DaemonPid {
  pid: number;
}

export type DaemonHealthUp<H extends DaemonPid> = { status: "up"; ok: true; url: string } & H;

export interface DaemonHealthDown {
  status: "down";
  ok: false;
  url: string;
  error?: string;
}

export type DaemonHealth<H extends DaemonPid> = DaemonHealthUp<H> | DaemonHealthDown;

export type DaemonStopReason =
  | "stopped"
  | "not-running"
  /** Nothing was running; a pid file left behind was cleaned up. */
  | "stale-pid"
  /** A daemon answered `/health`, but signalling its pid failed. */
  | "signal-failed"
  | "refused-self";

export interface DaemonStopResult {
  stopped: boolean;
  /** The daemon's own pid, or the stale pid-file value that was cleaned up. */
  pid?: number;
  reason: DaemonStopReason;
  message: string;
}

/** Progress worth telling a user about; the host writes the words. */
export type DaemonEvent =
  | { type: "version-mismatch"; running: string; expected: string }
  | { type: "starting"; command: readonly string[] }
  | { type: "started"; pid: number }
  | { type: "stopped"; pid: number };

export interface DaemonTimeouts {
  /** Per `/health` request. Default 1000. */
  health?: number;
  /** Wait for a daemon this process spawned. Default 3000. */
  start?: number;
  /** Wait for a daemon another process is already starting. Default 1000. */
  concurrentStart?: number;
  /** Wait for a signalled daemon to go down. Default 2000. */
  stop?: number;
}

export interface DaemonLifecycleConfig<H extends DaemonPid> {
  /** Daemon origin, e.g. `http://localhost:19400`. */
  baseUrl: string;
  /** Health endpoint path. Default `/health`. */
  healthPath?: string;
  /** Narrows the `/health` body; `undefined` means "not a daemon we can talk to". */
  parseHealth(body: unknown): H | undefined;
  /** Written at spawn, so a concurrent start can see a daemon that is still booting. */
  pidFile: string;
  /** argv of the daemon process, e.g. `[process.execPath, entry, "serve"]`. */
  command: readonly string[];
  /** Working directory of the spawned daemon. Defaults to the current one. */
  cwd?: string;
  /** File the daemon's stdout and stderr are appended to. */
  logFile: string;
  /** Restart the daemon when its version differs from this CLI's. Off when omitted. */
  versionCheck?: {
    expected: string;
    of(health: H): string | undefined;
  };
  /** Removed with the pid file when the daemon stops (auth tokens, sockets, …). */
  cleanupFiles?: readonly string[];
  timeouts?: DaemonTimeouts;
  onEvent?(event: DaemonEvent): void;
}

export class DaemonStartError extends Error {
  constructor(message: string, readonly logFile: string, readonly logTail: string) {
    super(message);
    this.name = "DaemonStartError";
  }
}

export interface DaemonLifecycle<H extends DaemonPid> {
  health(timeoutMs?: number): Promise<DaemonHealth<H>>;
  isRunning(): Promise<boolean>;
  start(): Promise<DaemonHealthUp<H>>;
  /** A healthy daemon of the expected version, starting or restarting one if needed. */
  ensure(): Promise<DaemonHealthUp<H>>;
  stop(): Promise<DaemonStopResult>;
  restart(): Promise<DaemonHealthUp<H>>;
}

const LOG_TAIL_BYTES = 4096;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createDaemonLifecycle<H extends DaemonPid>(
  config: DaemonLifecycleConfig<H>,
): DaemonLifecycle<H> {
  const healthUrl = `${config.baseUrl}${config.healthPath ?? "/health"}`;
  const timeouts = {
    health: config.timeouts?.health ?? 1_000,
    start: config.timeouts?.start ?? 3_000,
    concurrentStart: config.timeouts?.concurrentStart ?? 1_000,
    stop: config.timeouts?.stop ?? 2_000,
  };

  function emit(event: DaemonEvent): void {
    config.onEvent?.(event);
  }

  async function health(timeoutMs: number = timeouts.health): Promise<DaemonHealth<H>> {
    const url = config.baseUrl;
    try {
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) return { status: "down", ok: false, url, error: `HTTP ${response.status}` };
      const parsed = config.parseHealth(await response.json());
      if (!parsed) return { status: "down", ok: false, url, error: "invalid health response" };
      return { status: "up", ok: true, url, ...parsed };
    } catch (error) {
      return { status: "down", ok: false, url, error: errorMessage(error) };
    }
  }

  async function pollHealthy(timeoutMs: number): Promise<DaemonHealth<H>> {
    const deadline = Date.now() + timeoutMs;
    let last = await health();
    while (last.status === "down" && Date.now() < deadline) {
      await sleep(100);
      last = await health();
    }
    return last;
  }

  function readPid(): number | undefined {
    try {
      const pid = Number(readFileSync(config.pidFile, "utf-8").trim());
      return Number.isInteger(pid) && pid > 0 ? pid : undefined;
    } catch {
      return undefined;
    }
  }

  function processIsAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  function cleanupFiles(): void {
    for (const file of [config.pidFile, ...(config.cleanupFiles ?? [])]) {
      try { rmSync(file, { force: true }); } catch {}
    }
  }

  function readLogTail(): string {
    if (!existsSync(config.logFile)) return "";
    try {
      const log = readFileSync(config.logFile, "utf-8");
      return log.slice(-LOG_TAIL_BYTES).trim();
    } catch {
      return "";
    }
  }

  function spawnDaemon(): number {
    mkdirSync(dirname(config.logFile), { recursive: true });
    appendFileSync(config.logFile, `--- daemon start ${new Date().toISOString()}\n`);
    const stdout = openSync(config.logFile, "a");
    const stderr = openSync(config.logFile, "a");
    try {
      const child = Bun.spawn([...config.command], {
        cwd: config.cwd ?? process.cwd(),
        stdin: "ignore",
        stdout,
        stderr,
        detached: true,
      });
      child.unref();
      mkdirSync(dirname(config.pidFile), { recursive: true });
      writeFileSync(config.pidFile, `${child.pid}\n`);
      return child.pid;
    } finally {
      closeSync(stdout);
      closeSync(stderr);
    }
  }

  async function start(): Promise<DaemonHealthUp<H>> {
    emit({ type: "starting", command: config.command });
    spawnDaemon();
    const started = await pollHealthy(timeouts.start);
    if (started.status === "up") {
      emit({ type: "started", pid: started.pid });
      return started;
    }
    throw new DaemonStartError(
      `Daemon did not become healthy within ${timeouts.start}ms.`,
      config.logFile,
      readLogTail(),
    );
  }

  async function stop(): Promise<DaemonStopResult> {
    const current = await health();

    if (current.status === "down") {
      const stale = readPid();
      if (stale === undefined) return { stopped: false, reason: "not-running", message: "Daemon is not running." };
      cleanupFiles();
      return { stopped: false, pid: stale, reason: "stale-pid", message: `Daemon is not running; removed stale pid ${stale}.` };
    }

    const pid = current.pid;
    if (pid === process.pid) {
      return { stopped: false, pid, reason: "refused-self", message: `Daemon pid ${pid} is this process; refusing to stop self.` };
    }

    try {
      process.kill(pid, "SIGTERM");
    } catch {
      cleanupFiles();
      return { stopped: false, pid, reason: "signal-failed", message: `Daemon pid ${pid} could not be signalled.` };
    }

    const deadline = Date.now() + timeouts.stop;
    while (Date.now() < deadline && (await health()).status === "up") {
      await sleep(100);
    }
    cleanupFiles();
    emit({ type: "stopped", pid });
    return { stopped: true, pid, reason: "stopped", message: `Stopped daemon pid ${pid}.` };
  }

  async function ensure(): Promise<DaemonHealthUp<H>> {
    const current = await health();
    if (current.status === "up") {
      const check = config.versionCheck;
      const running = check?.of(current);
      if (check && running && running !== check.expected) {
        emit({ type: "version-mismatch", running, expected: check.expected });
        await stop();
        return await start();
      }
      return current;
    }

    // Someone else may be mid-spawn: a live pid with no health yet is a daemon
    // still booting, and racing it would put a second one on the same port.
    const pid = readPid();
    if (pid !== undefined && processIsAlive(pid)) {
      const starting = await pollHealthy(timeouts.concurrentStart);
      if (starting.status === "up") return starting;
    }

    return await start();
  }

  async function restart(): Promise<DaemonHealthUp<H>> {
    await stop();
    return await start();
  }

  return {
    health,
    async isRunning() {
      return (await health()).status === "up";
    },
    start,
    ensure,
    stop,
    restart,
  };
}
