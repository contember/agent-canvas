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

/**
 * Whether the annotation index carries this text. Line-number gutters and text
 * that already belongs to another annotation are outside it. Everything that
 * records a snippet or its context is matched back against that index later, so
 * all of them have to skip exactly the same runs.
 */
export function isIndexedText(node: Text): boolean {
  const parent = node.parentElement;
  if (parent?.classList.contains("select-none")) return false;
  if (parent?.closest("[data-annotation-id]")) return false;
  return true;
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
    if (!isIndexedText(node)) continue;
    if (range.intersectsNode(node)) {
      nodes.push(node);
    }
  }

  return nodes;
}

/** The part of a text node that falls inside the range. */
function clampToRange(node: Text, range: Range): string {
  const nodeRange = document.createRange();
  nodeRange.selectNodeContents(node);
  if (node === range.startContainer) nodeRange.setStart(node, range.startOffset);
  if (node === range.endContainer) nodeRange.setEnd(node, range.endOffset);
  return nodeRange.toString();
}

/**
 * A selection's text as the annotation index will read it back. The raw
 * selection is not that: it carries the gutter and any text already inside
 * another annotation, none of which the index holds — so a snippet taken from
 * it names something that cannot be found again.
 */
export function rangeIndexText(range: Range): string {
  let text = "";
  for (const node of getTextNodesInRange(range)) {
    text += clampToRange(node, range);
  }
  return text;
}

/**
 * Update the visual state of marks for a given annotation ID.
 */
export function setMarkActive(annotationId: string, active: boolean) {
  const marks = document.querySelectorAll(`[data-annotation-id="${annotationId}"]`);
  for (const mark of marks) {
    (mark as HTMLElement).classList.toggle("mark-active", active);
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
  for (const ann of annotations) {
    // A canvas can be rendered more than once (overview, compare, hidden
    // source panes), so restore decisions must be scoped to this container.
    if (container.querySelector(`[data-annotation-id="${ann.id}"]`)) continue;

    const snippet = ann.snippet;
    if (!snippet) continue;

    // Rebuild after every inserted mark. Wrapping text splits and moves text
    // nodes, so a cached offset map can point at stale DOM after the first hit.
    const { fullText, textNodes } = buildTextIndex(container);

    // Find all occurrences of the snippet in the full text
    const occurrences: number[] = [];
    let searchFrom = 0;
    while (true) {
      const idx = fullText.indexOf(snippet, searchFrom);
      if (idx === -1) break;
      occurrences.push(idx);
      searchFrom = idx + 1;
    }

    const [firstOccurrence] = occurrences;
    if (firstOccurrence === undefined) continue;

    // Pick the best occurrence using context
    let bestIdx = firstOccurrence;
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

function buildTextIndex(container: HTMLElement): {
  fullText: string;
  textNodes: { node: Text; start: number }[];
} {
  const textNodes: { node: Text; start: number }[] = [];
  let fullText = "";
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let tn: Text | null;
  while ((tn = walker.nextNode() as Text | null)) {
    if (!isIndexedText(tn)) continue;
    textNodes.push({ node: tn, start: fullText.length });
    fullText += tn.textContent || "";
  }
  return { fullText, textNodes };
}

function offsetToNode(
  textNodes: { node: Text; start: number }[],
  offset: number
): { node: Text; offset: number } | null {
  for (let i = textNodes.length - 1; i >= 0; i--) {
    const entry = textNodes[i];
    if (!entry || entry.start > offset) continue;
    const localOffset = offset - entry.start;
    const nodeLen = entry.node.textContent?.length ?? 0;
    if (localOffset <= nodeLen) {
      return { node: entry.node, offset: localOffset };
    }
  }
  return null;
}

/**
 * Remove the decoration for a given annotation ID, restoring the original text
 * nodes an inline mark wrapped.
 */
export function unwrapMarks(annotationId: string) {
  const marks = document.querySelectorAll(`[data-annotation-id="${annotationId}"]`);
  for (const mark of marks) {
    const parent = mark.parentNode;
    if (!parent) continue;
    // Decoration that is not an inline mark — a region overlay — wraps no text
    // and is simply taken out.
    if (mark.tagName !== "MARK") {
      parent.removeChild(mark);
      continue;
    }
    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark);
    }
    parent.removeChild(mark);
    parent.normalize();
  }
}
