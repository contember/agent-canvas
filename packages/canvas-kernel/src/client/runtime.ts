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

/** Identifies the person who created an annotation. For local annotations
 *  this is the daemon owner (unset). For remote annotations it carries the
 *  reviewer's self-reported name + stable anonymous id assigned by the worker. */
export interface AnnotationAuthor {
  id: string;
  name: string;
}

/** An image or other file attached to an annotation. Replaces the legacy
 *  `images: string[]` pattern with a richer shape that can point to either
 *  a local upload (daemon) or a remote blob (CF Worker R2). */
export interface AnnotationAttachment {
  url: string;
  mime?: string;
}

export interface Annotation {
  id: string;
  snippet: string;
  note: string;
  createdAt: string;
  filePath?: string;
  canvasFile?: string;
  context?: AnnotationContext;
  /** @deprecated use `attachments` — kept for localStorage backward compat */
  images?: string[];
  attachments?: AnnotationAttachment[];
  /** "remote" annotations come from a shared view and are read-only locally. */
  source?: "local" | "remote";
  /** Only set for source === "remote". */
  author?: AnnotationAuthor;
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
  addAnnotationWithId: (id: string, snippet: string, note: string, filePath?: string, context?: AnnotationContext, images?: string[], canvasFile?: string) => void;
  updateAnnotation: (id: string, note: string) => void;
  removeAnnotation: (id: string) => void;
  addAnnotationImage: (id: string, imagePath: string) => void;
  removeAnnotationImage: (id: string, imagePath: string) => void;
  generalNote: string;
  setGeneralNote: (text: string) => void;
  clearAll: () => void;
  activeAnnotationId: string | null;
  setActiveAnnotationId: (id: string | null) => void;
  /** Every answer held for this draft, including ones carried in from an
   *  earlier revision. Controls read and write this one. */
  responses: Map<string, PlanResponse>;
  setResponse: (id: string, response: PlanResponse) => void;
  /** `responses` narrowed to the questions this revision actually asks.
   *  Everything that reports feedback — markdown, validation, "has content" —
   *  reads this instead, so a carried-over answer to a since-removed question
   *  is not submitted. Identical to `responses` until the host supplies the
   *  canvas file list and every one of them has rendered. */
  submittableResponses: Map<string, PlanResponse>;
  registerResponse: (id: string) => void;
  registerCanvasRendered: (filename: string) => void;
  feedbackEntries: Map<string, FeedbackEntry>;
  setFeedbackEntry: (id: string, entry: FeedbackEntry) => void;
  removeFeedbackEntry: (id: string) => void;
  /** Canvas is rendered read-only (reviewing history). */
  isReadOnly: boolean;
}

export const AnnotationCtx = createContext<AnnotationContextValue>(null!);

export function useAnnotations(): AnnotationContextValue {
  return useContext(AnnotationCtx);
}

/** Record that this revision asks the question, so submission can tell it from
 *  an answer carried in for a question that is gone. Deliberately has no
 *  cleanup: unmounting means the reader navigated away, not that the question
 *  disappeared. */
export function useResponseRegistration(id: string): void {
  const { registerResponse } = useAnnotations();
  useEffect(() => {
    registerResponse(id);
  }, [id, registerResponse]);
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

// CanvasFile context — tells components which canvas file they belong to
export const CanvasFileCtx = createContext<string>("");
export function useCanvasFile(): string {
  return useContext(CanvasFileCtx);
}

// ActiveView navigation — allows components (e.g. FilePreview) to open files
export type ActiveView = { type: "overview" } | { type: "canvas"; filename: string } | { type: "file"; path: string };

export const ActiveViewCtx = createContext<{
  setActiveView: (v: ActiveView) => void;
}>({
  setActiveView: () => {},
});
