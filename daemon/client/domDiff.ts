/**
 * Word-level DOM diff engine.
 *
 * Three stages:
 * 1. Extract words from a DOM container with source-node mapping
 * 2. Compute word-level LCS diff
 * 3. Inject highlight <span> elements into the DOM
 */

import { simpleLCS } from "./lcs";

interface WordEntry {
  text: string;
  node: Text;
  offset: number; // character offset within the Text node
}

/** Walk all text nodes, tokenize into words+whitespace, record originating node+offset. */
export function extractWords(container: HTMLElement): { words: string[]; map: WordEntry[] } {
  const words: string[] = [];
  const map: WordEntry[] = [];

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      // Skip SVG, select-none, and data-no-diff elements
      if (parent.closest("svg, .select-none, [data-no-diff]")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let textNode: Text | null;
  while ((textNode = walker.nextNode() as Text | null)) {
    const content = textNode.nodeValue || "";
    // Tokenize: split on whitespace boundaries, keeping whitespace as tokens
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

interface DiffOp {
  type: "same" | "added" | "removed";
  index: number; // index in the original words array
}

/**
 * Compute word-level LCS and return diff ops for both sides.
 *
 * For large inputs (>5k tokens), falls back to chunked diffing.
 */
export function computeWordDiff(
  oldWords: string[],
  newWords: string[]
): { oldOps: DiffOp[]; newOps: DiffOp[] } {
  if (oldWords.length > 5000 || newWords.length > 5000) {
    return chunkedDiff(oldWords, newWords);
  }
  return directDiff(oldWords, newWords);
}

function directDiff(
  oldWords: string[],
  newWords: string[]
): { oldOps: DiffOp[]; newOps: DiffOp[] } {
  const lcs = computeLCS(oldWords, newWords);

  const oldOps: DiffOp[] = [];
  const newOps: DiffOp[] = [];

  let oi = 0,
    ni = 0,
    li = 0;

  while (oi < oldWords.length || ni < newWords.length) {
    if (
      li < lcs.length &&
      oi < oldWords.length &&
      ni < newWords.length &&
      oldWords[oi] === lcs[li] &&
      newWords[ni] === lcs[li]
    ) {
      oldOps.push({ type: "same", index: oi });
      newOps.push({ type: "same", index: ni });
      oi++;
      ni++;
      li++;
    } else if (oi < oldWords.length && (li >= lcs.length || oldWords[oi] !== lcs[li])) {
      oldOps.push({ type: "removed", index: oi });
      oi++;
    } else if (ni < newWords.length) {
      newOps.push({ type: "added", index: ni });
      ni++;
    }
  }

  return { oldOps, newOps };
}

/**
 * Compute LCS using Hirschberg's algorithm — O(mn) time but only O(n) space.
 * Recursively divides the problem, using two-row DP to find the split point.
 */
function computeLCS(a: string[], b: string[]): string[] {
  const m = a.length, n = b.length;
  if (m === 0 || n === 0) return [];
  if (m === 1) return b.includes(a[0]) ? [a[0]] : [];
  if (n === 1) return a.includes(b[0]) ? [b[0]] : [];

  // For small inputs, use the simple DP approach
  if (m * n <= 1_000_000) {
    return simpleLCS(a, b);
  }

  // Hirschberg divide-and-conquer
  const mid = Math.floor(m / 2);
  const aFirst = a.slice(0, mid);
  const aSecond = a.slice(mid);

  const scoreL = lcsLengthRow(aFirst, b);
  const scoreR = lcsLengthRow([...aSecond].reverse(), [...b].reverse());

  // Find optimal split in b
  let best = 0, bestK = 0;
  for (let k = 0; k <= n; k++) {
    const score = scoreL[k] + scoreR[n - k];
    if (score > best) { best = score; bestK = k; }
  }

  const bFirst = b.slice(0, bestK);
  const bSecond = b.slice(bestK);

  return [...computeLCS(aFirst, bFirst), ...computeLCS(aSecond, bSecond)];
}

/** Two-row DP: returns last row of LCS length table. O(n) space. */
function lcsLengthRow(a: string[], b: string[]): number[] {
  const n = b.length;
  let prev = new Array(n + 1).fill(0);
  let curr = new Array(n + 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1]);
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }
  return prev;
}


/**
 * Chunked fallback for very large plans.
 * Splits words into fixed-size chunks, aligns chunks via LCS,
 * then runs word-level diff within each aligned chunk pair.
 */
function chunkedDiff(
  oldWords: string[],
  newWords: string[]
): { oldOps: DiffOp[]; newOps: DiffOp[] } {
  const CHUNK_SIZE = 200;

  const splitIntoChunks = (words: string[]) => {
    const chunks: { start: number; end: number; text: string }[] = [];
    for (let i = 0; i < words.length; i += CHUNK_SIZE) {
      const end = Math.min(i + CHUNK_SIZE, words.length);
      chunks.push({ start: i, end, text: words.slice(i, end).join("") });
    }
    return chunks;
  };

  const oldChunks = splitIntoChunks(oldWords);
  const newChunks = splitIntoChunks(newWords);

  const oldTexts = oldChunks.map((c) => c.text);
  const newTexts = newChunks.map((c) => c.text);
  const chunkLCS = computeLCS(oldTexts, newTexts);

  const oldOps: DiffOp[] = [];
  const newOps: DiffOp[] = [];

  let oci = 0, nci = 0, cli = 0;

  while (oci < oldChunks.length || nci < newChunks.length) {
    if (
      cli < chunkLCS.length &&
      oci < oldChunks.length &&
      nci < newChunks.length &&
      oldTexts[oci] === chunkLCS[cli] &&
      newTexts[nci] === chunkLCS[cli]
    ) {
      // Identical chunks
      for (let i = oldChunks[oci].start; i < oldChunks[oci].end; i++)
        oldOps.push({ type: "same", index: i });
      for (let i = newChunks[nci].start; i < newChunks[nci].end; i++)
        newOps.push({ type: "same", index: i });
      oci++;
      nci++;
      cli++;
    } else if (oci < oldChunks.length && (cli >= chunkLCS.length || oldTexts[oci] !== chunkLCS[cli])) {
      if (
        nci < newChunks.length &&
        (cli >= chunkLCS.length || newTexts[nci] !== chunkLCS[cli])
      ) {
        // Both sides changed — word-level diff within these chunks
        const sub = directDiff(
          oldWords.slice(oldChunks[oci].start, oldChunks[oci].end),
          newWords.slice(newChunks[nci].start, newChunks[nci].end)
        );
        for (const op of sub.oldOps)
          oldOps.push({ type: op.type, index: op.index + oldChunks[oci].start });
        for (const op of sub.newOps)
          newOps.push({ type: op.type, index: op.index + newChunks[nci].start });
        oci++;
        nci++;
      } else {
        // Only old side — removed
        for (let i = oldChunks[oci].start; i < oldChunks[oci].end; i++)
          oldOps.push({ type: "removed", index: i });
        oci++;
      }
    } else if (nci < newChunks.length) {
      // Only new side — added
      for (let i = newChunks[nci].start; i < newChunks[nci].end; i++)
        newOps.push({ type: "added", index: i });
      nci++;
    }
  }

  return { oldOps, newOps };
}

/**
 * Apply highlights by grouping changed tokens per text node,
 * then rebuilding each affected text node in a single pass.
 *
 * This avoids the stale-reference bug where wrapping one token
 * removes the text node and breaks subsequent tokens from the same node.
 */
function applyHighlightsByNode(
  ops: DiffOp[],
  map: WordEntry[],
  cssClass: string
): void {
  // Collect changed indices grouped by source text node
  const nodeGroups = new Map<Text, { offset: number; length: number }[]>();

  for (const op of ops) {
    if (op.type === "same") continue;
    const entry = map[op.index];
    if (!entry || !entry.node.parentNode) continue;

    let group = nodeGroups.get(entry.node);
    if (!group) {
      group = [];
      nodeGroups.set(entry.node, group);
    }
    group.push({ offset: entry.offset, length: entry.text.length });
  }

  // For each text node, rebuild it with highlight spans
  for (const [textNode, ranges] of nodeGroups) {
    if (!textNode.parentNode) continue;
    const content = textNode.nodeValue || "";

    // Sort ranges by offset
    ranges.sort((a, b) => a.offset - b.offset);

    // Merge overlapping/adjacent ranges
    const merged: { offset: number; length: number }[] = [];
    for (const r of ranges) {
      const last = merged[merged.length - 1];
      if (last && r.offset <= last.offset + last.length) {
        last.length = Math.max(last.length, r.offset + r.length - last.offset);
      } else {
        merged.push({ ...r });
      }
    }

    // Build replacement nodes: alternating text and highlighted spans
    const parent = textNode.parentNode;
    const frag = document.createDocumentFragment();
    let pos = 0;

    for (const r of merged) {
      // Text before this highlight
      if (r.offset > pos) {
        frag.appendChild(document.createTextNode(content.slice(pos, r.offset)));
      }
      // Highlighted span
      const span = document.createElement("span");
      span.className = cssClass;
      span.textContent = content.slice(r.offset, r.offset + r.length);
      frag.appendChild(span);
      pos = r.offset + r.length;
    }

    // Remaining text after last highlight
    if (pos < content.length) {
      frag.appendChild(document.createTextNode(content.slice(pos)));
    }

    parent.replaceChild(frag, textNode);
  }
}

/**
 * Main entry point: run the full diff pipeline on two rendered containers.
 * Returns true if there were any changes.
 */
export function runDomDiff(
  oldContainer: HTMLElement,
  newContainer: HTMLElement
): boolean {
  // Handle mermaid blocks separately via data-md-source comparison
  const mermaidChanged = diffMermaidBlocks(oldContainer, newContainer);

  const oldExtract = extractWords(oldContainer);
  const newExtract = extractWords(newContainer);

  const { oldOps, newOps } = computeWordDiff(oldExtract.words, newExtract.words);

  const hasWordChanges =
    oldOps.some((op) => op.type === "removed") || newOps.some((op) => op.type === "added");

  applyHighlightsByNode(oldOps, oldExtract.map, "diff-removed");
  applyHighlightsByNode(newOps, newExtract.map, "diff-added");

  return hasWordChanges || mermaidChanged;
}

/**
 * Compare mermaid blocks between old and new containers by data-md-source.
 * Highlights changed mermaid blocks with a border and appends a source diff.
 */
function diffMermaidBlocks(oldContainer: HTMLElement, newContainer: HTMLElement): boolean {
  const oldMermaids = Array.from(oldContainer.querySelectorAll<HTMLElement>('[data-md="mermaid"]'));
  const newMermaids = Array.from(newContainer.querySelectorAll<HTMLElement>('[data-md="mermaid"]'));
  let changed = false;

  // Match by position (simple 1:1 pairing)
  const count = Math.max(oldMermaids.length, newMermaids.length);
  for (let i = 0; i < count; i++) {
    const oldEl = oldMermaids[i];
    const newEl = newMermaids[i];

    if (!oldEl && newEl) {
      // Added
      newEl.classList.add("diff-block-added");
      newEl.style.position = "relative";
      changed = true;
      continue;
    }
    if (oldEl && !newEl) {
      // Removed
      oldEl.classList.add("diff-block-removed");
      oldEl.style.position = "relative";
      changed = true;
      continue;
    }
    if (!oldEl || !newEl) continue;

    const oldSource = (oldEl.getAttribute("data-md-source") || "").trim();
    const newSource = (newEl.getAttribute("data-md-source") || "").trim();

    if (oldSource === newSource) continue;
    changed = true;

    // Highlight containers
    oldEl.style.borderLeft = "3px solid var(--color-accent-red)";
    oldEl.style.paddingLeft = "8px";
    newEl.style.borderLeft = "3px solid var(--color-accent-green)";
    newEl.style.paddingLeft = "8px";

    // Append source diffs
    const oldLines = oldSource.split("\n");
    const newLines = newSource.split("\n");
    const lcs = simpleLCS(oldLines, newLines);

    const buildDiffEl = (lines: string[], lcsArr: string[], side: "old" | "new") => {
      const container = document.createElement("div");
      container.className = "mt-2 bg-bg-code rounded-md overflow-hidden text-tiny font-mono";
      container.setAttribute("data-no-diff", "true");

      let li = 0, si = 0;
      while (si < lines.length) {
        const row = document.createElement("div");
        row.className = "px-3 py-0.5 whitespace-pre-wrap";
        if (li < lcsArr.length && lines[si] === lcsArr[li]) {
          row.textContent = "  " + lines[si];
          si++; li++;
        } else {
          row.classList.add(side === "old" ? "diff-removed" : "diff-added");
          row.textContent = (side === "old" ? "- " : "+ ") + lines[si];
          si++;
        }
        container.appendChild(row);
      }
      return container;
    };

    oldEl.appendChild(buildDiffEl(oldLines, lcs, "old"));
    newEl.appendChild(buildDiffEl(newLines, lcs, "new"));
  }

  return changed;
}
