/**
 * Behaviour tests for the session/revision store: pushes, revision reads, line
 * diff stats, the feedback lifecycle, drafts, compiled output and stale
 * cleanup. The secret vault is covered by session-secrets.test.ts.
 */

import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SessionManager } from "./session";
import type { RevisionInfo, SessionData } from "./session";

const PROJECT_ROOT = "/projects/alpha";
const FIRST_PUSH = "2026-03-01T10:00:00.000Z";
const SECOND_PUSH = "2026-03-01T11:30:00.000Z";

const testDirectories: string[] = [];

/** Isolated sessions root so tests never touch the user's real sessions. */
function createDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "agent-canvas-revisions-"));
  testDirectories.push(directory);
  return directory;
}

/** Single-file payload for pushes where the file set is not the point. */
function planCanvas(jsx: string): Map<string, string> {
  return new Map([["plan.jsx", jsx]]);
}

function requireSession(manager: SessionManager, id: string): SessionData {
  const session = manager.get(id);
  if (!session) throw new Error(`session "${id}" is missing`);
  return session;
}

function requireRevision(session: SessionData, revision: number): RevisionInfo {
  const info = session.revisions.find((r) => r.revision === revision);
  if (!info) throw new Error(`revision ${revision} is missing`);
  return info;
}

function sessionIds(manager: SessionManager): string[] {
  return manager.list().map((s) => s.id).sort();
}

