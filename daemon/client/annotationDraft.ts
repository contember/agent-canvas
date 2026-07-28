interface RevisionState {
  revision: number;
  hasFeedback: boolean;
}

interface AnnotationStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function storageKey(sessionId: string, revision: number): string {
  return `canvas:${sessionId}:rev:${revision}`;
}

function handledKey(sessionId: string, revision: number): string {
  return `${storageKey(sessionId, revision)}:draft-handled`;
}

function parseState(raw: string | null): object | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? value
      : null;
  } catch {
    return null;
  }
}

function hasResponseValue(entry: unknown): boolean {
  if (!Array.isArray(entry) || entry.length < 2) return false;
  const response: unknown = entry[1];
  if (typeof response !== "object" || response === null || Array.isArray(response)) return false;

  const note = Reflect.get(response, "note");
  if (typeof note === "string" && note.trim().length > 0) return true;

  const value = Reflect.get(response, "value");
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return value !== null && value !== undefined;
}

function hasDraftContent(state: object | null): boolean {
  if (!state) return false;
  const annotations = Reflect.get(state, "annotations");
  if (Array.isArray(annotations) && annotations.length > 0) return true;

  const generalNote = Reflect.get(state, "generalNote");
  if (typeof generalNote === "string" && generalNote.trim().length > 0) return true;

  const responses = Reflect.get(state, "responses");
  return Array.isArray(responses) && responses.some(hasResponseValue);
}

/** Carry an unsent draft forward without crossing submitted revisions. */
export function carryUnsubmittedDraft(
  storage: AnnotationStorage,
  sessionId: string,
  targetRevision: number,
  revisions: RevisionState[],
): number | null {
  try {
    const targetKey = storageKey(sessionId, targetRevision);
    if (hasDraftContent(parseState(storage.getItem(targetKey)))) {
      storage.setItem(handledKey(sessionId, targetRevision), "1");
      return null;
    }
    if (storage.getItem(handledKey(sessionId, targetRevision)) !== null) return null;

    const previous = revisions
      .filter((revision) => revision.revision < targetRevision)
      .sort((left, right) => right.revision - left.revision);

    for (const revision of previous) {
      if (revision.hasFeedback) return null;

      const source = parseState(storage.getItem(storageKey(sessionId, revision.revision)));
      if (!hasDraftContent(source)) {
        if (storage.getItem(handledKey(sessionId, revision.revision)) !== null) return null;
        continue;
      }

      storage.setItem(targetKey, JSON.stringify({
        ...source,
        feedbackEntries: [],
      }));
      storage.setItem(handledKey(sessionId, targetRevision), "1");
      return revision.revision;
    }
  } catch {}

  return null;
}
