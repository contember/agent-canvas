/**
 * Unified (inline) diff view: block-level matching + word-level inline highlights.
 *
 * 1. Extract block trees from rendered old/new containers using data-md attributes
 * 2. Match blocks by key using LCS for ordering
 * 3. Build a single unified DOM with inline add/remove highlights
 */

import { computeWordDiff } from "./domDiff";
import { simpleLCS } from "./lcs";

interface WordEntry {
  text: string;
  node: Text;
  offset: number;
}

interface BlockDescriptor {
  key: string;
  type: string;
  element: HTMLElement;
  children: BlockDescriptor[];
}

interface BlockMatch {
  kind: "matched" | "added" | "removed";
  oldBlock?: BlockDescriptor;
  newBlock?: BlockDescriptor;
  childMatches?: BlockMatch[];
}

/* ── Block tree extraction ── */

export function extractBlockTree(container: HTMLElement): BlockDescriptor[] {
  const blocks: BlockDescriptor[] = [];
  const els = container.querySelectorAll<HTMLElement>(":scope > [data-md]");

  for (const el of els) {
    blocks.push(buildDescriptor(el));
  }

  // If no direct children matched, try all top-level descendants
  if (blocks.length === 0) {
    const all = container.querySelectorAll<HTMLElement>("[data-md]");
    const seen = new Set<HTMLElement>();
    for (const el of all) {
      const parentMd = el.parentElement?.closest("[data-md]");
      if (parentMd && container.contains(parentMd)) continue;
      if (seen.has(el)) continue;
      seen.add(el);
      blocks.push(buildDescriptor(el));
    }
  }

  return blocks;
}

function buildDescriptor(el: HTMLElement): BlockDescriptor {
  const type = el.getAttribute("data-md") || "unknown";
  const key = blockKey(el, type);
  const children: BlockDescriptor[] = [];

  if (type === "section") {
    const contentDiv = el.querySelector<HTMLElement>(":scope > div.mt-6, :scope > div:last-child");
    if (contentDiv) {
      for (const child of contentDiv.querySelectorAll<HTMLElement>(":scope > [data-md]")) {
        children.push(buildDescriptor(child));
      }
    }
  } else if (type === "table") {
    for (const row of el.querySelectorAll<HTMLElement>(":scope table > tbody > tr")) {
      children.push({ key: "tr:" + (row.textContent || "").slice(0, 80), type: "tr", element: row, children: [] });
    }
  } else if (type === "checklist") {
    for (const item of el.querySelectorAll<HTMLElement>(":scope > [data-md='checklist-item']")) {
      children.push(buildDescriptor(item));
    }
  } else {
    // Any block with nested [data-md] children (e.g. items containing codeblocks)
    for (const child of el.querySelectorAll<HTMLElement>("[data-md]")) {
      const parentMd = child.parentElement?.closest("[data-md]");
      if (parentMd === el) {
        children.push(buildDescriptor(child));
      }
    }
  }

  return { key, type, element: el, children };
}

function blockKey(el: HTMLElement, type: string): string {
  switch (type) {
    case "section":
      return "section:" + (el.getAttribute("data-md-title") || "");
    case "item":
      return "item:" + (el.getAttribute("data-task-id") || el.getAttribute("data-md-label") || "");
    case "codeblock":
    case "diff":
      return type + ":" + (el.textContent || "").slice(0, 80);
    case "checklist-item":
      return "checklist-item:" + (el.getAttribute("data-md-label") || el.textContent?.slice(0, 60) || "");
    case "checklist":
      return "checklist:" + el.querySelectorAll("[data-md='checklist-item']").length;
    case "markdown":
      return "markdown:" + (el.getAttribute("data-md-file") || "inline");
    case "mermaid":
      return "mermaid:" + (el.getAttribute("data-md-source") || "").slice(0, 80);
    case "callout":
      return "callout:" + (el.getAttribute("data-md-type") || "") + ":" + (el.textContent || "").slice(0, 60);
    default:
      return type + ":" + (el.getAttribute("data-md-label") || el.textContent?.slice(0, 60) || "");
  }
}

/* ── Block matching ── */

