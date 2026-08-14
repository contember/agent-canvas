export interface DiffLine {
  type: "same" | "removed" | "added";
  line: string;
}

/** Line-level diff of two texts, longest-common-subsequence based. */
export function buildDiffLines(before: string, after: string): DiffLine[] {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const lcs = computeLCS(beforeLines, afterLines);
  const diffLines: DiffLine[] = [];

  let bi = 0, ai = 0, li = 0;
  while (bi < beforeLines.length || ai < afterLines.length) {
    // split() never leaves holes, so "in range" and "defined" are the same test.
    const beforeLine = beforeLines[bi];
    const afterLine = afterLines[ai];
    if (li < lcs.length && beforeLine !== undefined && afterLine !== undefined
        && beforeLine === lcs[li] && afterLine === lcs[li]) {
      diffLines.push({ type: "same", line: beforeLine }); bi++; ai++; li++;
    } else if (beforeLine !== undefined && (li >= lcs.length || beforeLine !== lcs[li])) {
      diffLines.push({ type: "removed", line: beforeLine }); bi++;
    } else if (afterLine !== undefined) {
      diffLines.push({ type: "added", line: afterLine }); ai++;
    }
  }

  return diffLines;
}

export function computeLCS(a: string[], b: string[]): string[] {
  const m = a.length, n = b.length;
  // Rows are fully filled before use; the `?? 0` fallbacks only satisfy the
  // checker, which cannot see that every index here is in range.
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    const row = dp[i] ?? [];
    const prev = dp[i - 1] ?? [];
    for (let j = 1; j <= n; j++)
      row[j] = a[i-1] === b[j-1] ? (prev[j-1] ?? 0) + 1 : Math.max(prev[j] ?? 0, row[j-1] ?? 0);
  }
  const result: string[] = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    const line = a[i-1];
    if (line !== undefined && line === b[j-1]) { result.unshift(line); i--; j--; }
    else if ((dp[i-1]?.[j] ?? 0) > (dp[i]?.[j-1] ?? 0)) i--; else j--;
  }
  return result;
}
