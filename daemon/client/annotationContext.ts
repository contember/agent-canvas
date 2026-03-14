import type { AnnotationContext } from "./AnnotationProvider";

/**
 * Extract disambiguation context from a Range:
 * - surrounding text (before/after the selection)
 * - hierarchy path (Section title → Task label)
 */
export function extractContext(range: Range, planContainer: HTMLElement): AnnotationContext {
  const before = getSurroundingText(range, "before", 60);
  const after = getSurroundingText(range, "after", 60);
  const hierarchy = getHierarchy(range.startContainer, planContainer);

  return { before, after, hierarchy };
}

function getSurroundingText(range: Range, direction: "before" | "after", maxChars: number): string {
  const block = getBlockParent(direction === "before" ? range.startContainer : range.endContainer);
  if (!block) return "";

  let text = "";

  if (direction === "before") {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      if (node === range.startContainer) {
        text += (node.textContent || "").slice(0, range.startOffset);
        break;
      }
      if (node.parentElement?.hasAttribute("data-annotation-id")) continue;
      text += node.textContent || "";
    }
    if (text.length > maxChars) {
      text = text.slice(-maxChars);
      const spaceIdx = text.indexOf(" ");
      if (spaceIdx > 0) text = text.slice(spaceIdx + 1);
    }
  } else {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let found = false;
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      if (node === range.endContainer) {
        text += (node.textContent || "").slice(range.endOffset);
        found = true;
        continue;
      }
      if (found) {
        if (node.parentElement?.hasAttribute("data-annotation-id")) continue;
        text += node.textContent || "";
      }
    }
    if (text.length > maxChars) {
      text = text.slice(0, maxChars);
      const spaceIdx = text.lastIndexOf(" ");
      if (spaceIdx > 0) text = text.slice(0, spaceIdx);
    }
  }

  return text.trim();
}

function getBlockParent(node: Node): Element | null {
  const blockTags = new Set(["DIV", "P", "LI", "PRE", "BLOCKQUOTE", "SECTION", "ARTICLE"]);
  let el = node.parentElement;
  while (el) {
    if (blockTags.has(el.tagName)) return el;
    el = el.parentElement;
  }
  return null;
}

function getHierarchy(node: Node, planContainer: HTMLElement): string[] {
  const path: string[] = [];
  let el = node instanceof Element ? node : node.parentElement;

  while (el && el !== planContainer) {
    const taskId = el.getAttribute?.("data-task-id");
    if (taskId) {
      const label = el.querySelector(".font-semibold");
      if (label) path.unshift(label.textContent?.trim() || taskId);
    }

    if (el.tagName === "DIV" && el.querySelector(":scope > button .font-heading, :scope > div .font-heading")) {
      const heading = el.querySelector(".font-heading");
      if (heading) path.unshift(heading.textContent?.trim() || "");
    }

    el = el.parentElement;
  }

  return path;
}

/**
 * Format a snippet with surrounding context for disambiguation.
 * Short snippets get before/after context.
 */
export function formatSnippetInContext(ann: { snippet: string; context?: AnnotationContext }): string {
  const snippet = ann.snippet.trim();
  const ctx = ann.context;

  const isShort = snippet.length < 30;

  if (ctx && isShort && (ctx.before || ctx.after)) {
    const parts: string[] = [];
    if (ctx.before) parts.push(`...${ctx.before} `);
    parts.push(snippet);
    if (ctx.after) parts.push(` ${ctx.after}...`);
    return parts.join("");
  }

  return snippet;
}