export function matchBlocks(oldBlocks: BlockDescriptor[], newBlocks: BlockDescriptor[]): BlockMatch[] {
  const oldKeys = oldBlocks.map((b) => b.key);
  const newKeys = newBlocks.map((b) => b.key);

  const lcs = simpleLCS(oldKeys, newKeys);
  const matches: BlockMatch[] = [];

  let oi = 0, ni = 0, li = 0;
  while (oi < oldBlocks.length || ni < newBlocks.length) {
    if (
      li < lcs.length && oi < oldBlocks.length && ni < newBlocks.length &&
      oldKeys[oi] === lcs[li] && newKeys[ni] === lcs[li]
    ) {
      const ob = oldBlocks[oi], nb = newBlocks[ni];
      const childMatches = (ob.children.length > 0 || nb.children.length > 0)
        ? matchBlocks(ob.children, nb.children) : undefined;
      matches.push({ kind: "matched", oldBlock: ob, newBlock: nb, childMatches });
      oi++; ni++; li++;
    } else if (oi < oldBlocks.length && (li >= lcs.length || oldKeys[oi] !== lcs[li])) {
      matches.push({ kind: "removed", oldBlock: oldBlocks[oi] });
      oi++;
    } else if (ni < newBlocks.length) {
      matches.push({ kind: "added", newBlock: newBlocks[ni] });
      ni++;
    }
  }

  return matches;
}

/* ── Unified DOM construction ── */

export function buildUnifiedDom(matches: BlockMatch[]): { fragment: DocumentFragment; hasChanges: boolean } {
  const fragment = document.createDocumentFragment();
  let hasChanges = false;

  for (const match of matches) {
    if (match.kind === "removed") {
      hasChanges = true;
      fragment.appendChild(ghostBlock(match.oldBlock!.element));
    } else if (match.kind === "added") {
      hasChanges = true;
      fragment.appendChild(addedBlock(match.newBlock!.element));
    } else {
      const clone = match.newBlock!.element.cloneNode(true) as HTMLElement;
      const type = match.newBlock!.type;

      if (type === "mermaid") {
        if (applyMermaidDiff(match.oldBlock!.element, clone)) hasChanges = true;
      } else if (match.childMatches && match.childMatches.length > 0 && (type === "table" || type === "checklist")) {
        if (processListLike(clone, match.childMatches, type)) hasChanges = true;
      } else if (match.childMatches && match.childMatches.length > 0) {
        if (processBlockWithChildren(match.oldBlock!, clone, match.childMatches, type)) hasChanges = true;
      } else if (type === "markdown") {
        if (applyElementLevelDiff(match.oldBlock!.element, clone)) hasChanges = true;
      } else {
        if (applyWordDiff(match.oldBlock!.element, clone, false)) hasChanges = true;
      }

      fragment.appendChild(clone);
    }
  }

  return { fragment, hasChanges };
}

function ghostBlock(sourceEl: HTMLElement): HTMLElement {
  const clone = sourceEl.cloneNode(true) as HTMLElement;
  clone.classList.add("diff-block-removed");
  clone.style.position = "relative";
  appendLabel(clone, "Removed", "var(--color-accent-red)");
  return clone;
}

function addedBlock(sourceEl: HTMLElement): HTMLElement {
  const clone = sourceEl.cloneNode(true) as HTMLElement;
  clone.classList.add("diff-block-added");
  clone.style.position = "relative";
  appendLabel(clone, "Added", "var(--color-accent-green)");
  return clone;
}

