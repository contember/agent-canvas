import React, { useEffect, useState, useCallback, useRef, createContext, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { SessionContext } from "#canvas/runtime";
import { AnnotationProvider, useAnnotations } from "./AnnotationProvider";
import { PlanRenderer } from "./PlanRenderer";
import { AnnotationSidebar } from "./AnnotationSidebar";
import { ResponsePreview } from "./ResponsePreview";
import { FileBrowser } from "./FileBrowser";
import { FileViewer } from "./FileViewer";
import { SessionSwitcher } from "./SessionSwitcher";
import { exportCanvasToMarkdown } from "./exportMarkdown";

export type ActiveView = { type: "plan" } | { type: "file"; path: string };

export interface RevisionInfo {
  revision: number;
  label?: string;
  createdAt: string;
  hasFeedback: boolean;
}

export const ActiveViewContext = createContext<{
  activeView: ActiveView;
  setActiveView: (v: ActiveView) => void;
  openFiles: string[];
  closeFile: (path: string) => void;
}>({
  activeView: { type: "plan" },
  setActiveView: () => {},
  openFiles: [],
  closeFile: () => {},
});

export const RevisionContext = createContext<{
  currentRevision: number;
  selectedRevision: number;
  revisions: RevisionInfo[];
  setSelectedRevision: (rev: number) => void;
  isReadOnly: boolean;
}>({
  currentRevision: 1,
  selectedRevision: 1,
  revisions: [],
  setSelectedRevision: () => {},
  isReadOnly: false,
});

function ThemeSwitcher() {
  const [theme, setTheme] = useState(() => localStorage.getItem("planner-theme") || document.documentElement.dataset.theme || "dark");

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("planner-theme", next);
    setTheme(next);
  };

  return (
    <button
      onClick={toggle}
      className="w-7 h-7 flex items-center justify-center rounded-md text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated transition-colors"
      title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
    >
      {theme === "dark" ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="5" />
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}

function RevisionSelector() {
  const { currentRevision, selectedRevision, revisions, setSelectedRevision } = React.useContext(RevisionContext);
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

  const roundLabel = (r: RevisionInfo) => r.label || `Round ${r.revision}`;

  if (revisions.length <= 1) {
    const only = revisions[0];
    return <span className="text-[11px] text-text-tertiary font-body">{only ? roundLabel(only) : `Round ${currentRevision}`}</span>;
  }

  const selected = revisions.find((r) => r.revision === selectedRevision);
  const isLatest = selectedRevision === currentRevision;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 text-[12px] font-body font-medium px-2 py-1 rounded-md transition-colors ${
          isLatest ? "text-text-secondary hover:text-text-primary" : "text-accent-amber bg-highlight-selected"
        }`}
      >
        {selected ? roundLabel(selected) : `Round ${selectedRevision}`}
        {!isLatest && <span className="text-[10px] opacity-70">(old)</span>}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className={`text-text-tertiary transition-transform duration-200 ${open ? "rotate-180" : ""}`}>
          <path d="M2.5 4l2.5 2.5L7.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-56 bg-bg-elevated border border-border-hover rounded-lg shadow-lg z-50 py-1 overflow-hidden max-h-80 overflow-y-auto">
          {[...revisions].reverse().map((r) => (
            <button
              key={r.revision}
              onClick={() => { setSelectedRevision(r.revision); setOpen(false); }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-[12px] font-body transition-colors ${
                r.revision === selectedRevision
                  ? "bg-bg-surface text-text-primary"
                  : "text-text-secondary hover:bg-bg-surface hover:text-text-primary"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                r.revision === currentRevision ? "bg-accent-green" : r.hasFeedback ? "bg-accent-amber" : "bg-border-hover"
              }`} />
              <span className="flex-1 text-left truncate">{roundLabel(r)}</span>
              {r.revision === currentRevision && <span className="text-[10px] text-text-tertiary flex-shrink-0">current</span>}
              {r.hasFeedback && r.revision !== currentRevision && <span className="text-[10px] text-accent-amber flex-shrink-0">sent</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function App() {
  const sessionId = window.location.pathname.replace("/s/", "") || "";
  const [currentRevision, setCurrentRevision] = useState(1);
  const [selectedRevision, setSelectedRevision] = useState(1);
  const [revisions, setRevisions] = useState<RevisionInfo[]>([]);
  const [connected, setConnected] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [activeView, setActiveViewRaw] = useState<ActiveView>({ type: "plan" });
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  const [mobileSidebar, setMobileSidebar] = useState(false);

  const selectedRevInfo = revisions.find((r) => r.revision === selectedRevision);
  const isReadOnly = selectedRevision !== currentRevision || !!selectedRevInfo?.hasFeedback;

  const setActiveView = useCallback((v: ActiveView) => {
    setActiveViewRaw(v);
    if (v.type === "file") {
      setOpenFiles((prev) => prev.includes(v.path) ? prev : [...prev, v.path]);
    }
  }, []);

  const closeFile = useCallback((path: string) => {
    setOpenFiles((prev) => prev.filter((p) => p !== path));
    setActiveViewRaw((prev) => prev.type === "file" && prev.path === path ? { type: "plan" } : prev);
  }, []);

  // Fetch initial meta
  useEffect(() => {
    if (!sessionId) return;
    fetch(`/api/session/${sessionId}/meta`)
      .then((r) => r.json())
      .then((data: any) => {
        if (data.currentRevision) {
          setCurrentRevision(data.currentRevision);
          setSelectedRevision(data.currentRevision);
          setRevisions(data.revisions || []);
        }
      })
      .catch(() => {});
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const connect = () => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws/session/${sessionId}`);
      wsRef.current = ws;
      ws.onopen = () => setConnected(true);
      ws.onclose = () => { setConnected(false); reconnectTimer = setTimeout(connect, 2000); };
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "plan-updated") {
            setCurrentRevision(data.currentRevision);
            setSelectedRevision(data.currentRevision);
            if (data.revisions) setRevisions(data.revisions);
          }
          if (data.type === "revision-updated") {
            if (data.revisions) setRevisions(data.revisions);
          }
        } catch {}
      };
    };
    connect();
    return () => { if (reconnectTimer) clearTimeout(reconnectTimer); wsRef.current?.close(); };
  }, [sessionId]);

  const handleSubmit = useCallback((feedback: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "submit", feedback }));
      setPreviewOpen(false);
      // Server will broadcast revision-updated with hasFeedback: true
      // which triggers isReadOnly via revisions state
    }
  }, []);

  if (!sessionId) {
    return <div className="flex items-center justify-center h-screen text-text-tertiary font-body">No session selected.</div>;
  }

  return (
    <SessionContext.Provider value={sessionId}>
      <RevisionContext.Provider value={{ currentRevision, selectedRevision, revisions, setSelectedRevision, isReadOnly }}>
        <AnnotationProvider sessionId={sessionId} revision={selectedRevision} isReadOnly={isReadOnly}>
          <ActiveViewContext.Provider value={{ activeView, setActiveView, openFiles, closeFile }}>
            <div className="min-h-screen bg-bg-base">
              {/* Left panel — fixed to viewport */}
              <LeftPanel sessionId={sessionId} connected={connected} onMobileSidebar={() => setMobileSidebar(!mobileSidebar)} />

              {/* Right panel — fixed to viewport, resizable */}
              <ResizableSidebar>
                <AnnotationSidebar onPreview={() => setPreviewOpen(true)} onSubmit={handleSubmit} />
              </ResizableSidebar>

              {/* Center content — normal document flow, browser scroll */}
              <div className="lg:ml-60 lg:mr-[var(--sidebar-width,320px)] relative" id="plan-scroll-container">
                {/* Mobile top bar — only visible < lg */}
                <div className="lg:hidden sticky top-0 z-20 flex items-center justify-between px-4 py-2 border-b border-border-subtle bg-bg-surface">
                  <div className="flex items-center gap-2">
                    <SessionSwitcher currentSessionId={sessionId} />
                    <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-accent-green" : "bg-accent-red"}`} />
                  </div>
                  <div className="flex items-center gap-1">
                    <RevisionSelector />
                    <button
                      onClick={() => setMobileSidebar(!mobileSidebar)}
                      className="w-7 h-7 flex items-center justify-center rounded-md text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated transition-colors"
                      title="Annotations"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      </svg>
                    </button>
                    <ThemeSwitcher />
                  </div>
                </div>

                <ContentTabs />
                {activeView.type === "plan" ? (
                  <div className="max-w-[720px] mx-auto px-6 pt-12 pb-32">
                    <PlanRenderer revision={selectedRevision} />
                  </div>
                ) : (
                  <FileViewer path={activeView.path} />
                )}
              </div>

              {/* Mobile sidebar overlay */}
              {mobileSidebar && (
                <div className="lg:hidden fixed inset-0 z-40 flex">
                  <div className="flex-1" onClick={() => setMobileSidebar(false)} />
                  <div className="w-80 max-w-[85vw] bg-bg-surface border-l border-border-subtle flex flex-col shadow-lg">
                    <div className="flex items-center justify-between px-4 py-2 border-b border-border-subtle flex-shrink-0">
                      <span className="text-[11px] font-medium uppercase tracking-widest text-text-tertiary font-body">Sidebar</span>
                      <button onClick={() => setMobileSidebar(false)} className="text-text-tertiary hover:text-text-secondary w-7 h-7 flex items-center justify-center">&#x2715;</button>
                    </div>
                    <div className="flex-1 overflow-hidden">
                      <AnnotationSidebar onPreview={() => setPreviewOpen(true)} onSubmit={handleSubmit} />
                    </div>
                  </div>
                </div>
              )}

              <ResponsePreview open={previewOpen} onClose={() => setPreviewOpen(false)} onSubmit={handleSubmit} />
            </div>
          </ActiveViewContext.Provider>
        </AnnotationProvider>
      </RevisionContext.Provider>
    </SessionContext.Provider>
  );
}

function LeftPanel({ sessionId, connected, onMobileSidebar }: { sessionId: string; connected: boolean; onMobileSidebar: () => void }) {
  return (
    <div className="hidden lg:flex w-60 flex-col fixed top-0 left-0 bottom-0 bg-bg-surface border-r border-border-subtle z-10">
      {/* Session + round info */}
      <div className="px-4 pt-4 pb-3 flex-shrink-0 border-b border-border-subtle">
        <div className="flex items-center gap-2 mb-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-text-tertiary flex-shrink-0">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <SessionSwitcher currentSessionId={sessionId} />
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${connected ? "bg-accent-green" : "bg-accent-red"}`} />
        </div>
        <RevisionSelector />
      </div>

      {/* File browser */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <FileBrowser embedded />
      </div>

      {/* Bottom: theme switcher */}
      <div className="px-4 py-3 border-t border-border-subtle flex items-center justify-between flex-shrink-0">
        <span className="text-[10px] text-text-tertiary font-body uppercase tracking-widest">Theme</span>
        <ThemeSwitcher />
      </div>
    </div>
  );
}

function ResizableSidebar({ children }: { children: React.ReactNode }) {
  const [width, setWidth] = useState(() => {
    const saved = localStorage.getItem("planner-sidebar-width");
    return saved ? parseInt(saved, 10) : 320;
  });
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const widthRef = useRef(width);
  widthRef.current = width;

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startWidth.current = widthRef.current;

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = startX.current - e.clientX;
      const newWidth = Math.max(240, Math.min(600, startWidth.current + delta));
      setWidth(newWidth);
      widthRef.current = newWidth;
    };
    const onMouseUp = () => {
      dragging.current = false;
      localStorage.setItem("planner-sidebar-width", String(widthRef.current));
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  // Set CSS variable so center content can use it for margin-right
  useEffect(() => {
    document.documentElement.style.setProperty("--sidebar-width", `${width}px`);
    return () => { document.documentElement.style.removeProperty("--sidebar-width"); };
  }, [width]);

  return (
    <div className="hidden lg:flex flex-col fixed top-0 right-0 bottom-0 bg-bg-surface border-l border-border-subtle z-10" style={{ width }}>
      {/* Drag handle */}
      <div
        onMouseDown={onMouseDown}
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-accent-blue/30 transition-colors z-20"
        style={{ marginLeft: "-2px" }}
      />
      {children}
    </div>
  );
}

function ContentTabs() {
  const { activeView, setActiveView, openFiles, closeFile } = React.useContext(ActiveViewContext);
  const sessionId = React.useContext(SessionContext);
  const { addAnnotationWithId, setActiveAnnotationId } = useAnnotations();

  const showTabs = openFiles.length > 0;
  // Always render if on plan view (for export button), or if file tabs are open
  if (!showTabs && activeView.type !== "plan") return null;

  return (
    <div className="flex items-center border-b border-border-medium bg-bg-surface overflow-x-auto sticky top-0 z-10">
      {/* Plan tab — only show when file tabs exist */}
      {showTabs && (
        <button
          onClick={() => setActiveView({ type: "plan" })}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-body whitespace-nowrap transition-colors relative ${
            activeView.type === "plan"
              ? "text-text-primary"
              : "text-text-tertiary hover:text-text-secondary"
          }`}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="opacity-60">
            <path d="M12 2L2 7l10 5 10-5-10-5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Plan
          {activeView.type === "plan" && (
            <span className="absolute bottom-0 left-3 right-3 h-[2px] bg-text-primary rounded-full" />
          )}
        </button>
      )}

      {showTabs && <>
      {/* Separator */}
      <span className="w-px h-4 bg-border-medium flex-shrink-0" />

      {/* File tabs */}
      {openFiles.map((path, i) => {
        const name = path.split("/").pop() || path;
        const isActive = activeView.type === "file" && activeView.path === path;
        return (
          <React.Fragment key={path}>
            <div className="flex items-center">
              <button
                onClick={() => setActiveView({ type: "file", path })}
                className={`flex items-center gap-1.5 pl-3 pr-1 py-2.5 text-[13px] font-mono whitespace-nowrap transition-colors relative ${
                  isActive
                    ? "text-text-primary"
                    : "text-text-tertiary hover:text-text-secondary"
                }`}
              >
                {name}
                {isActive && (
                  <span className="absolute bottom-0 left-3 right-1 h-[2px] bg-text-primary rounded-full" />
                )}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); closeFile(path); }}
                className="text-text-tertiary hover:text-text-secondary px-1.5 py-1 text-[10px] transition-colors rounded hover:bg-bg-input"
              >
                &#x2715;
              </button>
            </div>
            {i < openFiles.length - 1 && (
              <span className="w-px h-4 bg-border-medium flex-shrink-0" />
            )}
          </React.Fragment>
        );
      })}
      </>}

      {/* Right-aligned actions */}
      <div className="ml-auto flex items-center gap-1 flex-shrink-0">
        {activeView.type === "plan" && (
          <button
            onClick={() => {
              const planContent = document.querySelector(".plan-content");
              if (!planContent) return;
              const md = exportCanvasToMarkdown(planContent as HTMLElement);
              navigator.clipboard.writeText(md).then(() => {
                const btn = document.getElementById("export-md-btn");
                if (btn) { btn.textContent = "Copied!"; setTimeout(() => { btn.textContent = "Copy as MD"; }, 1500); }
              });
            }}
            id="export-md-btn"
            className="px-3 py-1.5 text-[11px] font-medium font-body text-text-tertiary hover:text-text-secondary whitespace-nowrap transition-colors"
          >
            Copy as MD
          </button>
        )}
        {activeView.type === "file" && (
          <button
            onClick={async () => {
              const path = activeView.path;
              try {
                const res = await fetch(`/api/file?session=${sessionId}&path=${encodeURIComponent(path)}`);
                const data = await res.json() as any;
                if (!data.error) {
                  const preview = data.content.split("\n").slice(0, 3).join("\n") + (data.content.split("\n").length > 3 ? "\n..." : "");
                  const id = `ann-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
                  addAnnotationWithId(id, preview, "", path);
                  setActiveAnnotationId(id);
                }
              } catch {}
            }}
            className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium font-body text-text-tertiary hover:text-text-secondary whitespace-nowrap transition-colors"
          >
            <span className="text-[13px] leading-none">+</span>
            Add to context
          </button>
        )}
      </div>
    </div>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}
