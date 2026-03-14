// @planner/runtime — shared context between client app and components bundle
// The React.createContext call MUST live here (not in AnnotationProvider)
// so that both bundles reference the same context object.

import { createContext, useContext } from "react";

export interface AnnotationContext {
  before: string;
  after: string;
  hierarchy: string[];
}

export interface Annotation {
  id: string;
  snippet: string;
  note: string;
  createdAt: string;
  filePath?: string;
  context?: AnnotationContext;
}

export interface PlanResponse {
  id: string;
  type: "select" | "radio" | "checkbox" | "text" | "range";
  label: string;
  value: any;
  options?: string[];
}

export interface AnnotationContextValue {
  annotations: Annotation[];
  addAnnotation: (snippet: string, note: string, filePath?: string) => void;
  addAnnotationWithId: (id: string, snippet: string, note: string, filePath?: string, context?: AnnotationContext) => void;
  updateAnnotation: (id: string, note: string) => void;
  removeAnnotation: (id: string) => void;
  generalNote: string;
  setGeneralNote: (text: string) => void;
  clearAll: () => void;
  activeAnnotationId: string | null;
  setActiveAnnotationId: (id: string | null) => void;
  responses: Map<string, PlanResponse>;
  setResponse: (id: string, response: PlanResponse) => void;
}

export const AnnotationCtx = createContext<AnnotationContextValue>(null!);

export function useAnnotations(): AnnotationContextValue {
  return useContext(AnnotationCtx);
}

export { SessionContext } from "./SessionContext";
