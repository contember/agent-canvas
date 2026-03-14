import React from "react";

interface FileIconProps {
  name: string;
  type: "file" | "dir";
  expanded?: boolean;
  className?: string;
}

const extColors: Record<string, string> = {
  // TypeScript / JavaScript
  ts: "#3178c6", tsx: "#3178c6", js: "#e8a32e", jsx: "#4ba0c8",
  // Web
  html: "#e34c26", css: "#264de4", scss: "#c69",
  // Data
  json: "#7a7568", yaml: "#cb171e", yml: "#cb171e", toml: "#9c4221",
  // Systems
  rs: "#dea584", go: "#00add8", c: "#6a6a6a", cpp: "#f34b7d", h: "#6a6a6a",
  // Scripting
  py: "#3572a5", rb: "#cc342d", sh: "#5a8c3c", bash: "#5a8c3c",
  // Markup / docs
  md: "#3573b5", txt: "#6b6560",
  // Config
  lock: "#6b6560", gitignore: "#6b6560",
  // Images
  svg: "#d9952e", png: "#6a9c2e", jpg: "#6a9c2e", gif: "#6a9c2e",
};

const extLabels: Record<string, string> = {
  ts: "TS", tsx: "TX", js: "JS", jsx: "JX",
  py: "PY", rs: "RS", go: "GO", rb: "RB",
  json: "{}", yaml: "YM", yml: "YM", toml: "TM",
  html: "<>", css: "#", scss: "#",
  md: "M↓", sh: "$", bash: "$",
  c: "C", cpp: "C+", h: "H",
  svg: "◇", png: "▣", jpg: "▣",
};

export function FileIcon({ name, type, expanded, className = "" }: FileIconProps) {
  if (type === "dir") {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className={`flex-shrink-0 ${className}`}>
        {expanded ? (
          <path d="M1.5 3.5h5l1.5 1.5h6.5v8h-13z" style={{ fill: "var(--color-folder-fill-active)", stroke: "var(--color-folder-stroke-active)" }} strokeWidth="1" />
        ) : (
          <path d="M1.5 3.5h5l1.5 1.5h6.5v8h-13z" style={{ fill: "var(--color-folder-fill)", stroke: "var(--color-folder-stroke)" }} strokeWidth="1" />
        )}
      </svg>
    );
  }

  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  const color = extColors[ext] || "#6b6560";
  const label = extLabels[ext];

  return (
    <svg width="14" height="14" viewBox="0 0 16 16" className={`flex-shrink-0 ${className}`}>
      {/* File shape with folded corner */}
      <path d="M2 1.5h8l3.5 3.5v9.5a1 1 0 01-1 1H3a1 1 0 01-1-1v-12a1 1 0 011-1z" fill={color} opacity="0.85" />
      <path d="M10 1.5v2.5a1 1 0 001 1h2.5" fill="none" stroke="white" strokeWidth="0.5" opacity="0.5" />
      {label && (
        <text
          x="8"
          y="11.5"
          textAnchor="middle"
          fill="white"
          fontSize="5.5"
          fontFamily="monospace"
          fontWeight="600"
        >
          {label}
        </text>
      )}
    </svg>
  );
}
