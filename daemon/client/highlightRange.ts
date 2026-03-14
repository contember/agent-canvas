const MARK_STYLE_INACTIVE = `
  background: var(--color-highlight-annotation);
  border-bottom: 1.5px solid var(--color-highlight-bg);
  border-radius: 2px;
  cursor: pointer;
  transition: background 150ms ease;
  color: inherit;
  padding: 1px 0;
`;

const MARK_STYLE_ACTIVE = `
  background: var(--color-highlight-bg);
  border-bottom: 1.5px solid var(--color-highlight-border);
  border-radius: 2px;
  cursor: pointer;
  transition: background 150ms ease;
  color: inherit;
  padding: 1px 0;
`;

/**
 * Wraps the current browser Range in <mark> elements with the given annotation ID.
 * Works for multiline / cross-element selections.
 */
export function wrapRangeWithMark(range: Range, annotationId: string): HTMLElement[] {
  const marks: HTMLElement[] = [];

  // Collect all text nodes within the range
  const textNodes = getTextNodesInRange(range);

  for (const tn of textNodes) {
    const nodeRange = document.createRange();
    nodeRange.selectNodeContents(tn);

    // Clamp to the actual selection range
    if (tn === range.startContainer) {
      nodeRange.setStart(tn, range.startOffset);
    }
    if (tn === range.endContainer) {
      nodeRange.setEnd(tn, range.endOffset);
    }

    const text = nodeRange.toString();
    if (!text || !text.trim()) continue;

    // Wrap this portion in a <mark>
    const mark = document.createElement("mark");
    mark.setAttribute("data-annotation-id", annotationId);
    mark.style.cssText = MARK_STYLE_INACTIVE;

    try {
      nodeRange.surroundContents(mark);
    } catch {
      // surroundContents fails if range crosses element boundaries within a single text node
      // (shouldn't happen for a single text node, but handle gracefully)
      const fragment = nodeRange.extractContents();
      mark.appendChild(fragment);
      nodeRange.insertNode(mark);
    }

    marks.push(mark);
  }

  return marks;
}

function getTextNodesInRange(range: Range): Text[] {
  const nodes: Text[] = [];
  const ancestor = range.commonAncestorContainer;

  if (ancestor.nodeType === Node.TEXT_NODE) {
    nodes.push(ancestor as Text);
    return nodes;
  }

  const walker = document.createTreeWalker(ancestor, NodeFilter.SHOW_TEXT);
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    // Skip line numbers and existing marks
    const parent = node.parentElement;
    if (parent?.classList.contains("select-none")) continue;

    if (range.intersectsNode(node)) {
      nodes.push(node);
    }
  }

  return nodes;
}

/**
 * Update the visual state of marks for a given annotation ID.
 */
export function setMarkActive(annotationId: string, active: boolean) {
  const marks = document.querySelectorAll(`[data-annotation-id="${annotationId}"]`);
  for (const mark of marks) {
    (mark as HTMLElement).style.cssText = active ? MARK_STYLE_ACTIVE : MARK_STYLE_INACTIVE;
  }
}

/**
 * Update active state for all annotation marks.
 */
export function updateAllMarkStates(activeId: string | null) {
  const allMarks = document.querySelectorAll("[data-annotation-id]");
  for (const mark of allMarks) {
    const id = mark.getAttribute("data-annotation-id");
    (mark as HTMLElement).style.cssText = id === activeId ? MARK_STYLE_ACTIVE : MARK_STYLE_INACTIVE;
  }
}

/**
 * Rename annotation ID on existing marks (e.g. temp → real ID).
 */
export function renameMarkId(oldId: string, newId: string) {
  const marks = document.querySelectorAll(`[data-annotation-id="${oldId}"]`);
  for (const mark of marks) {
    mark.setAttribute("data-annotation-id", newId);
  }
}

/**
 * Remove marks for a given annotation ID, restoring the original text nodes.
 */
export function unwrapMarks(annotationId: string) {
  const marks = document.querySelectorAll(`[data-annotation-id="${annotationId}"]`);
  for (const mark of marks) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark);
    }
    parent.removeChild(mark);
    parent.normalize();
  }
}
