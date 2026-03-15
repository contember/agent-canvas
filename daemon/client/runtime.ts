// #canvas/runtime — shared context between client app and components bundle
// The React.createContext call MUST live here (not in AnnotationProvider)
// so that both bundles reference the same context object.

import { createContext, useContext, useEffect } from "react";

export interface AnnotationContext {
  before: string;
  after: string;
  hierarchy: string[];
  lineStart?: number;
  lineEnd?: number;
}

export interface Annotation {
  id: string;
  snippet: string;
  note: string;
  createdAt: string;
  filePath?: string;
  context?: AnnotationContext;
  images?: string[];
}

export interface PlanResponse {
  id: string;
  type: "select" | "radio" | "checkbox" | "text" | "range";
  label: string;
  value: any;
  options?: string[];
  required?: boolean;
  note?: string;
}

export interface FeedbackEntry {
  id: string;
  markdown: string;
  label?: string;
  required?: boolean;
}

export interface AnnotationContextValue {
  annotations: Annotation[];
  addAnnotation: (snippet: string, note: string, filePath?: string) => void;
  addAnnotationWithId: (id: string, snippet: string, note: string, filePath?: string, context?: AnnotationContext, images?: string[]) => void;
  updateAnnotation: (id: string, note: string) => void;
  removeAnnotation: (id: string) => void;
  addAnnotationImage: (id: string, imagePath: string) => void;
  removeAnnotationImage: (id: string, imagePath: string) => void;
  generalNote: string;
  setGeneralNote: (text: string) => void;
  clearAll: () => void;
  activeAnnotationId: string | null;
  setActiveAnnotationId: (id: string | null) => void;
  responses: Map<string, PlanResponse>;
  setResponse: (id: string, response: PlanResponse) => void;
  feedbackEntries: Map<string, FeedbackEntry>;
  setFeedbackEntry: (id: string, entry: FeedbackEntry) => void;
  removeFeedbackEntry: (id: string) => void;
}

export const AnnotationCtx = createContext<AnnotationContextValue>(null!);

export function useAnnotations(): AnnotationContextValue {
  return useContext(AnnotationCtx);
}

export function useFeedback(
  id: string,
  markdown: string,
  options?: { label?: string; required?: boolean },
): void {
  const { setFeedbackEntry, removeFeedbackEntry } = useAnnotations();
  useEffect(() => {
    setFeedbackEntry(id, {
      id,
      markdown,
      label: options?.label,
      required: options?.required,
    });
    return () => removeFeedbackEntry(id);
  }, [id, markdown, options?.label, options?.required]);
}

export { SessionContext } from "./SessionContext";

// ActiveView navigation — allows components (e.g. FilePreview) to open files
export type ActiveView = { type: "plan" } | { type: "file"; path: string };

export const ActiveViewCtx = createContext<{
  setActiveView: (v: ActiveView) => void;
}>({
  setActiveView: () => {},
});
