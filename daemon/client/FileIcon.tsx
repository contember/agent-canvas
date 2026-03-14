import React from "react";

interface FileIconProps {
  name: string;
  type: "file" | "dir";
  expanded?: boolean;
  className?: string;
}

const extColors: Record<string, string> = {
  // TypeScript / JavaScript
  ts: "#3178c6", tsx: "#3178c6", js: "#f0db4f", jsx: "#61dafb",
  // Web
  html: "#e34c26", css: "#264de4", scss: "#c69",
  // Data
  json: "#a09a92", yaml: "#cb171e", yml: "#cb171e", toml: "#9c4221",
  // Systems
  rs: "#dea584", go: "#00add8", c: "#555", cpp: "#f34b7d", h: "#555",
  // Scripting
  py: "#3572a5", rb: "#cc342d", sh: "#89e051", bash: "#89e051",
  // Markup / docs
  md: "#083fa1", txt: "#6b6560",
  // Config
  lock: "#6b6560", gitignore: "#6b6560",
  // Images
  svg: "#ffb13b", png: "#a4c639", jpg: "#a4c639", gif: "#a4c639",
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

  if (label) {
    return (
      <span
        className={`flex-shrink-0 inline-flex items-center justify-center font-mono font-medium ${className}`}
        style={{
          width: "14px",
          height: "14px",
          fontSize: "7px",
          lineHeight: 1,
          color,
          opacity: 0.8,
        }}
      >
        {label}
      </span>
    );
  }

  // Generic file dot
  return (
    <span className={`flex-shrink-0 ${className}`} style={{ width: "14px", height: "14px", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
      <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: color, opacity: 0.5 }} />
    </span>
  );
}
