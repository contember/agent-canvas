/**
 * Unit tests for the share packager. Uses a temp directory to back a real
 * SessionManager so we exercise the actual disk persistence path. The
 * worker push itself is mocked via fetch override.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { SessionManager } from "./session";
import { buildSharePayload, pushShareToWorker, shareRevision, loadShareConfig } from "./share";

let testDir: string;
let originalSessionsDir: string | undefined;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "canvas-share-test-"));
  // Override SESSIONS_DIR via env (paths.ts reads at module load — for
  // these tests we instead seed a SessionManager and inject revisions
  // through its public API rather than touching its private dirs).
  originalSessionsDir = process.env.CANVAS_TEST_SESSIONS_DIR;
});

afterEach(() => {
  try { rmSync(testDir, { recursive: true, force: true }); } catch {}
  if (originalSessionsDir !== undefined) {
    process.env.CANVAS_TEST_SESSIONS_DIR = originalSessionsDir;
  } else {
    delete process.env.CANVAS_TEST_SESSIONS_DIR;
  }
});

describe("loadShareConfig", () => {
  test("returns default endpoint when env not set", () => {
    const before = process.env.CANVAS_SHARE_ENDPOINT;
    delete process.env.CANVAS_SHARE_ENDPOINT;
    const cfg = loadShareConfig("0.0.0");
    expect(cfg).not.toBeNull();
    expect(cfg?.endpoint).toBe("https://canvas.contember.com");
    if (before) process.env.CANVAS_SHARE_ENDPOINT = before;
  });

  test("strips trailing slashes", () => {
    process.env.CANVAS_SHARE_ENDPOINT = "https://example.com/";
    const cfg = loadShareConfig("0.0.0");
    expect(cfg?.endpoint).toBe("https://example.com");
    delete process.env.CANVAS_SHARE_ENDPOINT;
  });

  test("includes auth token when set", () => {
    process.env.CANVAS_SHARE_ENDPOINT = "https://example.com";
    process.env.CANVAS_SHARE_AUTH_TOKEN = "secret";
    const cfg = loadShareConfig("0.0.0");
    expect(cfg?.authToken).toBe("secret");
    delete process.env.CANVAS_SHARE_ENDPOINT;
    delete process.env.CANVAS_SHARE_AUTH_TOKEN;
  });
});

describe("buildSharePayload", () => {
  test("packages compiled JS + JSX source", () => {
    const sm = new SessionManager(testDir);
    const sid = `test-${Date.now()}`;
    const files = new Map([["plan.jsx", "<Section>hi</Section>"]]);
    sm.upsert(sid, files, "/tmp", "Test label");
    sm.saveCompiled(sid, "plan.jsx", "/* compiled */ export default ()=>null");

    const payload = buildSharePayload(sm, sid, 1, "0.1.27");
    expect(payload.version).toBe(1);
    expect(payload.origin.sessionId).toBe(sid);
    expect(payload.origin.revision).toBe(1);
    expect(payload.origin.label).toBe("Test label");
    expect(payload.canvasFiles).toHaveLength(1);
    expect(payload.canvasFiles[0].filename).toBe("plan.jsx");
    expect(payload.canvasFiles[0].compiledJs).toContain("/* compiled */");
    expect(payload.canvasFiles[0].sourceJsx).toContain("<Section>hi</Section>");
    expect(payload.runtime.componentsVersion).toBe("0.1.27");

    sm.remove(sid);
  });

  test("throws when revision missing", () => {
    const sm = new SessionManager(testDir);
    const sid = `test-${Date.now()}`;
    sm.upsert(sid, new Map([["plan.jsx", "x"]]), "/tmp");
    sm.saveCompiled(sid, "plan.jsx", "x");
    expect(() => buildSharePayload(sm, sid, 99, "0.0.0")).toThrow();
    sm.remove(sid);
  });

  test("throws when no compiled JS", () => {
    const sm = new SessionManager(testDir);
    const sid = `test-${Date.now()}`;
    sm.upsert(sid, new Map([["plan.jsx", "x"]]), "/tmp");
    // Intentionally skip saveCompiled
    expect(() => buildSharePayload(sm, sid, 1, "0.0.0")).toThrow();
    sm.remove(sid);
  });
});

