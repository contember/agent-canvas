import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  createDaemonLifecycle,
  DaemonStartError,
  type DaemonEvent,
  type DaemonLifecycle,
} from "./lifecycle";

interface FixtureHealth {
  pid: number;
  version: string;
}

function parseHealth(body: unknown): FixtureHealth | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  if (!("ok" in body) || body.ok !== true) return undefined;
  if (!("pid" in body) || typeof body.pid !== "number") return undefined;
  if (!("version" in body) || typeof body.version !== "string") return undefined;
  return { pid: body.pid, version: body.version };
}

const DAEMON_FIXTURE = `
const port = Number(Bun.argv[2]);
const version = Bun.argv[3];
Bun.serve({
  port,
  hostname: "localhost",
  fetch(request) {
    if (new URL(request.url).pathname === "/health") {
      return Response.json({ ok: true, version, pid: process.pid });
    }
    return new Response("not found", { status: 404 });
  },
});
console.log("fixture daemon " + version + " listening on " + port);
`;

const CRASHING_FIXTURE = `
console.error("fixture daemon refused to start");
process.exit(1);
`;

const directories: string[] = [];
const spawned: number[] = [];
const servers: { stop(closeActiveConnections?: boolean): void }[] = [];

afterEach(() => {
  for (const pid of spawned.splice(0)) {
    try { process.kill(pid, "SIGKILL"); } catch {}
  }
  for (const server of servers.splice(0)) {
    try { server.stop(true); } catch {}
  }
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function portOf(server: { port?: number }): number {
  if (server.port === undefined) throw new Error("Bun.serve did not report a port");
  return server.port;
}

/** A free port, released right before the daemon under test claims it. */
function freePort(): number {
  const probe = Bun.serve({ port: 0, hostname: "localhost", fetch: () => new Response("probe") });
  const port = portOf(probe);
  probe.stop(true);
  return port;
}

interface Fixture {
  lifecycle: DaemonLifecycle<FixtureHealth>;
  events: DaemonEvent[];
  directory: string;
  pidFile: string;
  logFile: string;
  authFile: string;
  baseUrl: string;
}

function createFixture(options: { version?: string; expected?: string; crashing?: boolean } = {}): Fixture {
  const directory = mkdtempSync(join(tmpdir(), "canvas-lifecycle-test-"));
  directories.push(directory);

  const script = join(directory, "daemon.ts");
  writeFileSync(script, options.crashing ? CRASHING_FIXTURE : DAEMON_FIXTURE);
  const pidFile = join(directory, "daemon.pid");
  const logFile = join(directory, "daemon.log");
  const authFile = join(directory, "auth-token");
  const port = freePort();
  const baseUrl = `http://localhost:${port}`;
  const events: DaemonEvent[] = [];

  const lifecycle = createDaemonLifecycle<FixtureHealth>({
    baseUrl,
    parseHealth,
    pidFile,
    command: [process.execPath, "run", script, String(port), options.version ?? "1.0.0"],
    cwd: directory,
    logFile,
    versionCheck: { expected: options.expected ?? "1.0.0", of: (health) => health.version },
    cleanupFiles: [authFile],
    timeouts: { health: 500, start: 5_000, concurrentStart: 300, stop: 2_000 },
    onEvent: (event) => events.push(event),
  });

  return { lifecycle, events, directory, pidFile, logFile, authFile, baseUrl };
}

describe("health", () => {
  test("nothing listening reads as down", async () => {
    const { lifecycle, baseUrl } = createFixture();
    const health = await lifecycle.health();
    expect(health.status).toBe("down");
    expect(health.ok).toBe(false);
    expect(health.url).toBe(baseUrl);
    expect(await lifecycle.isRunning()).toBe(false);
  });

  test("a body this CLI cannot read is not a daemon it can talk to", async () => {
    const server = Bun.serve({
      port: 0,
      hostname: "localhost",
      fetch: () => Response.json({ ok: true, version: "1.0.0" }), // no pid
    });
    servers.push(server);

    const lifecycle = createDaemonLifecycle<FixtureHealth>({
      baseUrl: `http://localhost:${portOf(server)}`,
      parseHealth,
      pidFile: join(tmpdir(), "unused.pid"),
      command: [process.execPath, "--version"],
      logFile: join(tmpdir(), "unused.log"),
    });

    const health = await lifecycle.health();
    expect(health.status).toBe("down");
    expect(health.status === "down" && health.error).toBe("invalid health response");
  });
});

describe("start", () => {
  test("ensure starts a daemon and reports its own pid", async () => {
    const { lifecycle, events, pidFile } = createFixture();

    const health = await lifecycle.ensure();
    spawned.push(health.pid);

    expect(health.status).toBe("up");
    expect(health.version).toBe("1.0.0");
    expect(readFileSync(pidFile, "utf-8").trim()).toBe(String(health.pid));
    expect(events.map((event) => event.type)).toEqual(["starting", "started"]);
  }, 15_000);

  test("ensure leaves a healthy daemon of the right version alone", async () => {
    const { lifecycle, events } = createFixture();
    const first = await lifecycle.ensure();
    spawned.push(first.pid);

    const second = await lifecycle.ensure();
    expect(second.pid).toBe(first.pid);
    expect(events.filter((event) => event.type === "starting")).toHaveLength(1);
  }, 15_000);

  test("a version mismatch restarts the daemon", async () => {
    const { lifecycle, directory, pidFile, logFile, authFile, baseUrl } = createFixture({ version: "0.9.0" });
    const old = await lifecycle.ensure();
    spawned.push(old.pid);
    expect(old.version).toBe("0.9.0");

    // Same locations, same port — a newer CLI meeting the daemon it left behind.
    const events: DaemonEvent[] = [];
    const upgraded = createDaemonLifecycle<FixtureHealth>({
      baseUrl,
      parseHealth,
      pidFile,
      command: [process.execPath, "run", join(directory, "daemon.ts"), String(new URL(baseUrl).port), "1.0.0"],
      cwd: directory,
      logFile,
      versionCheck: { expected: "1.0.0", of: (health) => health.version },
      cleanupFiles: [authFile],
      timeouts: { health: 500, start: 5_000, concurrentStart: 300, stop: 2_000 },
      onEvent: (event) => events.push(event),
    });

    const fresh = await upgraded.ensure();
    spawned.push(fresh.pid);

    expect(fresh.version).toBe("1.0.0");
    expect(fresh.pid).not.toBe(old.pid);
    expect(events[0]).toEqual({ type: "version-mismatch", running: "0.9.0", expected: "1.0.0" });
  }, 20_000);

  test("a daemon someone else is starting is waited for, not raced", async () => {
    const { lifecycle, pidFile, events } = createFixture();
    // A live pid with nothing healthy yet: this process stands in for the daemon
    // that another CLI spawned a moment ago.
    writeFileSync(pidFile, `${process.pid}\n`);

    const started = Date.now();
    const health = await lifecycle.ensure();
    spawned.push(health.pid);

    expect(Date.now() - started).toBeGreaterThanOrEqual(300);
    expect(events.map((event) => event.type)).toEqual(["starting", "started"]);
  }, 15_000);

  test("a daemon that never comes up reports its log", async () => {
    const { lifecycle, logFile } = createFixture({ crashing: true });

    const failure = await lifecycle.start().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DaemonStartError);
    if (!(failure instanceof DaemonStartError)) throw failure;
    expect(failure.logFile).toBe(logFile);
    expect(failure.logTail).toContain("fixture daemon refused to start");
  }, 15_000);
});

describe("stop", () => {
  test("stops the daemon and clears its files", async () => {
    const { lifecycle, pidFile, authFile } = createFixture();
    const health = await lifecycle.ensure();
    spawned.push(health.pid);
    writeFileSync(authFile, "token");

    const result = await lifecycle.stop();
    expect(result).toMatchObject({ stopped: true, reason: "stopped", pid: health.pid });
    expect(existsSync(pidFile)).toBe(false);
    expect(existsSync(authFile)).toBe(false);
    expect(await lifecycle.isRunning()).toBe(false);
  }, 15_000);

  test("nothing running and no pid file is not an error", async () => {
    const { lifecycle } = createFixture();
    expect(await lifecycle.stop()).toMatchObject({ stopped: false, reason: "not-running" });
  });

  test("a stale pid file is cleaned up, never signalled", async () => {
    const { lifecycle, pidFile, authFile } = createFixture();
    writeFileSync(pidFile, "999999\n");
    writeFileSync(authFile, "token");

    const result = await lifecycle.stop();
    expect(result).toMatchObject({ stopped: false, reason: "stale-pid", pid: 999999 });
    expect(existsSync(pidFile)).toBe(false);
    expect(existsSync(authFile)).toBe(false);
  });

  test("refuses to signal itself", async () => {
    const server = Bun.serve({
      port: 0,
      hostname: "localhost",
      fetch: () => Response.json({ ok: true, version: "1.0.0", pid: process.pid }),
    });
    servers.push(server);
    const directory = mkdtempSync(join(tmpdir(), "canvas-lifecycle-test-"));
    directories.push(directory);

    const lifecycle = createDaemonLifecycle<FixtureHealth>({
      baseUrl: `http://localhost:${portOf(server)}`,
      parseHealth,
      pidFile: join(directory, "daemon.pid"),
      command: [process.execPath, "--version"],
      logFile: join(directory, "daemon.log"),
    });

    const result = await lifecycle.stop();
    expect(result).toMatchObject({ stopped: false, reason: "refused-self", pid: process.pid });
  });
});
