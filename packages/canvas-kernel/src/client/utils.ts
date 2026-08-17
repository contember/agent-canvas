/** Sentinel filePath for annotations on the agent response banner */
export const RESPONSE_ANNOTATION_PATH = "__agent-response__";

/**
 * The file this annotation lives in, or undefined if it lives in no file.
 * Response annotations ride in the same field under a sentinel, so a bare
 * `if (ann.filePath)` opens a file tab for a path that is not one.
 */
export function fileAnnotationPath(ann: { filePath?: string }): string | undefined {
  return ann.filePath && ann.filePath !== RESPONSE_ANNOTATION_PATH ? ann.filePath : undefined;
}

/** Generate a unique annotation ID */
export function generateAnnotationId(): string {
  return `ann-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Auto-resize a textarea to fit its content */
export function autoResizeTextarea(el: HTMLTextAreaElement, minHeight?: number) {
  el.style.height = "auto";
  el.style.height = (minHeight ? Math.max(minHeight, el.scrollHeight) : el.scrollHeight) + "px";
}
