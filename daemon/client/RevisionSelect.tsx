import React, { useEffect, useState, useRef, useContext } from "react";
import { RevisionContext, RevisionInfo } from "./App";

/** Format a revision for the trigger button: label or "Round N" */
function revisionButtonLabel(r: RevisionInfo) {
  return r.label || `Round ${r.revision}`;
}

/** Format relative time from ISO string */
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface RevisionSelectProps {
  value: number;
  onChange: (rev: number) => void;
  /** Accent color for the trigger text */
  accent?: "default" | "red" | "green" | "amber";
  /** Extra class on the trigger button */
  className?: string;
}

export function RevisionSelect({ value, onChange, accent = "default", className }: RevisionSelectProps) {
  const { currentRevision, revisions } = useContext(RevisionContext);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const selected = revisions.find((r) => r.revision === value);

  const accentClasses = {
    default: "text-text-secondary hover:text-text-primary",
    red: "text-accent-red",
    green: "text-accent-green",
    amber: "text-accent-amber bg-highlight-selected",
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 text-[12px] font-body font-medium px-2 py-1 rounded-md transition-colors hover:bg-bg-elevated ${accentClasses[accent]} ${className || ""}`}
      >
        {selected ? revisionButtonLabel(selected) : `Round ${value}`}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className={`text-text-tertiary transition-transform duration-200 ${open ? "rotate-180" : ""}`}>
          <path d="M2.5 4l2.5 2.5L7.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-bg-elevated border border-border-hover rounded-lg shadow-lg z-50 py-1 max-h-80 overflow-y-auto">
          {[...revisions].reverse().map((r) => (
            <button
              key={r.revision}
              onClick={() => { onChange(r.revision); setOpen(false); }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-[12px] font-body transition-colors ${
                r.revision === value
                  ? "bg-bg-surface text-text-primary"
                  : "text-text-secondary hover:bg-bg-surface hover:text-text-primary"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                r.revision === currentRevision ? "bg-accent-green" : r.hasFeedback ? "bg-accent-amber" : "bg-border-hover"
              }`} />
              <span className="flex-1 text-left truncate">
                {r.label ? (
                  <>{r.label} <span className="text-text-tertiary">#{r.revision}</span></>
                ) : (
                  <>Round {r.revision}</>
                )}
              </span>
              <span className="text-[10px] text-text-tertiary flex-shrink-0 flex items-center gap-1.5">
                {(() => {
                  const stats = r.canvasFiles?.reduce((acc, cf) => {
                    if (cf.diffStats) { acc.added += cf.diffStats.added; acc.removed += cf.diffStats.removed; }
                    return acc;
                  }, { added: 0, removed: 0 });
                  if (stats && (stats.added > 0 || stats.removed > 0)) {
                    return (
                      <span className="font-mono">
                        <span className="text-accent-green">+{stats.added}</span>
                        {" "}
                        <span className="text-accent-red">-{stats.removed}</span>
                      </span>
                    );
                  }
                  return null;
                })()}
                {r.revision === currentRevision ? "current" : r.hasFeedback ? "sent" : relativeTime(r.createdAt)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
