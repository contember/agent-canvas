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

/**
 * Whether the attach-image affordances are drawn at all.
 *
 * The button, the paste handler and the drop zone all end in one POST to the
 * host's upload endpoint, so a host without one gets none of the three instead
 * of controls that fail silently.
 */
export function hostAcceptsUploads(host: { uploadUrl: (() => string) | null }): boolean {
  return host.uploadUrl !== null;
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
