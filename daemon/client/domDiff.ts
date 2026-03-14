/**
 * Word-level DOM diff engine.
 *
 * Three stages:
 * 1. Extract words from a DOM container with source-node mapping
 * 2. Compute word-level LCS diff
 * 3. Inject highlight <span> elements into the DOM
 */

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
 * For large inputs (>10k tokens), falls back to paragraph-chunked diffing.
 */
export function computeWordDiff(
  oldWords: string[],
  newWords: string[]
): { oldOps: DiffOp[]; newOps: DiffOp[] } {
  // If either side is very large, chunk by paragraph boundaries
  if (oldWords.length > 10000 || newWords.length > 10000) {
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

function computeLCS(a: string[], b: string[]): string[] {
  const m = a.length,
    n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);

  const result: string[] = [];
  let i = m,
    j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift(a[i - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  return result;
}

/** Paragraph-chunked fallback for very large plans. */
function chunkedDiff(
  oldWords: string[],
  newWords: string[]
): { oldOps: DiffOp[]; newOps: DiffOp[] } {
  // Find paragraph boundaries (runs of newline tokens)
  const splitIntoParagraphs = (words: string[]) => {
    const paragraphs: { start: number; end: number; text: string }[] = [];
    let start = 0;
    let accum = "";
    for (let i = 0; i < words.length; i++) {
      accum += words[i];
      if (words[i].includes("\n\n") || i === words.length - 1) {
        paragraphs.push({ start, end: i + 1, text: accum });
        start = i + 1;
        accum = "";
      }
    }
    return paragraphs;
  };

  const oldParas = splitIntoParagraphs(oldWords);
  const newParas = splitIntoParagraphs(newWords);

  // Diff at paragraph level first
  const oldTexts = oldParas.map((p) => p.text);
  const newTexts = newParas.map((p) => p.text);
  const paraLCS = computeLCS(oldTexts, newTexts);

  const oldOps: DiffOp[] = [];
  const newOps: DiffOp[] = [];

  let opi = 0, npi = 0, pli = 0;

  while (opi < oldParas.length || npi < newParas.length) {
    if (
      pli < paraLCS.length &&
      opi < oldParas.length &&
      npi < newParas.length &&
      oldTexts[opi] === paraLCS[pli] &&
      newTexts[npi] === paraLCS[pli]
    ) {
      // Same paragraph — all words are "same"
      for (let i = oldParas[opi].start; i < oldParas[opi].end; i++)
        oldOps.push({ type: "same", index: i });
      for (let i = newParas[npi].start; i < newParas[npi].end; i++)
        newOps.push({ type: "same", index: i });
      opi++;
      npi++;
      pli++;
    } else if (opi < oldParas.length && (pli >= paraLCS.length || oldTexts[opi] !== paraLCS[pli])) {
      // Changed/removed paragraph — diff within it if we can pair with a new paragraph
      // For simplicity, mark as removed
      if (
        npi < newParas.length &&
        (pli >= paraLCS.length || newTexts[npi] !== paraLCS[pli])
      ) {
        // Both changed — do word-level diff within
        const sub = directDiff(
          oldWords.slice(oldParas[opi].start, oldParas[opi].end),
          newWords.slice(newParas[npi].start, newParas[npi].end)
        );
        for (const op of sub.oldOps)
          oldOps.push({ type: op.type, index: op.index + oldParas[opi].start });
        for (const op of sub.newOps)
          newOps.push({ type: op.type, index: op.index + newParas[npi].start });
        opi++;
        npi++;
      } else {
        for (let i = oldParas[opi].start; i < oldParas[opi].end; i++)
          oldOps.push({ type: "removed", index: i });
        opi++;
      }
    } else if (npi < newParas.length) {
      for (let i = newParas[npi].start; i < newParas[npi].end; i++)
        newOps.push({ type: "added", index: i });
      npi++;
    }
  }

  return { oldOps, newOps };
}

/**
 * Inject highlight spans into the DOM based on diff ops.
 *
 * Walks ops and map in parallel. For changed ops, splits text nodes
 * and wraps the range in a <span> with the given CSS class.
 */
export function applyHighlights(
  ops: DiffOp[],
  map: WordEntry[],
  words: string[],
  cssClass: string
): void {
  // Group consecutive changed ops for efficiency
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op.type === "same") continue;

    // Find the run of consecutive changed ops in the same text node
    const entry = map[op.index];
    if (!entry || !entry.node.parentNode) continue;

    // Wrap this single token
    wrapToken(entry, cssClass);
  }
}

function wrapToken(entry: WordEntry, cssClass: string): void {
  const { node, offset, text } = entry;
  if (!node.parentNode) return;

  const content = node.nodeValue || "";
  // Validate offset
  if (offset > content.length) return;

  const span = document.createElement("span");
  span.className = cssClass;

  // Split: before | token | after
  const before = content.slice(0, offset);
  const token = content.slice(offset, offset + text.length);
  const after = content.slice(offset + text.length);

  // Only wrap if the token matches what we expect
  if (token !== text) return;

  const parent = node.parentNode;

  if (before) {
    parent.insertBefore(document.createTextNode(before), node);
  }

  span.textContent = token;
  parent.insertBefore(span, node);

  if (after) {
    parent.insertBefore(document.createTextNode(after), node);
  }

  parent.removeChild(node);

  // Update all subsequent map entries that reference the same node
  // Since we removed the original node, they need updated references
  // We handle this by pre-processing: work backwards through the ops
}

/**
 * Main entry point: run the full diff pipeline on two rendered containers.
 * Returns true if there were any changes.
 */
export function runDomDiff(
  oldContainer: HTMLElement,
  newContainer: HTMLElement
): boolean {
  const oldExtract = extractWords(oldContainer);
  const newExtract = extractWords(newContainer);

  const { oldOps, newOps } = computeWordDiff(oldExtract.words, newExtract.words);

  const hasChanges =
    oldOps.some((op) => op.type === "removed") || newOps.some((op) => op.type === "added");

  // Apply highlights working backwards to avoid offset invalidation
  applyHighlightsReverse(oldOps, oldExtract.map, "diff-removed");
  applyHighlightsReverse(newOps, newExtract.map, "diff-added");

  return hasChanges;
}

/**
 * Apply highlights in reverse order so DOM mutations don't invalidate
 * subsequent text node offsets.
 */
function applyHighlightsReverse(
  ops: DiffOp[],
  map: WordEntry[],
  cssClass: string
): void {
  // Collect indices of changed ops
  const changed: number[] = [];
  for (let i = 0; i < ops.length; i++) {
    if (ops[i].type !== "same") changed.push(i);
  }

  // Process in reverse to preserve offsets
  for (let ci = changed.length - 1; ci >= 0; ci--) {
    const opIdx = changed[ci];
    const op = ops[opIdx];
    const entry = map[op.index];
    if (!entry || !entry.node.parentNode) continue;
    wrapToken(entry, cssClass);
  }
}