/** Process a matched block that has children (section, item with nested blocks). */
function processBlockWithChildren(
  oldBlock: BlockDescriptor,
  newClone: HTMLElement,
  childMatches: BlockMatch[],
  type: string
): boolean {
  let hasChanges = false;

  // Build a map from original new elements → cloned elements
  const cloneMap = buildCloneMap(oldBlock, newClone);

  // Determine content containers
  let oldContainer: HTMLElement;
  let newContainer: HTMLElement;

  if (type === "section") {
    // Diff the section title separately
    const oldHeader = oldBlock.element.querySelector<HTMLElement>(":scope > div:first-child");
    const newHeader = newClone.querySelector<HTMLElement>(":scope > div:first-child");
    if (oldHeader && newHeader) {
      if (applyWordDiff(oldHeader, newHeader, false)) hasChanges = true;
    }

    oldContainer = oldBlock.element.querySelector<HTMLElement>(":scope > div.mt-6, :scope > div:last-child")!;
    newContainer = newClone.querySelector<HTMLElement>(":scope > div.mt-6, :scope > div:last-child")!;
  } else {
    oldContainer = oldBlock.element;
    newContainer = newClone;
  }

  if (!oldContainer || !newContainer) return hasChanges;

  // Process child block matches in-place on the clone
  for (const cm of childMatches) {
    if (cm.kind === "matched") {
      const newChild = cloneMap.newMap.get(cm.newBlock!.element);
      if (newChild) {
        if (cm.newBlock!.type === "mermaid") {
          if (applyMermaidDiff(cm.oldBlock!.element, newChild)) hasChanges = true;
        } else if (cm.childMatches && cm.childMatches.length > 0 && (cm.newBlock!.type === "table" || cm.newBlock!.type === "checklist")) {
          if (processListLike(newChild, cm.childMatches, cm.newBlock!.type)) hasChanges = true;
        } else if (cm.childMatches && cm.childMatches.length > 0) {
          if (processBlockWithChildren(cm.oldBlock!, newChild, cm.childMatches, cm.newBlock!.type))
            hasChanges = true;
        } else if (cm.newBlock!.type === "markdown") {
          if (applyElementLevelDiff(cm.oldBlock!.element, newChild)) hasChanges = true;
        } else {
          if (applyWordDiff(cm.oldBlock!.element, newChild, false)) hasChanges = true;
        }
      }
    } else if (cm.kind === "removed") {
      hasChanges = true;
      const ghost = ghostBlock(cm.oldBlock!.element);
      const insertBefore = findInsertionPoint(childMatches, cm, cloneMap.newMap);
      newContainer.insertBefore(ghost, insertBefore);
    } else if (cm.kind === "added") {
      hasChanges = true;
      const newChild = cloneMap.newMap.get(cm.newBlock!.element);
      if (newChild) {
        newChild.classList.add("diff-block-added");
        newChild.style.position = "relative";
        appendLabel(newChild, "Added", "var(--color-accent-green)");
      }
    }
  }

  // Word-diff the non-block text (description, body text between blocks)
  if (applyWordDiff(oldContainer, newContainer, true)) hasChanges = true;

  return hasChanges;
}

/** Process a matched table or checklist: rebuild children with item-level matches. */
function processListLike(clone: HTMLElement, childMatches: BlockMatch[], type: string): boolean {
  // Find the container that holds the children
  const container = type === "table"
    ? clone.querySelector<HTMLElement>(":scope table > tbody")
    : clone; // checklist: <ul> is the clone itself

  if (!container) return false;
  let hasChanges = false;

  container.innerHTML = "";
  for (const cm of childMatches) {
    if (cm.kind === "removed") {
      hasChanges = true;
      const child = cm.oldBlock!.element.cloneNode(true) as HTMLElement;
      child.classList.add(type === "table" ? "diff-row-removed" : "diff-item-removed");
      container.appendChild(child);
    } else if (cm.kind === "added") {
      hasChanges = true;
      const child = cm.newBlock!.element.cloneNode(true) as HTMLElement;
      child.classList.add(type === "table" ? "diff-row-added" : "diff-item-added");
      container.appendChild(child);
    } else {
      const child = cm.newBlock!.element.cloneNode(true) as HTMLElement;
      if (applyWordDiff(cm.oldBlock!.element, child, false)) hasChanges = true;
      container.appendChild(child);
    }
  }

  return hasChanges;
}

