/**
 * The on-disk formats SessionManager still has to read: the flat pre-revision
 * layout, and the one-sourceFile-per-revision layout that came after it.
 *
 * Both migrations move and delete the user's files, and both run inside the
 * catch in loadFromDisk — so a mistake here costs work rather than raising.
 */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SessionManager } from "./session";
import type { SessionData } from "./session";

const PROJECT_ROOT = "/projects/alpha";
const CREATED_AT = "2026-02-01T08:00:00.000Z";
const UPDATED_AT = "2026-02-03T16:00:00.000Z";

const testDirectories: string[] = [];

function createDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "agent-canvas-migration-"));
  testDirectories.push(directory);
  return directory;
}

interface LegacyLayout {
  /** Revision number -> JSX, written as the flat `history/<n>.jsx` files. */
  history?: Record<number, string>;
  /** Extra files dropped in `history/` that do not name a revision. */
  historyExtras?: Record<string, string>;
  /** The working copy at the root, if the session had one. */
  current?: string;
  compiled?: string;
  version: number;
}

/** Lay out a session in the flat pre-revision format, as it exists on disk. */
function writeLegacySession(root: string, id: string, layout: LegacyLayout): string {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });

  const historyEntries = Object.entries(layout.history ?? {});
  const extras = Object.entries(layout.historyExtras ?? {});
  if (historyEntries.length > 0 || extras.length > 0) {
    mkdirSync(join(dir, "history"), { recursive: true });
    for (const [revision, jsx] of historyEntries) {
      writeFileSync(join(dir, "history", `${revision}.jsx`), jsx);
    }
    for (const [name, contents] of extras) {
      writeFileSync(join(dir, "history", name), contents);
    }
  }

  if (layout.current !== undefined) writeFileSync(join(dir, "plan.jsx"), layout.current);
  if (layout.compiled !== undefined) writeFileSync(join(dir, "plan.compiled.js"), layout.compiled);

  writeFileSync(join(dir, "meta.json"), JSON.stringify({
    projectRoot: PROJECT_ROOT,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    version: layout.version,
  }, null, 2));

  return dir;
}

function requireSession(manager: SessionManager, id: string): SessionData {
  const session = manager.get(id);
  if (!session) throw new Error(`session "${id}" is missing`);
  return session;
}

function readMeta(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, "meta.json"), "utf-8"));
}

