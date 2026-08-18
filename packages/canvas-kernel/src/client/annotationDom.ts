import type { Annotation } from "./AnnotationProvider";
import type { ActiveView } from "./appContext";
import { sealTarget, type SealedAnnotationTarget, type TargetAnnotation } from "./annotationTarget";
import { blockTarget } from "./blockTarget";
import { regionTarget } from "./regionTarget";
import { textTarget } from "./textTarget";
import { fileAnnotationPath } from "./utils";

// The block selectors and the block snippet live with the block target now;
// re-exported here because this is the path every caller already imports.
export { ANNOTATABLE_SELECTOR, BLOCK_SELECTOR, getBlockSnippet } from "./blockTarget";

/** Every locator strategy the kernel knows, cheapest and most specific first.
 *  Text claims any snippet at all, so it stays last. */
export const ANNOTATION_TARGETS: SealedAnnotationTarget[] = [
  sealTarget(regionTarget),
  sealTarget(blockTarget),
  sealTarget(textTarget),
];

/**
 * The element a snippet names inside `root`.
 *
 * Every target is asked, not just the first one that recognises the string: a
 * file annotation on a line that happens to read like a block snippet must
 * still fall through to the target that can actually resolve it.
 */
export function findSnippetElement(snippet: string, root: ParentNode): HTMLElement | null {
  for (const target of ANNOTATION_TARGETS) {
    const el = target.find(snippet, root);
    if (el) return el;
  }
  return null;
}

/**
 * Put every annotation's own decoration back after a render — inline marks,
 * region overlays. Each target is asked about each annotation; a snippet is not
 * owned exclusively, and every restore is idempotent, so asking all of them is
 * both correct and free.
 */
export function restoreAnnotationTargets(root: HTMLElement, annotations: readonly TargetAnnotation[]): void {
  for (const ann of annotations) {
    if (!ann.snippet) continue;
    for (const target of ANNOTATION_TARGETS) {
      target.restore(root, ann);
    }
  }
}

/** The snippet as a reader should see it. Only a target that encodes something
 *  other than readable text has anything to say; the rest already read fine. */
export function describeSnippet(snippet: string): string {
  for (const target of ANNOTATION_TARGETS) {
    const described = target.describe(snippet);
    if (described !== null) return described;
  }
  return snippet;
}

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
