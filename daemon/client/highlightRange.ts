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
 * Update active state for annotation marks.
 * Only touches marks for the previous and current active IDs to avoid full DOM scans.
 */
export function updateAllMarkStates(activeId: string | null, prevActiveId?: string | null) {
  if (prevActiveId != null && prevActiveId !== activeId) {
    setMarkActive(prevActiveId, false);
  }
  if (activeId != null) {
    setMarkActive(activeId, true);
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
 * Restore marks for persisted annotations by finding their snippet text in the DOM.
 * Uses before/after context for disambiguation when the same text appears multiple times.
 */
export function restoreMarks(
  container: HTMLElement,
  annotations: { id: string; snippet: string; filePath?: string; context?: { before: string; after: string; hierarchy: string[] } }[]
) {
  // Skip annotations that already have marks in the DOM
  const toRestore = annotations.filter(
    (a) => !document.querySelector(`[data-annotation-id="${a.id}"]`)
  );
  if (!toRestore.length) return;

  // Build full text content + mapping from text offset to (textNode, offsetInNode)
  const textNodes: { node: Text; start: number }[] = [];
  let fullText = "";
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let tn: Text | null;
  while ((tn = walker.nextNode() as Text | null)) {
    if (tn.parentElement?.classList.contains("select-none")) continue;
    textNodes.push({ node: tn, start: fullText.length });
    fullText += tn.textContent || "";
  }

  for (const ann of toRestore) {
    const snippet = ann.snippet;
    if (!snippet) continue;

    // Find all occurrences of the snippet in the full text
    const occurrences: number[] = [];
    let searchFrom = 0;
    while (true) {
      const idx = fullText.indexOf(snippet, searchFrom);
      if (idx === -1) break;
      occurrences.push(idx);
      searchFrom = idx + 1;
    }

    if (occurrences.length === 0) continue;

    // Pick the best occurrence using context
    let bestIdx = occurrences[0];
    if (occurrences.length > 1 && ann.context) {
      let bestScore = -1;
      for (const idx of occurrences) {
        let score = 0;
        if (ann.context.before) {
          const preceding = fullText.slice(Math.max(0, idx - 80), idx);
          if (preceding.includes(ann.context.before)) score += 2;
          else if (ann.context.before.length > 10 && preceding.includes(ann.context.before.slice(-10))) score += 1;
        }
        if (ann.context.after) {
          const following = fullText.slice(idx + snippet.length, idx + snippet.length + 80);
          if (following.includes(ann.context.after)) score += 2;
          else if (ann.context.after.length > 10 && following.includes(ann.context.after.slice(0, 10))) score += 1;
        }
        if (score > bestScore) {
          bestScore = score;
          bestIdx = idx;
        }
      }
    }

    // Map text offsets to DOM positions
    const startOffset = bestIdx;
    const endOffset = bestIdx + snippet.length;

    const startPos = offsetToNode(textNodes, startOffset);
    const endPos = offsetToNode(textNodes, endOffset);
    if (!startPos || !endPos) continue;

    try {
      const range = document.createRange();
      range.setStart(startPos.node, startPos.offset);
      range.setEnd(endPos.node, endPos.offset);
      wrapRangeWithMark(range, ann.id);
    } catch {}
  }
}

function offsetToNode(
  textNodes: { node: Text; start: number }[],
  offset: number
): { node: Text; offset: number } | null {
  for (let i = textNodes.length - 1; i >= 0; i--) {
    if (textNodes[i].start <= offset) {
      const localOffset = offset - textNodes[i].start;
      const nodeLen = textNodes[i].node.textContent?.length ?? 0;
      if (localOffset <= nodeLen) {
        return { node: textNodes[i].node, offset: localOffset };
      }
    }
  }
  return null;
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
