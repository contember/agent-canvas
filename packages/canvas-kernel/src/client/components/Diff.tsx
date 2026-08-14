import React from "react";
import { buildDiffLines } from "../diffLines";

interface DiffProps {
  before: string;
  after: string;
  language?: string;
}

export function Diff({ before, after, language }: DiffProps) {
  const diffLines = buildDiffLines(before, after);

  return (
    <div className="mt-3 bg-bg-code rounded-md overflow-hidden group/diff" data-md="diff" data-md-language={language || ""}>
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
