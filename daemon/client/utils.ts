/** Generate a unique annotation ID */
export function generateAnnotationId(): string {
  return `ann-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Auto-resize a textarea to fit its content */
export function autoResizeTextarea(el: HTMLTextAreaElement, minHeight?: number) {
  el.style.height = "auto";
  el.style.height = (minHeight ? Math.max(minHeight, el.scrollHeight) : el.scrollHeight) + "px";
}
