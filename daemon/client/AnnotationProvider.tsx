import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { AnnotationCtx } from "#canvas/runtime";
import type { Annotation, AnnotationContext, PlanResponse, FeedbackEntry, AnnotationContextValue } from "#canvas/runtime";
import { annotationDraftKey, clearPersistedDraft, type AnnotationDraftPhase } from "./annotationDraft";
import { generateAnnotationId } from "./utils";

// Re-export types for convenience
export type { Annotation, AnnotationContext, PlanResponse, FeedbackEntry, AnnotationContextValue };
export { useAnnotations } from "#canvas/runtime";

interface AnnotationProviderProps {
  sessionId: string;
  revision: number;
  isReadOnly: boolean;
  draftPhase: AnnotationDraftPhase;
  /** Remote annotations fetched from shared views. Merged read-only into
   *  the annotation list so they render alongside the author's own. */
  remoteAnnotations?: Annotation[];
  children: React.ReactNode;
}

interface PersistedState {
  annotations: Annotation[];
  generalNote: string;
  responses: [string, PlanResponse][];
  feedbackEntries?: [string, FeedbackEntry][];
}

function loadPersisted(sessionId: string, revision: number, phase: AnnotationDraftPhase): PersistedState | null {
  try {
    const raw = localStorage.getItem(annotationDraftKey(sessionId, revision, phase));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function savePersisted(sessionId: string, revision: number, phase: AnnotationDraftPhase, state: PersistedState) {
  try {
    localStorage.setItem(annotationDraftKey(sessionId, revision, phase), JSON.stringify(state));
  } catch {}
}

export function AnnotationProvider({ sessionId, revision, isReadOnly, draftPhase, remoteAnnotations, children }: AnnotationProviderProps) {
  const [localAnnotations, setAnnotations] = useState<Annotation[]>(() => {
    const saved = loadPersisted(sessionId, revision, draftPhase);
    return (saved?.annotations ?? []).map((a) => ({ ...a, source: a.source ?? "local" as const }));
  });

  // Merge local + remote annotations. Remote annotations are always
  // rendered read-only; mutation helpers below operate on localAnnotations
  // only so they silently no-op on remote ids.
  const annotations = useMemo<Annotation[]>(() => {
    if (!remoteAnnotations || remoteAnnotations.length === 0) return localAnnotations;
    const localIds = new Set(localAnnotations.map((a) => a.id));
    const filtered = remoteAnnotations.filter((a) => !localIds.has(a.id));
    return [...localAnnotations, ...filtered.map((a) => ({ ...a, source: "remote" as const }))];
  }, [localAnnotations, remoteAnnotations]);
  const [generalNote, setGeneralNote] = useState(() => {
    const saved = loadPersisted(sessionId, revision, draftPhase);
    return saved?.generalNote ?? "";
  });
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
  const [responses, setResponses] = useState<Map<string, PlanResponse>>(() => {
    const saved = loadPersisted(sessionId, revision, draftPhase);
    return saved?.responses ? new Map(saved.responses) : new Map();
  });
  const [feedbackEntries, setFeedbackEntries] = useState<Map<string, FeedbackEntry>>(() => {
    const saved = loadPersisted(sessionId, revision, draftPhase);
    return saved?.feedbackEntries ? new Map(saved.feedbackEntries) : new Map();
  });

  // Post-feedback drafts save immediately so a new revision can carry the latest edit.
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (isReadOnly && draftPhase !== "next") return;
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    const state = {
      // Persist only local annotations — remote ones are re-fetched on load.
      annotations: localAnnotations,
      generalNote,
      responses: Array.from(responses.entries()),
      feedbackEntries: Array.from(feedbackEntries.entries()),
    };
    if (draftPhase === "next") {
      savePersisted(sessionId, revision, draftPhase, state);
      return;
    }
    persistTimerRef.current = setTimeout(() => savePersisted(sessionId, revision, draftPhase, state), 300);
    return () => { if (persistTimerRef.current) clearTimeout(persistTimerRef.current); };
  }, [localAnnotations, generalNote, responses, feedbackEntries, sessionId, revision, isReadOnly, draftPhase]);

  const addAnnotationWithId = useCallback((id: string, snippet: string, note: string, filePath?: string, context?: AnnotationContext, images?: string[], canvasFile?: string) => {
    setAnnotations((prev) => [...prev, { id, snippet, note, createdAt: new Date().toISOString(), filePath, context, ...(images?.length ? { images } : {}), ...(canvasFile ? { canvasFile } : {}) }]);
  }, []);

  const addAnnotation = useCallback((snippet: string, note: string, filePath?: string) => {
    addAnnotationWithId(generateAnnotationId(), snippet, note, filePath);
  }, [addAnnotationWithId]);

  const updateAnnotation = useCallback((id: string, note: string) => {
    setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, note } : a)));
  }, []);

  const removeAnnotation = useCallback((id: string) => {
    removeMarksFromDom(id);
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
    setActiveAnnotationId((prev) => (prev === id ? null : prev));
  }, []);

  const addAnnotationImage = useCallback((id: string, imagePath: string) => {
    setAnnotations((prev) => prev.map((a) =>
      a.id === id ? { ...a, images: [...(a.images || []), imagePath] } : a
    ));
  }, []);

  const removeAnnotationImage = useCallback((id: string, imagePath: string) => {
    setAnnotations((prev) => prev.map((a) =>
      a.id === id ? { ...a, images: (a.images || []).filter((p) => p !== imagePath) } : a
    ));
  }, []);

  const setResponse = useCallback((id: string, response: PlanResponse) => {
    setResponses((prev) => {
      const next = new Map(prev);
      next.set(id, response);
      return next;
    });
  }, []);

  const setFeedbackEntry = useCallback((id: string, entry: FeedbackEntry) => {
    setFeedbackEntries((prev) => {
      const existing = prev.get(id);
      if (existing && existing.markdown === entry.markdown && existing.label === entry.label && existing.required === entry.required) {
        return prev; // same reference → no re-render
      }
      const next = new Map(prev);
      next.set(id, entry);
      return next;
    });
  }, []);

  const removeFeedbackEntry = useCallback((id: string) => {
    setFeedbackEntries((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    for (const mark of document.querySelectorAll("[data-annotation-id]")) {
      unwrapMark(mark as HTMLElement);
    }
    setAnnotations([]);
    setGeneralNote("");
    setActiveAnnotationId(null);
    setResponses(new Map());
    setFeedbackEntries(new Map());
    if (draftPhase === "next") {
      localStorage.removeItem(annotationDraftKey(sessionId, revision, draftPhase));
    } else {
      clearPersistedDraft(localStorage, sessionId, revision);
    }
  }, [sessionId, revision, draftPhase]);

  return (
    <AnnotationCtx.Provider
      value={{
        annotations, addAnnotation, addAnnotationWithId, updateAnnotation, removeAnnotation, addAnnotationImage, removeAnnotationImage,
        generalNote, setGeneralNote, clearAll,
        activeAnnotationId, setActiveAnnotationId,
        responses, setResponse,
        feedbackEntries, setFeedbackEntry, removeFeedbackEntry,
      }}
    >
      {children}
    </AnnotationCtx.Provider>
  );
}

function removeMarksFromDom(id: string) {
  const marks = document.querySelectorAll(`[data-annotation-id="${id}"]`);
  for (const mark of marks) unwrapMark(mark as HTMLElement);
}

function unwrapMark(mark: HTMLElement) {
  const parent = mark.parentNode;
  if (!parent) return;
  const text = document.createTextNode(mark.textContent || "");
  parent.replaceChild(text, mark);
  parent.normalize();
}