afterEach(() => {
  for (const directory of testDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("flat pre-revision format", () => {
  test("history and working copy become numbered revisions", () => {
    const root = createDirectory();
    const dir = writeLegacySession(root, "plan", {
      history: { 1: "<Section>one</Section>", 2: "<Section>two</Section>" },
      current: "<Section>three</Section>",
      compiled: "export default function Plan() {}",
      version: 3,
    });

    const manager = new SessionManager(root);
    const session = requireSession(manager, "plan");

    expect(session.currentRevision).toBe(3);
    expect(session.canvasFiles).toEqual(["plan.jsx"]);
    expect(session.projectRoot).toBe(PROJECT_ROOT);
    expect(session.revisions.map((r) => r.revision)).toEqual([1, 2, 3]);

    // Every revision's text survives the move, under the name it now needs.
    expect(manager.readRevisionJsx("plan", 1, "plan.jsx")).toBe("<Section>one</Section>");
    expect(manager.readRevisionJsx("plan", 2, "plan.jsx")).toBe("<Section>two</Section>");
    expect(manager.readRevisionJsx("plan", 3, "plan.jsx")).toBe("<Section>three</Section>");
    expect(manager.getCompiled("plan", "plan.jsx", 3)).toBe("export default function Plan() {}");

    // The flat layout is gone, and meta.json now describes the new one.
    expect(existsSync(join(dir, "history"))).toBe(false);
    expect(existsSync(join(dir, "plan.jsx"))).toBe(false);
    expect(readMeta(dir)).not.toHaveProperty("version");
    expect(readMeta(dir).currentRevision).toBe(3);
  });

  test("a second start reads the migrated session without touching it again", () => {
    const root = createDirectory();
    const dir = writeLegacySession(root, "plan", {
      history: { 1: "<Section>one</Section>" },
      current: "<Section>two</Section>",
      version: 2,
    });

    new SessionManager(root);
    const afterFirst = readMeta(dir);

    const session = requireSession(new SessionManager(root), "plan");
    expect(session.revisions.map((r) => r.revision)).toEqual([1, 2]);
    expect(readMeta(dir)).toEqual(afterFirst);
    expect(bothRevisionsReadable(root)).toBe(true);
  });

  test("revisions are ordered by number, not by filename", () => {
    const root = createDirectory();
    writeLegacySession(root, "plan", {
      history: { 2: "<Section>two</Section>", 10: "<Section>ten</Section>" },
      current: "<Section>eleven</Section>",
      version: 11,
    });

    const session = requireSession(new SessionManager(root), "plan");

    // Sorted as text, "10.jsx" comes before "2.jsx" — and this array's order is
    // the order getLatestUnconsumedFeedback walks.
    expect(session.revisions.map((r) => r.revision)).toEqual([2, 10, 11]);
  });

  test("a file that does not name a revision does not become one", () => {
    const root = createDirectory();
    writeLegacySession(root, "plan", {
      history: { 1: "<Section>one</Section>" },
      historyExtras: { "notes.txt": "scratch", "draft.jsx": "<Section>unnumbered</Section>" },
      current: "<Section>two</Section>",
      version: 2,
    });

    const session = requireSession(new SessionManager(root), "plan");
    expect(session.revisions.map((r) => r.revision)).toEqual([1, 2]);
  });

  test("timestamps come from the legacy metadata, not from the migration run", () => {
    const root = createDirectory();
    writeLegacySession(root, "plan", {
      history: { 1: "<Section>one</Section>" },
      current: "<Section>two</Section>",
      version: 2,
    });

    const session = requireSession(new SessionManager(root), "plan");
    expect(session.createdAt).toBe(CREATED_AT);
    expect(session.updatedAt).toBe(UPDATED_AT);
    // The working copy is dated by the last write, the history by creation.
    expect(session.revisions[0]?.createdAt).toBe(CREATED_AT);
    expect(session.revisions[1]?.createdAt).toBe(UPDATED_AT);
  });

  test("a legacy session with no canvas left is not listed", () => {
    const root = createDirectory();
    writeLegacySession(root, "empty", { version: 1 });

    // Nothing to show and nothing to lose — but it is dropped without a word.
    expect(new SessionManager(root).list()).toEqual([]);
  });
});

describe("one-sourceFile-per-revision format", () => {
  test("sourceFile and diffStats become the canvasFiles list", () => {
    const root = createDirectory();
    const dir = join(root, "plan");
    mkdirSync(join(dir, "revisions", "2"), { recursive: true });
    writeFileSync(join(dir, "revisions", "2", "design.jsx"), "<Section>two</Section>");
    writeFileSync(join(dir, "meta.json"), JSON.stringify({
      projectRoot: PROJECT_ROOT,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
      currentRevision: 2,
      revisions: [
        { revision: 1, sourceFile: "design.jsx", createdAt: CREATED_AT, hasFeedback: true, feedbackConsumed: true },
        {
          revision: 2, label: "Second pass", sourceFile: "design.jsx", createdAt: UPDATED_AT,
          hasFeedback: false, feedbackConsumed: false, diffStats: { added: 4, removed: 1 },
        },
      ],
    }, null, 2));

    const session = requireSession(new SessionManager(root), "plan");

    expect(session.canvasFiles).toEqual(["design.jsx"]);
    expect(session.revisions[1]).toMatchObject({
      revision: 2,
      label: "Second pass",
      canvasFiles: [{ filename: "design.jsx", diffStats: { added: 4, removed: 1 } }],
    });
    // The feedback state each revision was in has to survive the rewrite.
    expect(session.revisions[0]).toMatchObject({ hasFeedback: true, feedbackConsumed: true });
    // Rewritten on disk, so the next start reads the current shape.
    expect(readMeta(dir).revisions).toEqual(session.revisions);
  });

  test("a revision with no sourceFile is assumed to be plan.jsx", () => {
    const root = createDirectory();
    const dir = join(root, "plan");
    mkdirSync(join(dir, "revisions", "1"), { recursive: true });
    writeFileSync(join(dir, "revisions", "1", "plan.jsx"), "<Section>one</Section>");
    writeFileSync(join(dir, "meta.json"), JSON.stringify({
      projectRoot: PROJECT_ROOT,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
      currentRevision: 1,
      revisions: [{ revision: 1, createdAt: CREATED_AT, hasFeedback: false, feedbackConsumed: false }],
    }, null, 2));

    const session = requireSession(new SessionManager(root), "plan");
    expect(session.revisions[0]?.canvasFiles).toEqual([{ filename: "plan.jsx" }]);
  });
});

describe("a session that cannot be read", () => {
  test("says so, and does not take the other sessions down with it", () => {
    const root = createDirectory();
    mkdirSync(join(root, "broken"), { recursive: true });
    writeFileSync(join(root, "broken", "meta.json"), "{ not json");
    writeLegacySession(root, "plan", { current: "<Section>one</Section>", version: 1 });

    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const manager = new SessionManager(root);

      expect(manager.list().map((s) => s.id)).toEqual(["plan"]);
      // Losing a session in silence is how a failed migration goes unnoticed.
      const messages = warn.mock.calls.map((call) => String(call[0]));
      expect(messages.some((m) => m.includes("broken"))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });
});

/** Both revisions readable after a restart — a rerun of the migration loses one. */
function bothRevisionsReadable(root: string): boolean {
  const manager = new SessionManager(root);
  return manager.readRevisionJsx("plan", 1, "plan.jsx") === "<Section>one</Section>"
    && manager.readRevisionJsx("plan", 2, "plan.jsx") === "<Section>two</Section>";
}
