import React, { useState, useCallback } from "react";
import { AnnotationCtx } from "@planner/runtime";
import type { Annotation, AnnotationContext, PlanResponse, AnnotationContextValue } from "@planner/runtime";

// Re-export types for convenience
export type { Annotation, AnnotationContext, PlanResponse, AnnotationContextValue };
export { useAnnotations } from "@planner/runtime";

export function AnnotationProvider({ children }: { children: React.ReactNode }) {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [generalNote, setGeneralNote] = useState("");
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
  const [responses, setResponses] = useState<Map<string, PlanResponse>>(new Map());

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
  }, []);

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
