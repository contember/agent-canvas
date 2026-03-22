import React, { useState, useCallback, useEffect, useRef } from "react";
import { AnnotationCtx } from "#canvas/runtime";
import type { Annotation, AnnotationContext, PlanResponse, FeedbackEntry, AnnotationContextValue } from "#canvas/runtime";
import { generateAnnotationId } from "./utils";

// Re-export types for convenience
export type { Annotation, AnnotationContext, PlanResponse, FeedbackEntry, AnnotationContextValue };
export { useAnnotations } from "#canvas/runtime";

interface AnnotationProviderProps {
  sessionId: string;
  revision: number;
  isReadOnly: boolean;
  children: React.ReactNode;
}

interface PersistedState {
  annotations: Annotation[];
  generalNote: string;
  responses: [string, PlanResponse][];
  feedbackEntries?: [string, FeedbackEntry][];
}

function storageKey(sessionId: string, revision: number): string {
  return `canvas:${sessionId}:rev:${revision}`;
}

function loadPersisted(sessionId: string, revision: number): PersistedState | null {
  try {
    const raw = localStorage.getItem(storageKey(sessionId, revision));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function savePersisted(sessionId: string, revision: number, state: PersistedState) {
  try {
    localStorage.setItem(storageKey(sessionId, revision), JSON.stringify(state));
  } catch {}
}

function clearPersisted(sessionId: string, revision: number) {
  try {
    localStorage.removeItem(storageKey(sessionId, revision));
  } catch {}
}

export function AnnotationProvider({ sessionId, revision, isReadOnly, children }: AnnotationProviderProps) {
  const [annotations, setAnnotations] = useState<Annotation[]>(() => {
    const saved = loadPersisted(sessionId, revision);
    return saved?.annotations ?? [];
  });
  const [generalNote, setGeneralNote] = useState(() => {
    const saved = loadPersisted(sessionId, revision);
    return saved?.generalNote ?? "";
  });
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
  const [responses, setResponses] = useState<Map<string, PlanResponse>>(() => {
    const saved = loadPersisted(sessionId, revision);
    return saved?.responses ? new Map(saved.responses) : new Map();
  });
  const [feedbackEntries, setFeedbackEntries] = useState<Map<string, FeedbackEntry>>(() => {
    const saved = loadPersisted(sessionId, revision);
    return saved?.feedbackEntries ? new Map(saved.feedbackEntries) : new Map();
  });

  // Persist to localStorage (debounced)
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (isReadOnly) return;
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      savePersisted(sessionId, revision, {
        annotations,
        generalNote,
        responses: Array.from(responses.entries()),
        feedbackEntries: Array.from(feedbackEntries.entries()),
      });
    }, 300);
    return () => { if (persistTimerRef.current) clearTimeout(persistTimerRef.current); };
  }, [annotations, generalNote, responses, feedbackEntries, sessionId, revision, isReadOnly]);

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
    clearPersisted(sessionId, revision);
  }, [sessionId, revision]);

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
