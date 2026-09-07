import { createContext, useContext } from "react";

export interface AnnotationContext {
  before: string;
  after: string;
  hierarchy: string[];
  lineStart?: number;
  lineEnd?: number;
}

export interface AnnotationAuthor {
  id: string;
  name: string;
}

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
  images?: string[];
  attachments?: AnnotationAttachment[];
  source?: "local" | "remote";
  author?: AnnotationAuthor;
}

export interface AnnotationState {
  annotations: Annotation[];
  generalNote: string;
}

export interface AnnotationContextValue extends AnnotationState {
  addAnnotation: (snippet: string, note: string, filePath?: string) => void;
  addAnnotationWithId: (id: string, snippet: string, note: string, filePath?: string, context?: AnnotationContext, images?: string[], canvasFile?: string) => void;
  updateAnnotation: (id: string, note: string) => void;
  removeAnnotation: (id: string) => void;
  addAnnotationImage: (id: string, imagePath: string) => void;
  removeAnnotationImage: (id: string, imagePath: string) => void;
  setGeneralNote: (text: string) => void;
  clearAll: () => void;
  activeAnnotationId: string | null;
  setActiveAnnotationId: (id: string | null) => void;
  isReadOnly: boolean;
}

export interface AnnotationHost {
  sessionId: string;
  isShared: boolean;
  fsAvailable: boolean;
  uploadUrl: (() => string) | null;
}

export const AnnotationCtx = createContext<AnnotationContextValue | null>(null);
export const SessionContext = createContext<string>("");
export const AnnotationHostContext = createContext<AnnotationHost>({
  sessionId: "",
  isShared: false,
  fsAvailable: false,
  uploadUrl: null,
});

export function useAnnotations(): AnnotationContextValue {
  const value = useContext(AnnotationCtx);
  if (!value) throw new Error("useAnnotations requires an AnnotationProvider");
  return value;
}

export function useAnnotationHost(): AnnotationHost {
  return useContext(AnnotationHostContext);
}
