/**
 * Tests for the remote feedback poller. Uses a real SessionManager with
 * a real share recorded on a session, and mocks `fetch` to simulate
 * worker responses. Verifies persistence, broadcast, dedup, and backoff.
 */

import { describe, expect, test, afterEach, beforeEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { SessionManager } from "./session";
import { startRemoteFeedbackPoller } from "./remote-feedback";

let testDir: string;
beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "canvas-rf-test-"));
});
afterEach(() => {
  try { rmSync(testDir, { recursive: true, force: true }); } catch {}
});

function newSessionManager(): SessionManager {
  return new SessionManager(testDir);
}

const originalFetch = globalThis.fetch;
const originalEndpoint = process.env.CANVAS_SHARE_ENDPOINT;

beforeEach(() => {
  process.env.CANVAS_SHARE_ENDPOINT = "https://mock.example.com";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalEndpoint !== undefined) process.env.CANVAS_SHARE_ENDPOINT = originalEndpoint;
  else delete process.env.CANVAS_SHARE_ENDPOINT;
});

function setupSession(sm: SessionManager): { sessionId: string; shareId: string } {
  const sessionId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const shareId = "abc123def456";
  sm.upsert(sessionId, new Map([["plan.jsx", "x"]]), "/tmp");
  sm.saveCompiled(sessionId, "plan.jsx", "x");
  sm.addShare(sessionId, {
    shareId,
    url: "https://mock.example.com/s/" + shareId,
    revision: 1,
    createdAt: new Date().toISOString(),
  });
  return { sessionId, shareId };
}

describe("startRemoteFeedbackPoller", () => {
  test("persists fetched entries and updates lastFeedbackAt", async () => {
    const sm = newSessionManager();
    const { sessionId, shareId } = setupSession(sm);

    let calls = 0;
    (globalThis as any).fetch = async (url: any) => {
      calls++;
      expect(String(url)).toContain(`/shares/${shareId}/feedback`);
      return new Response(JSON.stringify({
        entries: [{
          id: "fb1",
          shareId,
          revision: 1,
          submittedAt: "2026-04-09T10:00:00.000Z",
          author: { id: "u1", name: "Alice" },
          annotations: [{
            id: "a1",
            snippet: "x",
            note: "good",
            createdAt: "2026-04-09T10:00:00.000Z",
          }],
        }],
        latestAt: "2026-04-09T10:00:00.000Z",
      }), { status: 200 });
    };

    let broadcasted: { sessionId: string; revision: number; count: number }[] = [];
    const broadcast = (sid: string, rev: number, entries: any[]) => {
      broadcasted.push({ sessionId: sid, revision: rev, count: entries.length });
    };

    const poller = startRemoteFeedbackPoller(sm, broadcast, "0.0.0");
    // Wait for at least one poll cycle
    await new Promise((r) => setTimeout(r, 100));
    poller.stop();

    expect(calls).toBeGreaterThanOrEqual(1);
    expect(broadcasted.length).toBeGreaterThanOrEqual(1);
    expect(broadcasted[0].sessionId).toBe(sessionId);
    expect(broadcasted[0].revision).toBe(1);
    expect(broadcasted[0].count).toBe(1);

    const persisted = sm.getRemoteFeedback(sessionId, 1);
    expect(persisted).toHaveLength(1);
    expect(persisted[0].id).toBe("fb1");
    expect(persisted[0].author.name).toBe("Alice");

    const updatedShare = sm.getShares(sessionId).find((s) => s.shareId === shareId);
    expect(updatedShare?.lastFeedbackAt).toBe("2026-04-09T10:00:00.000Z");

    sm.remove(sessionId);
  });

  test("dedupes entries by id across polls", async () => {
    const sm = newSessionManager();
    const { sessionId } = setupSession(sm);

    const sameEntry = {
      id: "fb-same",
      shareId: "abc123def456",
      revision: 1,
      submittedAt: "2026-04-09T10:00:00.000Z",
      author: { id: "u1", name: "Bob" },
      annotations: [],
    };

    (globalThis as any).fetch = async () => new Response(JSON.stringify({ entries: [sameEntry] }), { status: 200 });

    const poller = startRemoteFeedbackPoller(sm, () => {}, "0.0.0");
    await new Promise((r) => setTimeout(r, 200));
    poller.stop();

    // Even after multiple polls returning the same entry, only one should be persisted.
    const persisted = sm.getRemoteFeedback(sessionId, 1);
    expect(persisted).toHaveLength(1);

    sm.remove(sessionId);
  });

  test("404 stops further polls (revoked share)", async () => {
    const sm = newSessionManager();
    const { sessionId, shareId } = setupSession(sm);

    let calls = 0;
    (globalThis as any).fetch = async () => {
      calls++;
      return new Response("not found", { status: 404 });
    };

    const poller = startRemoteFeedbackPoller(sm, () => {}, "0.0.0");
    await new Promise((r) => setTimeout(r, 200));
    poller.stop();

    // After the first 404 the share is marked dead — calls should stay at 1.
    expect(calls).toBe(1);
    void shareId;
    sm.remove(sessionId);
  });

  test("does nothing when no shares exist", async () => {
    const sm = newSessionManager();
    let calls = 0;
    (globalThis as any).fetch = async () => { calls++; return new Response("", { status: 200 }); };

    const poller = startRemoteFeedbackPoller(sm, () => {}, "0.0.0");
    await new Promise((r) => setTimeout(r, 100));
    poller.stop();

    expect(calls).toBe(0);
  });

  test("does nothing when CANVAS_SHARE_ENDPOINT not set", async () => {
    delete process.env.CANVAS_SHARE_ENDPOINT;

    const sm = newSessionManager();
    setupSession(sm);
    let calls = 0;
    (globalThis as any).fetch = async () => { calls++; return new Response("", { status: 200 }); };

    const poller = startRemoteFeedbackPoller(sm, () => {}, "0.0.0");
    await new Promise((r) => setTimeout(r, 100));
    poller.stop();

    expect(calls).toBe(0);
  });
});
