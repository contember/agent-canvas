import type { Annotation } from "./AnnotationProvider";
import type { ActiveView } from "./appContext";
import { findSnippetElement, fileAnnotationPath } from "@fabrika/annotations";

/**
 * Find the DOM element for an annotation — the decoration this kernel drew for
 * it, or failing that whatever its snippet names.
 */
export function findAnnotationElement(ann: Annotation): HTMLElement | null {
  // Decoration wins over the snippet: a mark or a region box names the exact
  // run that was annotated, where a snippet only names something that reads the
  // same today.
  const decoration = document.querySelector(`[data-annotation-id="${ann.id}"]`);
  if (decoration instanceof HTMLElement) return decoration;

  // A snippet only identifies its target within its own canvas, and the
  // overview mounts every canvas at once — searching the whole document lets an
  // identical block in a different canvas win on document order. No container
  // for the canvas means it is not on screen, which is a miss, not a reason to
  // look elsewhere.
  const root = ann.canvasFile
    ? document.querySelector(`[data-canvas-file="${ann.canvasFile}"]`)
    : document;
  if (!root) return null;

  return findSnippetElement(ann.snippet, root);
}

/** Flash/pulse the element briefly — blinks bg via CSS animation */
function flashElement(el: HTMLElement) {
  el.classList.remove("ann-flash");
  void el.offsetWidth; // force reflow to restart
  el.classList.add("ann-flash");
  el.addEventListener("animationend", () => { el.classList.remove("ann-flash"); }, { once: true });
}

/**
 * Scroll the canvas/file view to an annotation element and flash it.
 * Handles file annotations by switching view first.
 */
export function scrollToAnnotation(ann: Annotation, setActiveView: (view: ActiveView) => void) {
  const filePath = fileAnnotationPath(ann);
  if (filePath) {
    setActiveView({ type: "file", path: filePath });
    setTimeout(() => {
      const el = findAnnotationElement(ann);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        flashElement(el);
      }
    }, 150);
  } else {
    const el = findAnnotationElement(ann);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      flashElement(el);
    }
  }
}
