import React, { useEffect, useState, useRef } from "react";

interface SessionInfo {
  id: string;
  projectRoot?: string;
  currentRevision: number;
  updatedAt: string;
}

function sessionDisplayName(id: string, projectRoot?: string): string {
  if (projectRoot) {
    const parts = projectRoot.replace(/\/+$/, "").split("/");
    return parts[parts.length - 1] || id;
  }
  return id.length > 30 ? id.slice(0, 30) + "..." : id;
}

interface SessionSwitcherProps {
  currentSessionId: string;
  projectRoot?: string;
}

export function SessionSwitcher({ currentSessionId, projectRoot }: SessionSwitcherProps) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchSessions = async () => {
      try {
        const res = await fetch("/api/sessions");
        const data = await res.json() as SessionInfo[];
        setSessions((prev) => {
          const next = JSON.stringify(data);
          return JSON.stringify(prev) === next ? prev : data;
        });
      } catch {}
    };
    fetchSessions();
    const interval = setInterval(fetchSessions, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const otherSessions = sessions.filter((s) => s.id !== currentSessionId);
  const displayName = sessionDisplayName(currentSessionId, projectRoot);

  return (
    <div className="relative" ref={ref}>
      <div className="flex items-center gap-1.5 font-body text-body font-medium">
        <a
          href={`/s/${currentSessionId}`}
          className="text-text-primary hover:text-text-secondary transition-colors"
        >
          {displayName}
        </a>
        {otherSessions.length > 0 && (
          <button
            onClick={() => setOpen(!open)}
            className="flex items-center justify-center text-text-tertiary hover:text-text-secondary transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}>
              <path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
      </div>

      {open && otherSessions.length > 0 && (
        <div className="absolute top-full left-0 mt-2 w-64 bg-bg-elevated border border-border-hover rounded-lg shadow-lg z-50 py-1 overflow-hidden">
          {otherSessions.map((s) => (
            <a
              key={s.id}
              href={`/s/${s.id}`}
              className="flex items-center gap-2.5 px-4 py-2.5 text-body font-body text-text-secondary hover:bg-bg-surface hover:text-text-primary transition-colors"
            >
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.currentRevision > 0 ? "bg-accent-green" : "bg-border-hover"}`} />
              <span className="truncate">{sessionDisplayName(s.id, s.projectRoot)}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
