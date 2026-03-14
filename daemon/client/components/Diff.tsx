import React from "react";

interface DiffProps {
  before: string;
  after: string;
  language?: string;
}

export function Diff({ before, after, language }: DiffProps) {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const lcs = computeLCS(beforeLines, afterLines);
  const diffLines: Array<{ type: "same" | "removed" | "added"; line: string }> = [];

  let bi = 0, ai = 0, li = 0;
  while (bi < beforeLines.length || ai < afterLines.length) {
    if (li < lcs.length && bi < beforeLines.length && ai < afterLines.length
        && beforeLines[bi] === lcs[li] && afterLines[ai] === lcs[li]) {
      diffLines.push({ type: "same", line: beforeLines[bi] }); bi++; ai++; li++;
    } else if (bi < beforeLines.length && (li >= lcs.length || beforeLines[bi] !== lcs[li])) {
      diffLines.push({ type: "removed", line: beforeLines[bi] }); bi++;
    } else if (ai < afterLines.length) {
      diffLines.push({ type: "added", line: afterLines[ai] }); ai++;
    }
  }

  return (
    <div className="mt-3 bg-bg-code rounded-md overflow-hidden group/diff">
      {language && (
        <div className="px-4 py-2 text-meta font-mono text-text-tertiary opacity-0 group-hover/diff:opacity-60 transition-opacity">
          diff ({language})
        </div>
      )}
      <pre className="px-4 pb-3 overflow-x-auto text-code font-mono">
        {diffLines.map((d, i) => (
          <div key={i} className={
            d.type === "removed" ? "bg-accent-red-muted text-accent-red" :
            d.type === "added" ? "bg-accent-green-muted text-accent-green" :
            "text-text-tertiary"
          }>
            <span className="select-none w-6 inline-block text-center opacity-60">
              {d.type === "removed" ? "-" : d.type === "added" ? "+" : " "}
            </span>
            {d.line}
          </div>
        ))}
      </pre>
    </div>
  );
}

function computeLCS(a: string[], b: string[]): string[] {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1]+1 : Math.max(dp[i-1][j], dp[i][j-1]);
  const result: string[] = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i-1] === b[j-1]) { result.unshift(a[i-1]); i--; j--; }
    else if (dp[i-1][j] > dp[i][j-1]) i--; else j--;
  }
  return result;
}
