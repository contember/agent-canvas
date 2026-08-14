import React from "react";

interface TableProps {
  headers: string[];
  rows: string[][];
}

export function Table({ headers, rows }: TableProps) {
  return (
    <div className="overflow-x-auto mt-3" data-md="table">
      <table className="w-full text-body">
        <thead>
          <tr className="border-b border-border-subtle">
            {headers.map((h, i) => (
              <th key={i} className="text-left px-4 py-2.5 text-meta font-medium uppercase tracking-wider text-text-tertiary font-body">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className={`relative border-b border-border-subtle last:border-b-0 transition-colors hover:bg-bg-surface/50 ${ri % 2 === 1 ? "bg-bg-surface/30" : ""}`}>
              {row.map((cell, ci) => (
                <td key={ci} className="px-4 py-2.5 text-text-secondary font-body">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
