import React, { useEffect, useLayoutEffect, useState, useCallback, useRef, createContext, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { SessionContext, ActiveViewCtx } from "#canvas/runtime";
import { AnnotationProvider, useAnnotations } from "./AnnotationProvider";
import { PlanRenderer } from "./PlanRenderer";
import { AnnotationSidebar } from "./AnnotationSidebar";
import { ResponsePreview } from "./ResponsePreview";
import { FileBrowser } from "./FileBrowser";
import { FileViewer } from "./FileViewer";
import { SessionSwitcher } from "./SessionSwitcher";
import { exportCanvasToMarkdown } from "./exportMarkdown";
import { CompareView } from "./CompareView";
import { RevisionSelect } from "./RevisionSelect";

export type ActiveView = { type: "plan" } | { type: "file"; path: string };

export interface RevisionInfo {
  revision: number;
  label?: string;
  sourceFile?: string;
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
  compareRevision: { left: number; right: number } | null;
  setCompareRevision: (rev: { left: number; right: number } | null) => void;
}>({
  currentRevision: 1,
  selectedRevision: 1,
  revisions: [],
  setSelectedRevision: () => {},
  isReadOnly: false,
  compareRevision: null,
  setCompareRevision: () => {},
});

function ThemeSwitcher() {
  const [theme, setTheme] = useState(() => localStorage.getItem("canvas-theme") || document.documentElement.dataset.theme || "dark");

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("canvas-theme", next);
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
  const { currentRevision, selectedRevision, revisions, setSelectedRevision, setCompareRevision } = React.useContext(RevisionContext);

  if (revisions.length <= 1) {
    const only = revisions[0];
    const label = only?.label || `Round ${currentRevision}`;
    return <span className="text-[11px] text-text-tertiary font-body">{label}</span>;
  }

  const isLatest = selectedRevision === currentRevision;

  return (
    <div className="flex items-center gap-1.5">
      <RevisionSelect
        value={selectedRevision}
        onChange={setSelectedRevision}
        accent={isLatest ? "default" : "amber"}
      />
      <button
        onClick={() => {
          const current = revisions.find((r) => r.revision === selectedRevision);
          const sourceFile = current?.sourceFile;
          let left: number;
          if (selectedRevision === currentRevision) {
            // Find previous revision with same sourceFile
            const prev = [...revisions]
              .reverse()
              .find((r) => r.revision < currentRevision && (!sourceFile || r.sourceFile === sourceFile));
            left = prev?.revision ?? Math.max(1, currentRevision - 1);
          } else {
            left = selectedRevision;
          }
          setCompareRevision({ left, right: currentRevision });
        }}
        className="text-[11px] font-body font-medium px-2 py-0.5 rounded-md text-accent-blue hover:bg-accent-blue-muted transition-colors"
      >
        Compare
      </button>
    </div>
  );
}

function App() {
  const sessionId = window.location.pathname.replace("/s/", "") || "";
  const [currentRevision, setCurrentRevision] = useState(1);
  const [selectedRevision, setSelectedRevision] = useState(1);
  const [revisions, setRevisions] = useState<RevisionInfo[]>([]);
  const [compareRevision, setCompareRevision] = useState<{ left: number; right: number } | null>(null);
  const [connected, setConnected] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [activeView, setActiveViewRaw] = useState<ActiveView>({ type: "plan" });
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  // Scroll position restore per view
  const scrollPositions = useRef<Map<string, number>>(new Map());

  const selectedRevInfo = revisions.find((r) => r.revision === selectedRevision);
  const isReadOnly = selectedRevision !== currentRevision || !!selectedRevInfo?.hasFeedback;

  const setActiveView = useCallback((v: ActiveView) => {
    // Save current scroll position before switching
    scrollPositions.current.set(
      activeView.type === "plan" ? "plan" : `file:${activeView.path}`,
      window.scrollY
    );
    setActiveViewRaw(v);
    if (v.type === "file") {
      setOpenFiles((prev) => prev.includes(v.path) ? prev : [...prev, v.path]);
    }
  }, [activeView]);

  const closeFile = useCallback((path: string) => {
    scrollPositions.current.delete(`file:${path}`);
    setOpenFiles((prev) => prev.filter((p) => p !== path));
    setActiveViewRaw((prev) => {
      if (prev.type === "file" && prev.path === path) {
        scrollPositions.current.set(`file:${path}`, window.scrollY);
        return { type: "plan" };
      }
      return prev;
    });
  }, []);

  // Restore scroll synchronously after DOM update (before paint)
  useLayoutEffect(() => {
    const key = activeView.type === "plan" ? "plan" : `file:${activeView.path}`;
    window.scrollTo(0, scrollPositions.current.get(key) || 0);
  }, [activeView]);

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
            setCompareRevision(null);
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
      <RevisionContext.Provider value={{ currentRevision, selectedRevision, revisions, setSelectedRevision, isReadOnly, compareRevision, setCompareRevision }}>
        <AnnotationProvider key={`${sessionId}:${selectedRevision}`} sessionId={sessionId} revision={selectedRevision} isReadOnly={isReadOnly}>
          <ActiveViewContext.Provider value={{ activeView, setActiveView, openFiles, closeFile }}>
          <ActiveViewCtx.Provider value={{ setActiveView }}>
            <div className="min-h-screen bg-bg-base">
              {/* Left panel — fixed to viewport */}
              <LeftPanel sessionId={sessionId} connected={connected} onMobileSidebar={() => setMobileSidebar(!mobileSidebar)} collapsed={leftCollapsed} onToggle={() => setLeftCollapsed((c) => !c)} />

              {/* Right panel — fixed to viewport, resizable (hidden in compare mode) */}
              {compareRevision === null && (
                <ResizableSidebar collapsed={rightCollapsed} onToggle={() => setRightCollapsed((c) => !c)}>
                  <AnnotationSidebar onPreview={() => setPreviewOpen(true)} onSubmit={handleSubmit} />
                </ResizableSidebar>
              )}

              {/* Center content — normal document flow, browser scroll */}
              {compareRevision !== null ? (
                <div className={`${leftCollapsed ? "lg:ml-0" : "lg:ml-60"} transition-[margin] duration-200`}>
                  <CompareView
                    initialLeft={compareRevision.left}
                    initialRight={compareRevision.right}
                    sessionId={sessionId}
                    onExit={() => setCompareRevision(null)}
                  />
                </div>
              ) : (
              <div className={`relative ${leftCollapsed ? "lg:ml-0" : "lg:ml-60"} ${rightCollapsed ? "lg:mr-0" : "lg:mr-[var(--sidebar-width,320px)]"} transition-[margin] duration-200`} id="plan-scroll-container">
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
                {/* All views stay mounted; inactive ones are hidden */}
                <div style={{ display: activeView.type === "plan" ? undefined : "none" }}>
                  <div className="relative max-w-[720px] mx-auto px-6 pt-12 pb-32">
                    <button
                      onClick={() => {
                        const planContent = document.querySelector(".plan-content");
                        if (!planContent) return;
                        const md = exportCanvasToMarkdown(planContent as HTMLElement);
                        navigator.clipboard.writeText(md).then(() => {
                          const btn = document.getElementById("export-md-btn");
                          if (btn) {
                            btn.setAttribute("data-copied", "true");
                            setTimeout(() => { btn.removeAttribute("data-copied"); }, 1500);
                          }
                        });
                      }}
                      id="export-md-btn"
                      className="group absolute top-3 right-6 p-1.5 text-text-tertiary hover:text-text-secondary transition-colors z-10"
                      title="Copy as Markdown"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="group-[[data-copied=true]]:hidden">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                        <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                      </svg>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="hidden group-[[data-copied=true]]:block text-green-500">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    </button>
                    <PlanRenderer revision={selectedRevision} />
                  </div>
                </div>
                {openFiles.map((filePath) => (
                  <div key={filePath} style={{ display: activeView.type === "file" && activeView.path === filePath ? undefined : "none" }}>
                    <FileViewer path={filePath} />
                  </div>
                ))}
              </div>
              )}

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
          </ActiveViewCtx.Provider>
          </ActiveViewContext.Provider>
        </AnnotationProvider>
      </RevisionContext.Provider>
    </SessionContext.Provider>
  );
}