/** Build a bidirectional map between original and cloned [data-md] elements. */
function buildCloneMap(oldBlock: BlockDescriptor, newClone: HTMLElement) {
  const newMap = new Map<HTMLElement, HTMLElement>();

  // Map new block's original elements to their clones by walking querySelectorAll in parallel
  // We need the original new block's element — but we only have the old block and the clone.
  // The clone IS the cloneNode of newBlock.element. So walk the old block's new counterpart
  // by using the children from childMatches.
  // Actually, we can map by matching data-md attributes + position.
  const origEls = oldBlock.element.querySelectorAll<HTMLElement>("[data-md]");
  const cloneEls = newClone.querySelectorAll<HTMLElement>("[data-md]");

  // For sections/items: the clone is from the NEW block. We need to map
  // new block's original children → cloned children. But we don't have newBlock.element here.
  // Instead, just map by querySelectorAll order on the clone's source structure.
  // Since we can't access the original new element, let's store the mapping differently.

  // We'll use a different approach: find elements in the clone by data-md attributes
  return {
    newMap: {
      get(originalNewEl: HTMLElement): HTMLElement | null {
        return findMatchingClonedElement(newClone, originalNewEl);
      }
    } as Map<HTMLElement, HTMLElement | null>
  };
}

/** Find the cloned version of an element by matching data-md attributes and position. */
function findMatchingClonedElement(cloneRoot: HTMLElement, originalEl: HTMLElement): HTMLElement | null {
  const type = originalEl.getAttribute("data-md");
  if (!type) return null;

  const label = originalEl.getAttribute("data-md-label");
  const title = originalEl.getAttribute("data-md-title");

  let selector = `[data-md="${type}"]`;
  if (title) selector += `[data-md-title="${CSS.escape(title)}"]`;
  else if (label) selector += `[data-md-label="${CSS.escape(label)}"]`;

  const candidates = cloneRoot.querySelectorAll<HTMLElement>(selector);
  if (candidates.length === 1) return candidates[0];

  // Multiple matches — find by text similarity
  const targetText = (originalEl.textContent || "").slice(0, 100);
  let best: HTMLElement | null = null;
  let bestScore = -1;
  for (const c of candidates) {
    const cText = (c.textContent || "").slice(0, 100);
    let score = 0;
    for (let i = 0; i < Math.min(targetText.length, cText.length); i++) {
      if (targetText[i] === cText[i]) score++;
    }
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

/** Find where to insert a ghost block: before the next matched/added sibling's clone. */
function findInsertionPoint(
  childMatches: BlockMatch[],
  removedMatch: BlockMatch,
  cloneMap: Map<HTMLElement, HTMLElement | null>
): HTMLElement | null {
  const idx = childMatches.indexOf(removedMatch);
  for (let i = idx + 1; i < childMatches.length; i++) {
    const cm = childMatches[i];
    if ((cm.kind === "matched" || cm.kind === "added") && cm.newBlock) {
      return cloneMap.get(cm.newBlock.element) || null;
    }
  }
  return null;
}

/* ── Element-level diff for blocks with rich internal structure (e.g. markdown) ── */

/**
 * Match direct child elements between old and new by tag name,
 * then apply word-level diff within matched pairs. If word-level churn
 * within a pair is too high (>50%), show as removed+added instead.
 */
function applyElementLevelDiff(oldEl: HTMLElement, newEl: HTMLElement): boolean {
  const oldChildren = Array.from(oldEl.children) as HTMLElement[];
  const newChildren = Array.from(newEl.children) as HTMLElement[];

  if (oldChildren.length === 0 && newChildren.length === 0) {
    return applyWordDiff(oldEl, newEl, false);
  }

  // Match by tag name — h3↔h3, p↔p, ul↔ul, etc.
  const oldKeys = oldChildren.map((el) => el.tagName.toLowerCase());
  const newKeys = newChildren.map((el) => el.tagName.toLowerCase());
  const lcs = simpleLCS(oldKeys, newKeys);

  interface ElemMatch {
    kind: "matched" | "added" | "removed";
    oldChild?: HTMLElement;
    newChild?: HTMLElement;
  }

  const matches: ElemMatch[] = [];
  let oi = 0, ni = 0, li = 0;

  while (oi < oldChildren.length || ni < newChildren.length) {
    if (li < lcs.length && oi < oldChildren.length && ni < newChildren.length &&
        oldKeys[oi] === lcs[li] && newKeys[ni] === lcs[li]) {
      matches.push({ kind: "matched", oldChild: oldChildren[oi], newChild: newChildren[ni] });
      oi++; ni++; li++;
    } else if (oi < oldChildren.length && (li >= lcs.length || oldKeys[oi] !== lcs[li])) {
      matches.push({ kind: "removed", oldChild: oldChildren[oi] });
      oi++;
    } else if (ni < newChildren.length) {
      matches.push({ kind: "added", newChild: newChildren[ni] });
      ni++;
    }
  }

  let hasChanges = false;

  // Detach all children from the clone, then re-append in match order
  while (newEl.firstChild) newEl.removeChild(newEl.firstChild);

  for (const m of matches) {
    if (m.kind === "matched") {
      // Check word-level churn before applying inline diff
      const oldWords = (m.oldChild!.textContent || "").match(/\S+/g) || [];
      const newWords = (m.newChild!.textContent || "").match(/\S+/g) || [];
      const wordLcs = simpleLCS(oldWords, newWords);
      const totalWords = Math.max(oldWords.length, newWords.length);
      const churn = totalWords > 0 ? 1 - wordLcs.length / totalWords : 0;

      if (churn > 0.5) {
        // Too different — show as removed + added
        hasChanges = true;
        const ghost = m.oldChild!.cloneNode(true) as HTMLElement;
        ghost.classList.add("diff-block-removed");
        newEl.appendChild(ghost);
        m.newChild!.classList.add("diff-block-added");
        newEl.appendChild(m.newChild!);
      } else {
        if (applyWordDiff(m.oldChild!, m.newChild!, false)) hasChanges = true;
        newEl.appendChild(m.newChild!);
      }
    } else if (m.kind === "removed") {
      hasChanges = true;
      const ghost = m.oldChild!.cloneNode(true) as HTMLElement;
      ghost.classList.add("diff-block-removed");
      newEl.appendChild(ghost);
    } else {
      hasChanges = true;
      m.newChild!.classList.add("diff-block-added");
      newEl.appendChild(m.newChild!);
    }
  }

  return hasChanges;
}

/* ── Word-level diff with combined single-pass rebuild ── */

/**
 * Extract words from a container, optionally excluding text inside nested [data-md] elements.
 */
function doExtractWords(container: HTMLElement, excludeBlocks: boolean): { words: string[]; map: WordEntry[] } {
  const blockEls = excludeBlocks
    ? new Set(Array.from(container.querySelectorAll<HTMLElement>("[data-md]")))
    : new Set<HTMLElement>();

  const words: string[] = [];
  const map: WordEntry[] = [];

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest("svg, .select-none, [data-no-diff]")) return NodeFilter.FILTER_REJECT;
      if (excludeBlocks) {
        for (const blockEl of blockEls) {
          if (blockEl.contains(node)) return NodeFilter.FILTER_REJECT;
        }
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let textNode: Text | null;
  while ((textNode = walker.nextNode() as Text | null)) {
    const content = textNode.nodeValue || "";
    const tokens = content.match(/\S+|\s+/g);
    if (!tokens) continue;
    let offset = 0;
    for (const token of tokens) {
      words.push(token);
      map.push({ text: token, node: textNode, offset });
      offset += token.length;
    }
  }

  return { words, map };
}

/**
 * Compute word diff between old and new elements, then apply highlights and
 * removed-word insertions in a single per-text-node pass (avoids stale references).
 *
 * @param excludeBlocks If true, skip text inside nested [data-md] elements.
 */
function applyWordDiff(oldEl: HTMLElement, newEl: HTMLElement, excludeBlocks: boolean): boolean {
  const oldExtract = doExtractWords(oldEl, excludeBlocks);
  const newExtract = doExtractWords(newEl, excludeBlocks);

  if (oldExtract.words.length === 0 && newExtract.words.length === 0) return false;

  const { oldOps, newOps } = computeWordDiff(oldExtract.words, newExtract.words);

  const hasRemoved = oldOps.some((op) => op.type === "removed");
  const hasAdded = newOps.some((op) => op.type === "added");
  if (!hasRemoved && !hasAdded) return false;

  // Build same-word mapping: oldIndex → newIndex by position in same-sequence
  const oldSameIndices: number[] = [];
  const newSameIndices: number[] = [];
  for (const op of oldOps) if (op.type === "same") oldSameIndices.push(op.index);
  for (const op of newOps) if (op.type === "same") newSameIndices.push(op.index);
  const sameMap = new Map<number, number>();
  for (let i = 0; i < oldSameIndices.length && i < newSameIndices.length; i++) {
    sameMap.set(oldSameIndices[i], newSameIndices[i]);
  }

  // Group consecutive removed words and map each group to its anchor in new
  interface RemovedGroup { text: string; anchorNewIdx: number | null }
  const removedGroups: RemovedGroup[] = [];
  {
    let group: string[] = [];
    let lastSameOldIdx = -1;
    for (const op of oldOps) {
      if (op.type === "same") {
        if (group.length > 0) {
          removedGroups.push({ text: group.join(""), anchorNewIdx: lastSameOldIdx >= 0 ? (sameMap.get(lastSameOldIdx) ?? null) : null });
          group = [];
        }
        lastSameOldIdx = op.index;
      } else if (op.type === "removed") {
        group.push(oldExtract.words[op.index]);
      }
    }
    if (group.length > 0) {
      removedGroups.push({ text: group.join(""), anchorNewIdx: lastSameOldIdx >= 0 ? (sameMap.get(lastSameOldIdx) ?? null) : null });
    }
  }

  // Collect per-text-node edits
  const nodeHighlights = new Map<Text, { start: number; end: number }[]>();
  const nodeInserts = new Map<Text, { offset: number; text: string }[]>();

  // Added-word highlights
  for (const op of newOps) {
    if (op.type !== "added") continue;
    const entry = newExtract.map[op.index];
    if (!entry?.node.parentNode) continue;
    let list = nodeHighlights.get(entry.node);
    if (!list) { list = []; nodeHighlights.set(entry.node, list); }
    list.push({ start: entry.offset, end: entry.offset + entry.text.length });
  }

  // Removed-word insertions
  for (const rg of removedGroups) {
    if (rg.anchorNewIdx === null) {
      // Removed at the very start — insert at offset 0 of first text node
      if (newExtract.map.length > 0) {
        const node = newExtract.map[0].node;
        let list = nodeInserts.get(node);
        if (!list) { list = []; nodeInserts.set(node, list); }
        list.push({ offset: 0, text: rg.text });
      }
    } else {
      const entry = newExtract.map[rg.anchorNewIdx];
      if (!entry) continue;
      let list = nodeInserts.get(entry.node);
      if (!list) { list = []; nodeInserts.set(entry.node, list); }
      list.push({ offset: entry.offset + entry.text.length, text: rg.text });
    }
  }

  // Rebuild each affected text node in a single pass
  const allNodes = new Set([...nodeHighlights.keys(), ...nodeInserts.keys()]);
  for (const textNode of allNodes) {
    rebuildTextNode(textNode, nodeHighlights.get(textNode) || [], nodeInserts.get(textNode) || []);
  }

  return true;
}

/**
 * Rebuild a single text node with highlight spans and inserted removed-word spans.
 * Processes everything in one pass — no stale text-node references.
 */
function rebuildTextNode(
  textNode: Text,
  highlights: { start: number; end: number }[],
  inserts: { offset: number; text: string }[]
): void {
  if (!textNode.parentNode) return;
  const content = textNode.nodeValue || "";

  // Merge overlapping/adjacent highlights
  highlights.sort((a, b) => a.start - b.start);
  const mergedHL: { start: number; end: number }[] = [];
  for (const h of highlights) {
    const last = mergedHL[mergedHL.length - 1];
    if (last && h.start <= last.end) {
      last.end = Math.max(last.end, h.end);
    } else {
      mergedHL.push({ ...h });
    }
  }

  inserts.sort((a, b) => a.offset - b.offset);

  const parent = textNode.parentNode;
  const frag = document.createDocumentFragment();
  let pos = 0;
  let hlIdx = 0;
  let insIdx = 0;

  while (pos <= content.length) {
    const nextHLStart = hlIdx < mergedHL.length ? mergedHL[hlIdx].start : Infinity;
    const nextInsOff = insIdx < inserts.length ? inserts[insIdx].offset : Infinity;
    const nextEvent = Math.min(nextHLStart, nextInsOff);

    if (nextEvent === Infinity) {
      // No more events — output remaining text
      if (pos < content.length) {
        frag.appendChild(document.createTextNode(content.slice(pos)));
      }
      break;
    }

    // Output plain text up to next event
    const eventPos = Math.max(nextEvent, pos);
    if (eventPos > pos) {
      frag.appendChild(document.createTextNode(content.slice(pos, eventPos)));
      pos = eventPos;
    }

    // Process inserts at this position (before highlights — removed text comes before added)
    while (insIdx < inserts.length && inserts[insIdx].offset <= pos) {
      const span = document.createElement("span");
      span.className = "diff-removed";
      span.textContent = inserts[insIdx].text;
      frag.appendChild(span);
      insIdx++;
    }

    // Process highlight starting at this position
    if (hlIdx < mergedHL.length && mergedHL[hlIdx].start <= pos) {
      const hl = mergedHL[hlIdx];
      const span = document.createElement("span");
      span.className = "diff-added";
      span.textContent = content.slice(pos, hl.end);
      frag.appendChild(span);
      pos = hl.end;
      hlIdx++;

      // Process inserts right after highlight end
      while (insIdx < inserts.length && inserts[insIdx].offset <= pos) {
        const span = document.createElement("span");
        span.className = "diff-removed";
        span.textContent = inserts[insIdx].text;
        frag.appendChild(span);
        insIdx++;
      }
    }
  }

  // Remaining inserts past end of text
  while (insIdx < inserts.length) {
    const span = document.createElement("span");
    span.className = "diff-removed";
    span.textContent = inserts[insIdx].text;
    frag.appendChild(span);
    insIdx++;
  }

  parent.replaceChild(frag, textNode);
}

/* ── Mermaid source diff ── */

/**
 * Compare mermaid blocks by their data-md-source attribute instead of rendered SVG content.
 * If sources differ, show a line-level text diff of the mermaid source code.
 */
function applyMermaidDiff(oldEl: HTMLElement, newEl: HTMLElement): boolean {
  const oldSource = (oldEl.getAttribute("data-md-source") || "").trim();
  const newSource = (newEl.getAttribute("data-md-source") || "").trim();

  if (oldSource === newSource) return false;

  // Compute line-level diff of the source
  const oldLines = oldSource.split("\n");
  const newLines = newSource.split("\n");
  const lcs = simpleLCS(oldLines, newLines);

  const diffLines: Array<{ type: "same" | "added" | "removed"; line: string }> = [];
  let oi = 0, ni = 0, li = 0;
  while (oi < oldLines.length || ni < newLines.length) {
    if (li < lcs.length && oi < oldLines.length && ni < newLines.length &&
        oldLines[oi] === lcs[li] && newLines[ni] === lcs[li]) {
      diffLines.push({ type: "same", line: oldLines[oi] });
      oi++; ni++; li++;
    } else if (oi < oldLines.length && (li >= lcs.length || oldLines[oi] !== lcs[li])) {
      diffLines.push({ type: "removed", line: oldLines[oi] });
      oi++;
    } else if (ni < newLines.length) {
      diffLines.push({ type: "added", line: newLines[ni] });
      ni++;
    }
  }

  // Append a diff view after the diagram
  const diffContainer = document.createElement("div");
  diffContainer.className = "mt-2 bg-bg-code rounded-md overflow-hidden text-tiny font-mono";
  diffContainer.setAttribute("data-no-diff", "true");

  for (const dl of diffLines) {
    const row = document.createElement("div");
    row.className = "px-3 py-0.5 whitespace-pre-wrap";
    if (dl.type === "removed") {
      row.classList.add("diff-removed");
      row.textContent = "- " + dl.line;
    } else if (dl.type === "added") {
      row.classList.add("diff-added");
      row.textContent = "+ " + dl.line;
    } else {
      row.textContent = "  " + dl.line;
    }
    diffContainer.appendChild(row);
  }

  newEl.appendChild(diffContainer);
  return true;
}

/* ── Helpers ── */

function appendLabel(el: HTMLElement, text: string, color: string): void {
  const label = document.createElement("span");
  label.className = "diff-block-label";
  label.textContent = text;
  label.style.color = color;
  label.style.backgroundColor = `color-mix(in srgb, ${color} 12%, transparent)`;
  el.appendChild(label);
}

