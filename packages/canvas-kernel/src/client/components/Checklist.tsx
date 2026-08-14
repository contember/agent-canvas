import React from "react";

interface ChecklistItem {
  label: string;
  checked: boolean;
}

interface ChecklistProps {
  items: ChecklistItem[];
}

export function Checklist({ items }: ChecklistProps) {
  return (
    <ul className="space-y-1 mt-3" data-md="checklist">
      {items.map((item, i) => (
        <li key={i} data-md="checklist-item" data-md-label={item.label} className="relative flex items-start gap-2.5 py-1">
          <span className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 transition-all ${
            item.checked
              ? "bg-accent-green"
              : "border-[1.5px] border-border-hover"
          }`}>
            {item.checked && (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M2.5 5L4.5 7L7.5 3" style={{ stroke: "var(--color-text-inverse)" }} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </span>
          <span className={`text-body font-body ${
            item.checked ? "text-text-tertiary line-through decoration-border-hover" : "text-text-secondary"
          }`}>
            {item.label}
          </span>
        </li>
      ))}
    </ul>
  );
}