function LeftPanel({ sessionId, connected, onMobileSidebar, collapsed, onToggle }: { sessionId: string; connected: boolean; onMobileSidebar: () => void; collapsed: boolean; onToggle: () => void }) {
  return (
    <>
      {/* Collapsed toggle button */}
      {collapsed && (
        <button
          onClick={onToggle}
          className="hidden lg:flex fixed top-3 left-3 z-20 w-7 h-7 items-center justify-center rounded-md text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated transition-colors bg-bg-surface border border-border-subtle"
          title="Show sidebar"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <line x1="9" y1="3" x2="9" y2="21"/>
          </svg>
        </button>
      )}
      <div className={`hidden lg:flex w-60 flex-col fixed top-0 left-0 bottom-0 bg-bg-surface border-r border-border-subtle z-10 transition-transform duration-200 ${collapsed ? "-translate-x-full" : ""}`}>
        {/* Session + round info */}
        <div className="px-4 pt-4 pb-3 flex-shrink-0 border-b border-border-subtle">
          <div className="flex items-center gap-2 mb-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-text-tertiary flex-shrink-0">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <SessionSwitcher currentSessionId={sessionId} />
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${connected ? "bg-accent-green" : "bg-accent-red"}`} />
            <button
              onClick={onToggle}
              className="ml-auto w-6 h-6 flex items-center justify-center rounded text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated transition-colors"
              title="Hide sidebar"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="11 17 6 12 11 7"/>
                <polyline points="18 17 13 12 18 7"/>
              </svg>
            </button>
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
    </>
  );
}

function ResizableSidebar({ children, collapsed, onToggle }: { children: React.ReactNode; collapsed: boolean; onToggle: () => void }) {
  const [width, setWidth] = useState(() => {
    const saved = localStorage.getItem("canvas-sidebar-width");
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
      localStorage.setItem("canvas-sidebar-width", String(widthRef.current));
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
    <>
      {/* Collapsed toggle button */}
      {collapsed && (
        <button
          onClick={onToggle}
          className="hidden lg:flex fixed top-3 right-3 z-20 w-7 h-7 items-center justify-center rounded-md text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated transition-colors bg-bg-surface border border-border-subtle"
          title="Show annotations"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      )}
      <div className={`hidden lg:flex flex-col fixed top-0 right-0 bottom-0 bg-bg-surface border-l border-border-subtle z-10 transition-transform duration-200 ${collapsed ? "translate-x-full" : ""}`} style={{ width }}>
        {/* Drag handle */}
        <div
          onMouseDown={onMouseDown}
          className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-accent-blue/30 transition-colors z-20"
          style={{ marginLeft: "-2px" }}
        />
        {React.Children.map(children, (child) =>
          React.isValidElement(child)
            ? React.cloneElement(child as React.ReactElement<any>, { collapseButton: (
                <button
                  onClick={onToggle}
                  className="w-6 h-6 flex items-center justify-center rounded text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated transition-colors"
                  title="Hide annotations"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="13 17 18 12 13 7"/>
                    <polyline points="6 17 11 12 6 7"/>
                  </svg>
                </button>
              )})
            : child
        )}
      </div>
    </>
  );
}

function ContentTabs() {
  const { activeView, setActiveView, openFiles, closeFile } = React.useContext(ActiveViewContext);
  const sessionId = React.useContext(SessionContext);
  const { addAnnotationWithId, setActiveAnnotationId } = useAnnotations();

  const showTabs = openFiles.length > 0;
  if (!showTabs) return null;

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
