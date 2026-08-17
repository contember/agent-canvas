import type { Annotation } from "./AnnotationProvider";
import type { ActiveView } from "./appContext";
import { fileAnnotationPath } from "./utils";

/** Every block the keyboard arrows walk through. */
export const BLOCK_SELECTOR = "[data-md='item'], [data-md='section'], [data-md='table'] tbody tr, [data-md='callout'], [data-md='note'], [data-md='checklist-item'], [data-md='choice-option'], [data-md='multichoice-option'], [data-md='userinput'], [data-md='rangeinput'], [data-md='image']";

/**
 * The blocks that can carry a block annotation — a strict subset of
 * BLOCK_SELECTOR, since interactive controls are navigable but not annotatable.
 * Creation and lookup must both read it from here: an annotation minted on a
 * block this selector excludes can never be found again.
 */
export const ANNOTATABLE_SELECTOR = "[data-md='item'], [data-md='section'], [data-md='table'] tbody tr, [data-md='callout'], [data-md='note'], [data-md='checklist-item'], [data-md='image']";

/**
 * A block's text as a reader sees it. Decorative markup — the callout icon,
 * anything else marked aria-hidden — is skipped, so the glyph does not ride
 * along into the sidebar label and into feedback.md.
 */
function readableText(block: HTMLElement): string {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let text = "";
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const hidden = node.parentElement?.closest("[aria-hidden='true']");
    if (hidden && block.contains(hidden)) continue;
    text += node.textContent ?? "";
  }
  return text.trim();
}

/** Extract snippet identifier for a block element — the key a block annotation is stored under. */
export function getBlockSnippet(block: HTMLElement): string | null {
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
    const text = readableText(block).slice(0, 60) || "Callout";
    return `[Callout:${type}] ${text}`;
  }
  if (md === "note") {
    const text = readableText(block).slice(0, 60) || "Note";
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
    // A block snippet only identifies a block within its own canvas, and the
    // overview mounts every canvas at once — searching the whole document lets
    // an identical block in a different canvas win on document order. No
    // container for the canvas means it is not on screen, which is a miss, not
    // a reason to look elsewhere.
    const root = ann.canvasFile
      ? document.querySelector(`[data-canvas-file="${ann.canvasFile}"]`)
      : document;
    if (!root) return null;

    for (const el of root.querySelectorAll(ANNOTATABLE_SELECTOR)) {
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
