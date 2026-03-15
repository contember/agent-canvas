import type { Annotation } from "./AnnotationProvider";
import type { ActiveView } from "./App";

/** All blocks that can be annotated via block-level comments */
const ANNOTATABLE_SELECTOR = "[data-md='item'], [data-md='section'], [data-md='table'] tbody tr, [data-md='callout'], [data-md='note'], [data-md='checklist-item'], [data-md='image']";

/** Extract snippet identifier for a block element (mirrors PlanRenderer's getBlockSnippet) */
function getBlockSnippet(block: HTMLElement): string | null {
  const md = block.getAttribute("data-md");
  if (md === "item") {
    const label = block.getAttribute("data-md-label");
    return label ? `[Item] ${label}` : null;
  }
  if (md === "section") {
    const title = block.getAttribute("data-md-title");
    return title ? `[Section] ${title}` : null;
  }
  if (md === "callout") {
    const type = block.getAttribute("data-md-type") || "info";
    const text = block.textContent?.trim().slice(0, 60) || "Callout";
    return `[Callout:${type}] ${text}`;
  }
  if (md === "note") {
    const text = block.textContent?.trim().slice(0, 60) || "Note";
    return `[Note] ${text}`;
  }
  if (block.tagName === "TR") {
    const cells = Array.from(block.querySelectorAll("td")).map((td) => td.textContent?.trim()).filter(Boolean);
    return cells.length ? `[Row] ${cells.join(" | ")}` : null;
  }
  if (md === "checklist-item") {
    const label = block.getAttribute("data-md-label");
    return label ? `[Checklist] ${label}` : null;
  }
  if (md === "choice-option" || md === "multichoice-option") {
    const label = block.getAttribute("data-md-label");
    return label ? `[Option] ${label}` : null;
  }
  if (md === "userinput") {
    const label = block.getAttribute("data-md-label");
    return label ? `[Input] ${label}` : null;
  }
  if (md === "rangeinput") {
    const label = block.getAttribute("data-md-label");
    return label ? `[Range] ${label}` : null;
  }
  if (md === "image") {
    const src = block.getAttribute("data-md-src");
    return src ? `[Image] ${src}` : null;
  }
  return null;
}

/**
 * Find the DOM element for an annotation — either an inline mark (data-annotation-id)
 * or a block element matched by snippet.
 */
export function findAnnotationElement(ann: Annotation): HTMLElement | null {
  // Try inline mark first
  const mark = document.querySelector(`[data-annotation-id="${ann.id}"]`) as HTMLElement | null;
  if (mark) return mark;

  // For block annotations (snippet starts with "["), find by matching snippet against blocks
  if (ann.snippet.startsWith("[")) {
    for (const el of document.querySelectorAll(ANNOTATABLE_SELECTOR)) {
      if (getBlockSnippet(el as HTMLElement) === ann.snippet) {
        return el as HTMLElement;
      }
    }
  }

  return null;
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
  if (ann.filePath) {
    setActiveView({ type: "file", path: ann.filePath });
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
