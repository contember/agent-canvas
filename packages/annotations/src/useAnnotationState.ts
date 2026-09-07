import { useCallback, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Annotation, AnnotationContext, AnnotationContextValue } from "./runtime";
import { generateAnnotationId } from "./utils";

interface AnnotationStateOptions {
  annotations: Annotation[];
  setAnnotations: Dispatch<SetStateAction<Annotation[]>>;
  generalNote: string;
  setGeneralNote: (note: string) => void;
  remoteAnnotations?: Annotation[];
  isReadOnly: boolean;
  onClear?: () => void;
}

function removeMarks(id?: string) {
  const selector = id ? `[data-annotation-id="${CSS.escape(id)}"]` : "[data-annotation-id]";
  for (const mark of document.querySelectorAll(selector)) {
    if (mark.tagName === "MARK") {
      const parent = mark.parentNode;
      mark.replaceWith(document.createTextNode(mark.textContent || ""));
      parent?.normalize();
    } else {
      mark.remove();
    }
  }
}

export function useAnnotationState({
  annotations: localAnnotations, setAnnotations, generalNote, setGeneralNote,
  remoteAnnotations, isReadOnly, onClear,
}: AnnotationStateOptions): AnnotationContextValue {
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
  const annotations = useMemo<Annotation[]>(() => {
    if (!remoteAnnotations?.length) return localAnnotations;
    const ids = new Set(localAnnotations.map((annotation) => annotation.id));
    const remote = remoteAnnotations.filter((annotation) => !ids.has(annotation.id));
    return [...localAnnotations, ...remote.map((annotation): Annotation => ({ ...annotation, source: "remote" }))];
  }, [localAnnotations, remoteAnnotations]);

  const addAnnotationWithId = useCallback((id: string, snippet: string, note: string, filePath?: string, context?: AnnotationContext, images?: string[], canvasFile?: string) => {
    setAnnotations((prev) => [...prev, {
      id, snippet, note, createdAt: new Date().toISOString(), filePath, context,
      ...(images?.length ? { images } : {}), ...(canvasFile ? { canvasFile } : {}),
    }]);
  }, [setAnnotations]);
  const addAnnotation = useCallback((snippet: string, note: string, filePath?: string) => {
    addAnnotationWithId(generateAnnotationId(), snippet, note, filePath);
  }, [addAnnotationWithId]);
  const updateAnnotation = useCallback((id: string, note: string) => {
    setAnnotations((prev) => prev.map((annotation) => annotation.id === id ? { ...annotation, note } : annotation));
  }, [setAnnotations]);
  const removeAnnotation = useCallback((id: string) => {
    if (!localAnnotations.some((annotation) => annotation.id === id)) return;
    removeMarks(id);
    setAnnotations((prev) => prev.filter((annotation) => annotation.id !== id));
    setActiveAnnotationId((prev) => prev === id ? null : prev);
  }, [localAnnotations, setAnnotations]);
  const addAnnotationImage = useCallback((id: string, imagePath: string) => {
    setAnnotations((prev) => prev.map((annotation) => annotation.id === id
      ? { ...annotation, images: [...(annotation.images || []), imagePath] } : annotation));
  }, [setAnnotations]);
  const removeAnnotationImage = useCallback((id: string, imagePath: string) => {
    setAnnotations((prev) => prev.map((annotation) => annotation.id === id
      ? { ...annotation, images: (annotation.images || []).filter((image) => image !== imagePath) } : annotation));
  }, [setAnnotations]);
  const clearAll = useCallback(() => {
    removeMarks();
    setAnnotations([]);
    setGeneralNote("");
    setActiveAnnotationId(null);
    onClear?.();
  }, [setAnnotations, setGeneralNote, onClear]);

  return {
    annotations, generalNote, setGeneralNote, activeAnnotationId, setActiveAnnotationId,
    addAnnotation, addAnnotationWithId, updateAnnotation, removeAnnotation,
    addAnnotationImage, removeAnnotationImage, clearAll, isReadOnly,
  };
}
