import React from "react";

interface PriorityProps {
  level: "high" | "medium" | "low";
}

const config = {
  high:   "text-accent-red bg-accent-red-muted",
  medium: "text-accent-amber bg-accent-amber-muted",
  low:    "text-text-tertiary bg-border-subtle",
};

export function Priority({ level }: PriorityProps) {
  return (
    <span className={`inline text-tiny font-medium font-body ml-2 px-1.5 py-0.5 rounded ${config[level]}`}>
      {level}
    </span>
  );
}
