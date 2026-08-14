import { describe, expect, test } from "bun:test";
import { annotationDraftKey, carryUnsubmittedDraft, clearPersistedDraft } from "./annotationDraft";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const sessionId = "session";
const key = (revision: number) => annotationDraftKey(sessionId, revision);
const nextKey = (revision: number) => annotationDraftKey(sessionId, revision, "next");

describe("carryUnsubmittedDraft", () => {
  test("clears a submitted draft and its carry marker", () => {
    const storage = new MemoryStorage();
    storage.setItem(key(2), JSON.stringify({ generalNote: "Submitted" }));
    storage.setItem(`${key(2)}:draft-handled`, "1");

    clearPersistedDraft(storage, sessionId, 2);

    expect(storage.getItem(key(2))).toBeNull();
    expect(storage.getItem(`${key(2)}:draft-handled`)).toBeNull();
  });

  test("carries the latest unsent draft into a new revision", () => {
    const storage = new MemoryStorage();
    storage.setItem(key(2), JSON.stringify({
      annotations: [{ id: "annotation-1" }],
      generalNote: "Review in progress",
      responses: [["choice", { value: "keep" }]],
      feedbackEntries: [["old", { markdown: "stale generated content" }]],
    }));
    storage.setItem(key(3), JSON.stringify({
      annotations: [],
      generalNote: "",
      responses: [["new-choice", { value: null }]],
      feedbackEntries: [["new", { markdown: "generated content" }]],
    }));

    const sourceRevision = carryUnsubmittedDraft(storage, sessionId, 3, [
      { revision: 1, hasFeedback: true },
      { revision: 2, hasFeedback: false },
      { revision: 3, hasFeedback: false },
    ]);

    expect(sourceRevision).toBe(2);
    expect(JSON.parse(storage.getItem(key(3)) ?? "")).toEqual({
      annotations: [{ id: "annotation-1" }],
      generalNote: "Review in progress",
      responses: [["choice", { value: "keep" }]],
      feedbackEntries: [],
    });
  });

  test("does not cross a submitted revision", () => {
    const storage = new MemoryStorage();
    storage.setItem(key(1), JSON.stringify({
      annotations: [{ id: "stale-annotation" }],
      generalNote: "",
      responses: [],
    }));

    expect(carryUnsubmittedDraft(storage, sessionId, 3, [
      { revision: 1, hasFeedback: false },
      { revision: 2, hasFeedback: true },
      { revision: 3, hasFeedback: false },
    ])).toBeNull();
    expect(storage.getItem(key(3))).toBeNull();
  });

  test("carries a post-feedback draft into the next revision", () => {
    const storage = new MemoryStorage();
    storage.setItem(key(2), JSON.stringify({
      annotations: [{ id: "submitted-annotation" }],
      generalNote: "Submitted feedback",
      responses: [],
    }));
    storage.setItem(nextKey(2), JSON.stringify({
      annotations: [{ id: "next-annotation" }],
      generalNote: "",
      responses: [],
      feedbackEntries: [["generated", { markdown: "stale generated content" }]],
    }));

    expect(carryUnsubmittedDraft(storage, sessionId, 3, [
      { revision: 2, hasFeedback: true },
      { revision: 3, hasFeedback: false },
    ])).toBe(2);
    expect(JSON.parse(storage.getItem(key(3)) ?? "")).toEqual({
      annotations: [{ id: "next-annotation" }],
      generalNote: "",
      responses: [],
      feedbackEntries: [],
    });
    expect(storage.getItem(nextKey(2))).toBeNull();
  });

  test("clearing submitted feedback preserves its next-revision draft", () => {
    const storage = new MemoryStorage();
    storage.setItem(key(2), JSON.stringify({ annotations: [{ id: "submitted" }] }));
    storage.setItem(nextKey(2), JSON.stringify({ annotations: [{ id: "next" }] }));

    clearPersistedDraft(storage, sessionId, 2);

    expect(storage.getItem(key(2))).toBeNull();
    expect(storage.getItem(nextKey(2))).not.toBeNull();
  });

  test("does not overwrite meaningful target data", () => {
    const storage = new MemoryStorage();
    storage.setItem(key(2), JSON.stringify({
      annotations: [{ id: "old-annotation" }],
      generalNote: "",
      responses: [],
    }));
    const current = JSON.stringify({
      annotations: [{ id: "current-annotation" }],
      generalNote: "",
      responses: [],
    });
    storage.setItem(key(3), current);

    expect(carryUnsubmittedDraft(storage, sessionId, 3, [
      { revision: 2, hasFeedback: false },
      { revision: 3, hasFeedback: false },
    ])).toBeNull();
    expect(storage.getItem(key(3))).toBe(current);
  });

  test("skips empty intermediate revision state", () => {
    const storage = new MemoryStorage();
    storage.setItem(key(2), JSON.stringify({
      annotations: [],
      generalNote: "Still drafting",
      responses: [],
    }));
    storage.setItem(key(3), JSON.stringify({
      annotations: [],
      generalNote: "",
      responses: [["choice", { value: [] }]],
      feedbackEntries: [["generated", { markdown: "not user input" }]],
    }));

    expect(carryUnsubmittedDraft(storage, sessionId, 4, [
      { revision: 1, hasFeedback: true },
      { revision: 2, hasFeedback: false },
      { revision: 3, hasFeedback: false },
      { revision: 4, hasFeedback: false },
    ])).toBe(2);
  });

  test("does not resurrect a carried draft after it is cleared", () => {
    const storage = new MemoryStorage();
    storage.setItem(key(2), JSON.stringify({
      annotations: [{ id: "annotation-1" }],
      generalNote: "",
      responses: [],
    }));
    const revisions = [
      { revision: 1, hasFeedback: true },
      { revision: 2, hasFeedback: false },
      { revision: 3, hasFeedback: false },
    ];

    expect(carryUnsubmittedDraft(storage, sessionId, 3, revisions)).toBe(2);
    const cleared = JSON.stringify({ annotations: [], generalNote: "", responses: [] });
    storage.setItem(key(3), cleared);

    expect(carryUnsubmittedDraft(storage, sessionId, 3, revisions)).toBeNull();
    expect(storage.getItem(key(3))).toBe(cleared);
    expect(carryUnsubmittedDraft(storage, sessionId, 4, [
      ...revisions,
      { revision: 4, hasFeedback: false },
    ])).toBeNull();
    expect(storage.getItem(key(4))).toBeNull();
  });
});
