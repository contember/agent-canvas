import React, { useState, useCallback, useEffect, useRef } from "react";
import { AnnotationCtx } from "#canvas/runtime";
import type { Annotation, AnnotationContext, PlanResponse, AnnotationContextValue } from "#canvas/runtime";

// Re-export types for convenience
export type { Annotation, AnnotationContext, PlanResponse, AnnotationContextValue };
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
}

function storageKey(sessionId: string, revision: number): string {
  return `planner:${sessionId}:rev:${revision}`;
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
  const prevKeyRef = useRef(`${sessionId}:${revision}`);
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

  // Reset state when session/revision changes
  useEffect(() => {
    const key = `${sessionId}:${revision}`;
    if (key === prevKeyRef.current) return;
    prevKeyRef.current = key;

    const saved = loadPersisted(sessionId, revision);
    setAnnotations(saved?.annotations ?? []);
    setGeneralNote(saved?.generalNote ?? "");
    setResponses(saved?.responses ? new Map(saved.responses) : new Map());
    setActiveAnnotationId(null);
  }, [sessionId, revision]);

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
      });
    }, 300);
    return () => { if (persistTimerRef.current) clearTimeout(persistTimerRef.current); };
  }, [annotations, generalNote, responses, sessionId, revision, isReadOnly]);

  const addAnnotationWithId = useCallback((id: string, snippet: string, note: string, filePath?: string, context?: AnnotationContext) => {
    setAnnotations((prev) => [...prev, { id, snippet, note, createdAt: new Date().toISOString(), filePath, context }]);
  }, []);

  const addAnnotation = useCallback((snippet: string, note: string, filePath?: string) => {
    const id = `ann-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    addAnnotationWithId(id, snippet, note, filePath);
  }, [addAnnotationWithId]);

  const updateAnnotation = useCallback((id: string, note: string) => {
    setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, note } : a)));
  }, []);

  const removeAnnotation = useCallback((id: string) => {
    removeMarksFromDom(id);
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
    setActiveAnnotationId((prev) => (prev === id ? null : prev));
  }, []);

  const setResponse = useCallback((id: string, response: PlanResponse) => {
    setResponses((prev) => {
      const next = new Map(prev);
      next.set(id, response);
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
    clearPersisted(sessionId, revision);
  }, [sessionId, revision]);

  return (
    <AnnotationCtx.Provider
      value={{
        annotations, addAnnotation, addAnnotationWithId, updateAnnotation, removeAnnotation,
        generalNote, setGeneralNote, clearAll,
        activeAnnotationId, setActiveAnnotationId,
        responses, setResponse,
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