describe("pushShareToWorker", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });

  test("posts JSON and unwraps the response", async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    (globalThis as any).fetch = async (url: any, init: any) => {
      captured = { url: String(url), init };
      return new Response(JSON.stringify({
        shareId: "deadbeef",
        url: "https://example.com/s/deadbeef",
        ownerToken: "ot",
        expiresAt: "2026-12-31T00:00:00Z",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };

    const result = await pushShareToWorker(
      {
        version: 1,
        origin: { sessionId: "x", revision: 1, createdAt: "2026-01-01T00:00:00Z" },
        canvasFiles: [{ filename: "p.jsx", compiledJs: "x" }],
        runtime: { componentsVersion: "1.0.0" },
      },
      { endpoint: "https://example.com", componentsVersion: "1.0.0" },
    );

    expect(result.shareId).toBe("deadbeef");
    expect(result.url).toBe("https://example.com/s/deadbeef");
    expect(result.ownerToken).toBe("ot");
    expect(captured!.url).toBe("https://example.com/shares");
    expect(captured!.init.method).toBe("POST");
  });

  test("includes Authorization header when authToken set", async () => {
    let captured: any = null;
    (globalThis as any).fetch = async (_url: any, init: any) => {
      captured = init;
      return new Response(JSON.stringify({ shareId: "x", url: "x" }), { status: 200 });
    };

    await pushShareToWorker(
      {
        version: 1,
        origin: { sessionId: "x", revision: 1, createdAt: "2026-01-01T00:00:00Z" },
        canvasFiles: [{ filename: "p.jsx", compiledJs: "x" }],
        runtime: { componentsVersion: "1.0.0" },
      },
      { endpoint: "https://example.com", componentsVersion: "1.0.0", authToken: "topsecret" },
    );

    expect(captured.headers["Authorization"]).toBe("Bearer topsecret");
  });

  test("throws on non-2xx", async () => {
    (globalThis as any).fetch = async () => new Response("nope", { status: 500 });
    await expect(
      pushShareToWorker(
        {
          version: 1,
          origin: { sessionId: "x", revision: 1, createdAt: "2026-01-01T00:00:00Z" },
          canvasFiles: [{ filename: "p.jsx", compiledJs: "x" }],
          runtime: { componentsVersion: "1.0.0" },
        },
        { endpoint: "https://example.com", componentsVersion: "1.0.0" },
      ),
    ).rejects.toThrow(/500/);
  });

  test("throws on malformed response", async () => {
    (globalThis as any).fetch = async () => new Response(JSON.stringify({ shareId: "x" }), { status: 200 });
    await expect(
      pushShareToWorker(
        {
          version: 1,
          origin: { sessionId: "x", revision: 1, createdAt: "2026-01-01T00:00:00Z" },
          canvasFiles: [{ filename: "p.jsx", compiledJs: "x" }],
          runtime: { componentsVersion: "1.0.0" },
        },
        { endpoint: "https://example.com", componentsVersion: "1.0.0" },
      ),
    ).rejects.toThrow(/invalid response/);
  });
});

describe("shareRevision", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });

  test("records share entry on the session", async () => {
    (globalThis as any).fetch = async () =>
      new Response(JSON.stringify({
        shareId: "abc123def456",
        url: "https://example.com/s/abc123def456",
        ownerToken: "owner",
        expiresAt: "2026-12-31T00:00:00Z",
      }), { status: 200 });

    const sm = new SessionManager(testDir);
    const sid = `test-${Date.now()}`;
    sm.upsert(sid, new Map([["plan.jsx", "x"]]), "/tmp");
    sm.saveCompiled(sid, "plan.jsx", "x");

    const entry = await shareRevision(sm, sid, 1, {
      endpoint: "https://example.com",
      componentsVersion: "1.0.0",
    });

    expect(entry.shareId).toBe("abc123def456");
    expect(entry.revision).toBe(1);
    expect(entry.ownerToken).toBe("owner");
    expect(entry.expiresAt).toBe("2026-12-31T00:00:00Z");

    const shares = sm.getShares(sid);
    expect(shares).toHaveLength(1);
    expect(shares[0].shareId).toBe("abc123def456");

    sm.remove(sid);
  });
});

void mkdirSync;
void writeFileSync;