afterEach(() => {
  setSystemTime();
  for (const directory of testDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("session upsert", () => {
  test("records the first revision with its files, label and creation time", () => {
    setSystemTime(new Date(FIRST_PUSH));
    const manager = new SessionManager(createDirectory());

    const session = manager.upsert("plan", planCanvas("<Section>one</Section>"), PROJECT_ROOT, "First draft");

    expect(session.currentRevision).toBe(1);
    expect(session.canvasFiles).toEqual(["plan.jsx"]);
    expect(session.projectRoot).toBe(PROJECT_ROOT);
    expect(session.createdAt).toBe(FIRST_PUSH);
    expect(session.updatedAt).toBe(FIRST_PUSH);
    // Nothing to diff against on the first push, and feedback starts pending.
    expect(session.revisions).toEqual([{
      revision: 1,
      canvasFiles: [{ filename: "plan.jsx" }],
      createdAt: FIRST_PUSH,
      hasFeedback: false,
      feedbackConsumed: false,
      label: "First draft",
    }]);
  });

  test("a second push appends revision 2 and leaves revision 1 intact", () => {
    const manager = new SessionManager(createDirectory());
    setSystemTime(new Date(FIRST_PUSH));
    manager.upsert("plan", planCanvas("<Section>one</Section>"), PROJECT_ROOT, "First draft");

    setSystemTime(new Date(SECOND_PUSH));
    const session = manager.upsert("plan", planCanvas("<Section>two</Section>"), PROJECT_ROOT, "Second draft");

    expect(session.currentRevision).toBe(2);
    expect(session.revisions.map((r) => r.revision)).toEqual([1, 2]);
    expect(session.createdAt).toBe(FIRST_PUSH);
    expect(session.updatedAt).toBe(SECOND_PUSH);

    const second = requireRevision(session, 2);
    expect(second.label).toBe("Second draft");
    expect(second.createdAt).toBe(SECOND_PUSH);
    expect(second.hasFeedback).toBe(false);
    expect(second.feedbackConsumed).toBe(false);
    expect(requireRevision(session, 1).label).toBe("First draft");
  });

  test("keeps numbering revisions upwards after a restart", () => {
    const directory = createDirectory();
    const manager = new SessionManager(directory);
    manager.upsert("plan", planCanvas("<Section>one</Section>"), PROJECT_ROOT);
    manager.upsert("plan", planCanvas("<Section>two</Section>"), PROJECT_ROOT);

    // Revision numbers key browser drafts, so a restart must not recycle them.
    const reopened = new SessionManager(directory);
    expect(reopened.get("plan")?.currentRevision).toBe(2);

    const session = reopened.upsert("plan", planCanvas("<Section>three</Section>"), PROJECT_ROOT);
    expect(session.currentRevision).toBe(3);
    expect(session.revisions.map((r) => r.revision)).toEqual([1, 2, 3]);
    expect(reopened.readRevisionJsx("plan", 1, "plan.jsx")).toBe("<Section>one</Section>");
  });

  test("locks projectRoot to the directory the session was created in", () => {
    const directory = createDirectory();
    const manager = new SessionManager(directory);
    manager.upsert("plan", planCanvas("<Section>one</Section>"), PROJECT_ROOT);

    // A push from another cwd must not repoint project-relative file reads.
    const updated = manager.upsert("plan", planCanvas("<Section>two</Section>"), "/projects/beta");

    expect(updated.projectRoot).toBe(PROJECT_ROOT);
    expect(new SessionManager(directory).get("plan")?.projectRoot).toBe(PROJECT_ROOT);
  });

  test("tracks the current file set while older revisions keep their own", () => {
    const manager = new SessionManager(createDirectory());
    manager.upsert("plan", new Map([
      ["plan.jsx", "<Section>plan</Section>"],
      ["notes.jsx", "<Section>notes</Section>"],
    ]), PROJECT_ROOT);

    const session = manager.upsert("plan", new Map([
      ["plan.jsx", "<Section>plan v2</Section>"],
      ["extra.jsx", "<Section>extra</Section>"],
    ]), PROJECT_ROOT);

    // Dropped files leave the current set; new ones are appended, not prepended.
    expect(session.canvasFiles).toEqual(["plan.jsx", "extra.jsx"]);
    expect(manager.getRevisionCanvasFiles("plan", 1)).toEqual(["notes.jsx", "plan.jsx"]);
    expect(manager.getRevisionCanvasFiles("plan", 2)).toEqual(["extra.jsx", "plan.jsx"]);
    expect(manager.readRevisionJsx("plan", 1, "notes.jsx")).toBe("<Section>notes</Section>");
  });

  test("carries the optional response and canvas scope onto the revision", () => {
    const directory = createDirectory();
    const manager = new SessionManager(directory);
    manager.upsert("plan", planCanvas("<Section>one</Section>"), PROJECT_ROOT, "First draft");
    manager.upsert(
      "plan",
      planCanvas("<Section>two</Section>"),
      PROJECT_ROOT,
      "Second draft",
      "Addressed the review notes",
      { kind: "view", filename: "plan.jsx" },
    );

    const session = requireSession(new SessionManager(directory), "plan");
    const first = requireRevision(session, 1);
    const second = requireRevision(session, 2);

    expect(first.response).toBeUndefined();
    // Absence of a scope is the marker for legacy metadata, so it must not be invented.
    expect(first.canvasScope).toBeUndefined();
    expect(second.response).toBe("Addressed the review notes");
    expect(second.canvasScope).toEqual({ kind: "view", filename: "plan.jsx" });
  });
});

describe("revision reads", () => {
  test("readRevisionJsx returns each revision's own source", () => {
    const manager = new SessionManager(createDirectory());
    manager.upsert("plan", planCanvas("<Section>one</Section>"), PROJECT_ROOT);
    manager.upsert("plan", planCanvas("<Section>two</Section>"), PROJECT_ROOT);

    expect(manager.readRevisionJsx("plan", 1, "plan.jsx")).toBe("<Section>one</Section>");
    expect(manager.readRevisionJsx("plan", 2, "plan.jsx")).toBe("<Section>two</Section>");
  });

  test("readRevisionJsx returns null for an unknown session, revision or file", () => {
    const manager = new SessionManager(createDirectory());
    manager.upsert("plan", planCanvas("<Section>one</Section>"), PROJECT_ROOT);

    // Callers branch on null; a throw here would take the daemon's route down.
    expect(manager.readRevisionJsx("missing", 1, "plan.jsx")).toBeNull();
    expect(manager.readRevisionJsx("plan", 99, "plan.jsx")).toBeNull();
    expect(manager.readRevisionJsx("plan", 1, "other.jsx")).toBeNull();
  });

  test("getRevisionJsxPath points at the file stored for that revision", () => {
    const manager = new SessionManager(createDirectory());
    manager.upsert("plan", planCanvas("<Section>one</Section>"), PROJECT_ROOT);
    manager.upsert("plan", planCanvas("<Section>two</Section>"), PROJECT_ROOT);

    const firstPath = manager.getRevisionJsxPath("plan", 1, "plan.jsx");
    expect(readFileSync(firstPath, "utf-8")).toBe("<Section>one</Section>");
    expect(readFileSync(manager.getRevisionJsxPath("plan", 2, "plan.jsx"), "utf-8")).toBe("<Section>two</Section>");
    expect(manager.getRevisionJsxPath("plan", 2, "plan.jsx")).not.toBe(firstPath);
  });

  test("getRevisionCanvasFiles lists only canvases, and nothing for unknown revisions", () => {
    const manager = new SessionManager(createDirectory());
    manager.upsert("plan", planCanvas("<Section>one</Section>"), PROJECT_ROOT);
    // Compiled output, feedback and drafts share the revision directory.
    manager.saveCompiled("plan", "plan.jsx", "export default () => null");
    manager.saveFeedback("plan", 1, "looks good");
    manager.saveResponses("plan", 1, { draft: true });

    expect(manager.getRevisionCanvasFiles("plan", 1)).toEqual(["plan.jsx"]);
    expect(manager.getRevisionCanvasFiles("missing", 1)).toEqual([]);
    expect(manager.getRevisionCanvasFiles("plan", 99)).toEqual([]);
  });

  test("get and list expose sessions, remove erases them from disk too", () => {
    const directory = createDirectory();
    const manager = new SessionManager(directory);
    manager.upsert("alpha", planCanvas("<Section>a</Section>"), PROJECT_ROOT);
    manager.upsert("beta", planCanvas("<Section>b</Section>"), PROJECT_ROOT);

    expect(sessionIds(manager)).toEqual(["alpha", "beta"]);
    expect(manager.get("alpha")?.currentRevision).toBe(1);
    expect(manager.get("missing")).toBeUndefined();

    manager.remove("alpha");

    expect(manager.get("alpha")).toBeUndefined();
    expect(sessionIds(manager)).toEqual(["beta"]);
    // A removed session must not come back when the daemon restarts.
    expect(sessionIds(new SessionManager(directory))).toEqual(["beta"]);
    expect(() => manager.remove("missing")).not.toThrow();
  });
});

describe("line diff stats", () => {
  const base = "line one\nline two\nline three";

  test("counts added, removed and replaced lines per file", () => {
    const manager = new SessionManager(createDirectory());
    manager.upsert("plan", new Map([
      ["unchanged.jsx", base],
      ["added.jsx", base],
      ["removed.jsx", base],
      ["replaced.jsx", base],
    ]), PROJECT_ROOT);

    const session = manager.upsert("plan", new Map([
      ["unchanged.jsx", base],
      ["added.jsx", "line one\nline two\nline two and a half\nline three"],
      ["removed.jsx", "line one\nline three"],
      ["replaced.jsx", "line one\nline 2\nline three"],
    ]), PROJECT_ROOT);

    expect(requireRevision(session, 2).canvasFiles).toEqual([
      { filename: "unchanged.jsx", diffStats: { added: 0, removed: 0 } },
      { filename: "added.jsx", diffStats: { added: 1, removed: 0 } },
      { filename: "removed.jsx", diffStats: { added: 0, removed: 1 } },
      { filename: "replaced.jsx", diffStats: { added: 1, removed: 1 } },
    ]);
  });

  test("a file first seen in this revision has no diff stats", () => {
    const manager = new SessionManager(createDirectory());
    manager.upsert("plan", planCanvas(base), PROJECT_ROOT);

    const session = manager.upsert("plan", new Map([
      ["plan.jsx", base],
      ["extra.jsx", base],
    ]), PROJECT_ROOT);

    // No earlier version exists, so there is no diff — not a diff of zero.
    expect(requireRevision(session, 2).canvasFiles).toEqual([
      { filename: "plan.jsx", diffStats: { added: 0, removed: 0 } },
      { filename: "extra.jsx" },
    ]);
  });

  test("diffs against the previous revision, including after a restart", () => {
    const directory = createDirectory();
    const manager = new SessionManager(directory);
    manager.upsert("plan", planCanvas(base), PROJECT_ROOT);
    manager.upsert("plan", planCanvas("line one\nline two\nline two and a half\nline three"), PROJECT_ROOT);

    // Reverting to the original text is one removal against revision 2,
    // not a no-op against revision 1.
    const session = new SessionManager(directory).upsert("plan", planCanvas(base), PROJECT_ROOT);

    expect(requireRevision(session, 3).canvasFiles).toEqual([
      { filename: "plan.jsx", diffStats: { added: 0, removed: 1 } },
    ]);
  });
});

describe("feedback lifecycle", () => {
  function seedRevisions(manager: SessionManager, count: number): void {
    for (let i = 1; i <= count; i++) {
      manager.upsert("plan", planCanvas(`<Section>v${i}</Section>`), PROJECT_ROOT);
    }
  }

  test("saved feedback reads back on its own revision and flags it pending", () => {
    const manager = new SessionManager(createDirectory());
    seedRevisions(manager, 2);

    manager.saveFeedback("plan", 1, "first round");
    manager.saveFeedback("plan", 2, "second round");

    expect(manager.getFeedback("plan", 1)).toBe("first round");
    expect(manager.getFeedback("plan", 2)).toBe("second round");
    const session = requireSession(manager, "plan");
    expect(requireRevision(session, 1).hasFeedback).toBe(true);
    expect(requireRevision(session, 1).feedbackConsumed).toBe(false);
  });

  test("feedback arriving counts as activity on the session", () => {
    const directory = createDirectory();
    setSystemTime(new Date(FIRST_PUSH));
    const manager = new SessionManager(directory);
    seedRevisions(manager, 1);
    expect(requireSession(manager, "plan").updatedAt).toBe(FIRST_PUSH);

    const reviewed = "2026-03-02T09:00:00.000Z";
    setSystemTime(new Date(reviewed));
    manager.saveFeedback("plan", 1, "please shorten step 3");

    // The daemon orders its session list by this and cleanupStale reaps by it,
    // so a session left looking untouched can be dropped with feedback pending.
    expect(requireSession(manager, "plan").updatedAt).toBe(reviewed);
    expect(requireSession(new SessionManager(directory), "plan").updatedAt).toBe(reviewed);
  });

  test("remote feedback counts too", () => {
    setSystemTime(new Date(FIRST_PUSH));
    const manager = new SessionManager(createDirectory());
    seedRevisions(manager, 1);

    const reviewed = "2026-03-02T09:00:00.000Z";
    setSystemTime(new Date(reviewed));
    manager.appendRemoteFeedback("plan", 1, [{
      id: "rf-1",
      shareId: "share-1",
      revision: 1,
      submittedAt: reviewed,
      author: { id: "u1", name: "Ana" },
      annotations: [],
    }]);

    expect(requireSession(manager, "plan").updatedAt).toBe(reviewed);
  });

  test("an empty batch of remote feedback is not activity", () => {
    setSystemTime(new Date(FIRST_PUSH));
    const manager = new SessionManager(createDirectory());
    seedRevisions(manager, 1);

    setSystemTime(new Date("2026-03-02T09:00:00.000Z"));
    manager.appendRemoteFeedback("plan", 1, []);

    // Polling the worker and finding nothing is not something that happened.
    expect(requireSession(manager, "plan").updatedAt).toBe(FIRST_PUSH);
  });

  test("getFeedback returns null when nothing was saved", () => {
    const manager = new SessionManager(createDirectory());
    seedRevisions(manager, 1);

    expect(manager.getFeedback("plan", 1)).toBeNull();
    expect(manager.getFeedback("plan", 99)).toBeNull();
    expect(manager.getFeedback("missing", 1)).toBeNull();
  });

  test("getLatestUnconsumedFeedback walks newest first and empties out", () => {
    const manager = new SessionManager(createDirectory());
    seedRevisions(manager, 3);
    manager.saveFeedback("plan", 1, "first round");
    manager.saveFeedback("plan", 2, "second round");

    // The agent must answer the newest review, not the oldest pending one.
    expect(manager.getLatestUnconsumedFeedback("plan")).toEqual({ revision: 2, feedback: "second round" });

    manager.consumeFeedback("plan", 2);
    expect(manager.getLatestUnconsumedFeedback("plan")).toEqual({ revision: 1, feedback: "first round" });

    manager.consumeFeedback("plan", 1);
    expect(manager.getLatestUnconsumedFeedback("plan")).toBeNull();
    expect(manager.getLatestUnconsumedFeedback("missing")).toBeNull();
  });

  test("consumption survives a restart while the text stays readable", () => {
    const directory = createDirectory();
    const manager = new SessionManager(directory);
    seedRevisions(manager, 1);
    manager.saveFeedback("plan", 1, "first round");
    manager.consumeFeedback("plan", 1);

    // Otherwise a daemon restart would re-deliver feedback already acted on.
    const reopened = new SessionManager(directory);
    expect(reopened.getLatestUnconsumedFeedback("plan")).toBeNull();
    expect(reopened.getFeedback("plan", 1)).toBe("first round");
  });

  test("new feedback on a consumed revision becomes pending again", () => {
    const manager = new SessionManager(createDirectory());
    seedRevisions(manager, 1);
    manager.saveFeedback("plan", 1, "first round");
    manager.consumeFeedback("plan", 1);

    manager.saveFeedback("plan", 1, "second thoughts");

    expect(manager.getLatestUnconsumedFeedback("plan")).toEqual({ revision: 1, feedback: "second thoughts" });
  });

  test("a revision flagged for feedback whose file vanished falls through to an older one", () => {
    const manager = new SessionManager(createDirectory());
    seedRevisions(manager, 2);
    manager.saveFeedback("plan", 1, "first round");
    manager.saveFeedback("plan", 2, "second round");

    // Public path helper, so the test does not hardcode the on-disk layout.
    rmSync(manager.getRevisionJsxPath("plan", 2, "feedback.md"));

    expect(manager.getFeedback("plan", 2)).toBeNull();
    expect(manager.getLatestUnconsumedFeedback("plan")).toEqual({ revision: 1, feedback: "first round" });
  });

  test("consumeFeedback ignores unknown sessions and revisions", () => {
    const manager = new SessionManager(createDirectory());
    seedRevisions(manager, 1);
    manager.saveFeedback("plan", 1, "first round");

    expect(() => manager.consumeFeedback("missing", 1)).not.toThrow();
    expect(() => manager.consumeFeedback("plan", 99)).not.toThrow();

    // A stray consume must not clear a real pending review.
    expect(manager.getLatestUnconsumedFeedback("plan")).toEqual({ revision: 1, feedback: "first round" });
  });
});

describe("drafts and compiled output", () => {
  test("responses round-trip per revision and survive a restart", () => {
    const directory = createDirectory();
    const manager = new SessionManager(directory);
    manager.upsert("plan", planCanvas("<Section>one</Section>"), PROJECT_ROOT);
    manager.upsert("plan", planCanvas("<Section>two</Section>"), PROJECT_ROOT);
    const payload = { annotations: [{ id: "a1", note: "tighten this" }], generalNote: "work in progress" };

    manager.saveResponses("plan", 1, payload);

    expect(manager.getResponses("plan", 1)).toEqual(payload);
    // A draft belongs to the revision it was written against.
    expect(manager.getResponses("plan", 2)).toBeNull();
    expect(manager.getResponses("missing", 1)).toBeNull();
    // Server-side drafts exist to outlive the browser, so disk is the store.
    expect(new SessionManager(directory).getResponses("plan", 1)).toEqual(payload);
  });

  test("compiled output is stored and served per revision", () => {
    const manager = new SessionManager(createDirectory());
    manager.upsert("plan", planCanvas("<Section>one</Section>"), PROJECT_ROOT);
    manager.saveCompiled("plan", "plan.jsx", "/* build 1 */");

    expect(manager.getCompiled("plan", "plan.jsx")).toBe("/* build 1 */");

    manager.upsert("plan", planCanvas("<Section>two</Section>"), PROJECT_ROOT);

    // Serving build 1 to revision 2 would show the browser the old canvas.
    expect(manager.getCompiled("plan", "plan.jsx")).toBeNull();
    manager.saveCompiled("plan", "plan.jsx", "/* build 2 */");
    expect(manager.getCompiled("plan", "plan.jsx")).toBe("/* build 2 */");
    expect(manager.getCompiled("plan", "plan.jsx", 1)).toBe("/* build 1 */");
  });

  test("compiled reads and writes are inert for an unknown session", () => {
    const directory = createDirectory();
    const manager = new SessionManager(directory);

    expect(manager.getCompiled("missing", "plan.jsx")).toBeNull();
    expect(() => manager.saveCompiled("missing", "plan.jsx", "/* build */")).not.toThrow();
    // A compile write must not materialise a session that was never pushed.
    expect(readdirSync(directory)).toEqual([]);
    expect(manager.getCompiled("missing", "plan.jsx")).toBeNull();
  });
});

describe("cleanupStale", () => {
  test("drops sessions untouched beyond maxAge and keeps the rest", () => {
    const directory = createDirectory();
    const manager = new SessionManager(directory);
    setSystemTime(new Date("2026-03-01T00:00:00.000Z"));
    manager.upsert("stale", planCanvas("<Section>old</Section>"), PROJECT_ROOT);
    setSystemTime(new Date("2026-03-01T09:00:00.000Z"));
    manager.upsert("fresh", planCanvas("<Section>new</Section>"), PROJECT_ROOT);

    setSystemTime(new Date("2026-03-01T10:00:00.000Z"));
    manager.cleanupStale(2 * 60 * 60 * 1000);

    expect(sessionIds(manager)).toEqual(["fresh"]);
    expect(sessionIds(new SessionManager(directory))).toEqual(["fresh"]);
  });

  test("a new push refreshes the session's age", () => {
    const manager = new SessionManager(createDirectory());
    setSystemTime(new Date("2026-03-01T00:00:00.000Z"));
    manager.upsert("plan", planCanvas("<Section>one</Section>"), PROJECT_ROOT);
    setSystemTime(new Date("2026-03-01T10:00:00.000Z"));
    manager.upsert("plan", planCanvas("<Section>two</Section>"), PROJECT_ROOT);

    // Age is measured from the last push, not from session creation.
    setSystemTime(new Date("2026-03-01T11:00:00.000Z"));
    manager.cleanupStale(2 * 60 * 60 * 1000);

    expect(sessionIds(manager)).toEqual(["plan"]);
  });

  test("a session is not reaped while its feedback waits to be read", () => {
    const manager = new SessionManager(createDirectory());
    setSystemTime(new Date("2026-03-01T00:00:00.000Z"));
    manager.upsert("plan", planCanvas("<Section>one</Section>"), PROJECT_ROOT);

    // The reviewer came back to it a day later; the agent has not read it yet.
    setSystemTime(new Date("2026-03-01T10:00:00.000Z"));
    manager.saveFeedback("plan", 1, "this part needs rethinking");

    setSystemTime(new Date("2026-03-01T11:00:00.000Z"));
    manager.cleanupStale(2 * 60 * 60 * 1000);

    expect(sessionIds(manager)).toEqual(["plan"]);
    expect(manager.getLatestUnconsumedFeedback("plan")?.feedback).toBe("this part needs rethinking");
  });

  test("defaults to a 24 hour cutoff", () => {
    const manager = new SessionManager(createDirectory());
    setSystemTime(new Date("2026-03-01T00:00:00.000Z"));
    manager.upsert("plan", planCanvas("<Section>one</Section>"), PROJECT_ROOT);

    setSystemTime(new Date("2026-03-01T23:00:00.000Z"));
    manager.cleanupStale();
    expect(sessionIds(manager)).toEqual(["plan"]);

    setSystemTime(new Date("2026-03-02T01:00:00.000Z"));
    manager.cleanupStale();
    expect(sessionIds(manager)).toEqual([]);
  });
});
