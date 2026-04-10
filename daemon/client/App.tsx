import React, { useEffect, useLayoutEffect, useState, useCallback, useRef, createContext, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { marked } from "marked";
import { SessionContext, ActiveViewCtx } from "#canvas/runtime";
import { AnnotationProvider, useAnnotations } from "./AnnotationProvider";
import { PlanRenderer } from "./PlanRenderer";
import { AnnotationSidebar } from "./AnnotationSidebar";
import { FileBrowser } from "./FileBrowser";
import { FileIcon } from "./FileIcon";
import { FileViewer } from "./FileViewer";
import { SessionSwitcher } from "./SessionSwitcher";
import { exportCanvasToMarkdown } from "./exportMarkdown";
import { CompareView } from "./CompareView";
import { OverviewView, categorizeChanges, getAffectedFiles } from "./OverviewView";
import { RevisionSelect } from "./RevisionSelect";
import { generateAnnotationId, RESPONSE_ANNOTATION_PATH } from "./utils";
import { wrapRangeWithMark, restoreMarks, renameMarkId, unwrapMarks, updateAllMarkStates } from "./highlightRange";
import { extractContext } from "./annotationContext";
import { AnnotationCreatePopover, AnnotationEditPopover } from "./Popover";
import { ShareDialog, ShareButton, type ShareEntry } from "./ShareDialog";
import { ReviewerIdentityDialog } from "./ReviewerIdentityDialog";
import type { Annotation } from "#canvas/runtime";
import { MODE, metaUrl, FS_AVAILABLE, WS_AVAILABLE, submitSharedFeedback, getReviewerIdentity, setReviewerIdentity } from "./clientApi";

export type ActiveView = { type: "overview" } | { type: "canvas"; filename: string } | { type: "file"; path: string };

/**
 * Wire shape of a remote feedback entry as delivered by the daemon
 * (polled from CF Worker). Mirrors RemoteFeedbackEntry on the server side.
 */
interface RemoteFeedbackEntry {
  id: string;
  shareId: string;
  revision: number;
  submittedAt: string;
  author: { id: string; name: string };
  annotations: Array<Omit<Annotation, "source" | "author">>;
  generalNote?: string;
}

/**
 * Flatten an array of remote feedback entries into a list of Annotations
 * tagged with author + source so they can be rendered read-only alongside
 * the local author's annotations. The `generalNote` field is intentionally
 * dropped for now — the MVP surfaces only spatial (highlight-anchored)
 * feedback. General notes could be surfaced in a "remote feedback" panel
 * in a later iteration.
 */
function remoteFeedbackToAnnotations(entries: RemoteFeedbackEntry[]): Annotation[] {
  const out: Annotation[] = [];
  for (const entry of entries) {
    for (const ann of entry.annotations) {
      out.push({
        ...ann,
        source: "remote",
        author: entry.author,
      });
    }
  }
  return out;
}

export interface CanvasFileInfo {
  filename: string;
  diffStats?: { added: number; removed: number };
}

export interface RevisionInfo {
  revision: number;
  label?: string;
  canvasFiles: CanvasFileInfo[];
  createdAt: string;
  hasFeedback: boolean;
  feedbackConsumed: boolean;
  response?: string;
}

export const ActiveViewContext = createContext<{
  activeView: ActiveView;
  setActiveView: (v: ActiveView) => void;
  openFiles: string[];
  closeFile: (path: string) => void;
  canvasFiles: string[];
}>({
  activeView: { type: "overview" },
  setActiveView: () => {},
  openFiles: [],
  closeFile: () => {},
  canvasFiles: [],
});

export const RevisionContext = createContext<{
  currentRevision: number;
  selectedRevision: number;
  revisions: RevisionInfo[];
  setSelectedRevision: (rev: number) => void;
  isReadOnly: boolean;
  compareRevision: { left: number; right: number } | null;
  setCompareRevision: (rev: { left: number; right: number } | null) => void;
  agentWatching: boolean;
}>({
  currentRevision: 1,
  selectedRevision: 1,
  revisions: [],
  setSelectedRevision: () => {},
  isReadOnly: false,
  compareRevision: null,
  setCompareRevision: () => {},
  agentWatching: false,
});

function resolveTheme(pref: string): "light" | "dark" {
  if (pref === "auto") return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  return pref as "light" | "dark";
}

function applyTheme(pref: string) {
  document.documentElement.dataset.theme = resolveTheme(pref);
}

function ThemeSwitcher() {
  const [pref, setPref] = useState<"auto" | "light" | "dark">(() => {
    const stored = localStorage.getItem("canvas-theme");
    if (stored === "light" || stored === "dark" || stored === "auto") return stored;
    return "auto";
  });

  useEffect(() => {
    applyTheme(pref);
    if (pref !== "auto") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("auto");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [pref]);

  const toggle = () => {
    const next = pref === "auto" ? "light" : pref === "light" ? "dark" : "auto";
    localStorage.setItem("canvas-theme", next);
    setPref(next);
  };

  const titles = { auto: "Theme: system (click for light)", light: "Theme: light (click for dark)", dark: "Theme: dark (click for system)" };

  return (
    <button
      onClick={toggle}
      className="w-7 h-7 flex items-center justify-center rounded-md text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated transition-colors"
      title={titles[pref]}
    >
      {pref === "auto" ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
      ) : pref === "dark" ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      ) : (
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
    <div className="flex flex-col gap-1">
      <RevisionSelect
        value={selectedRevision}
        onChange={setSelectedRevision}
        accent={isLatest ? "default" : "amber"}
      />
      <button
        onClick={() => {
          let left: number;
          if (selectedRevision === currentRevision) {
            const prev = [...revisions]
              .reverse()
              .find((r) => r.revision < currentRevision);
            left = prev?.revision ?? Math.max(1, currentRevision - 1);
          } else {
            left = selectedRevision;
          }
          setCompareRevision({ left, right: currentRevision });
        }}
        className="text-[11px] font-body font-medium px-2 py-0.5 rounded-md text-accent-blue hover:bg-accent-blue-muted transition-colors self-start"
      >
        Compare
      </button>
    </div>
  );
}

function App() {
  // In shared mode the "sessionId" as far as the annotation system cares is
  // the shareId (stable identifier for localStorage scoping). In local mode
  // it's the real daemon session id from the URL.
  const sessionId = MODE.isShared ? MODE.shareId : MODE.sessionId;
  const isSharedMode = MODE.isShared;
  const [currentRevision, setCurrentRevision] = useState(1);
  const [selectedRevision, setSelectedRevision] = useState(1);
  const [revisions, setRevisions] = useState<RevisionInfo[]>([]);
  const [compareRevision, setCompareRevision] = useState<{ left: number; right: number } | null>(null);
  const [connected, setConnected] = useState(false);
  const [sharedFeedbackSubmitted, setSharedFeedbackSubmitted] = useState(false);
  const [agentWatching, setAgentWatching] = useState(false);
  const [canvasFiles, setCanvasFiles] = useState<string[]>([]);
  const [activeView, setActiveViewRaw] = useState<ActiveView>({ type: "overview" });
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  const [projectRoot, setProjectRoot] = useState<string | undefined>();
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shares, setShares] = useState<ShareEntry[]>([]);
  const [shareEnabled, setShareEnabled] = useState(false);
  // Remote annotations keyed by revision — merged read-only into the
  // annotation provider so reviewer feedback shows up as extra annotations.
  const [remoteAnnotationsByRev, setRemoteAnnotationsByRev] = useState<Map<number, Annotation[]>>(new Map());
  // Shared-mode state
  const [reviewerDialogOpen, setReviewerDialogOpen] = useState(false);
  const [pendingFeedback, setPendingFeedback] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: "error" | "success"; message: string } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // Dynamic document title
  useEffect(() => {
    const parts = ["Agent Canvas"];
    if (projectRoot) {
      const segments = projectRoot.replace(/\/+$/, "").split("/");
      parts.push(segments[segments.length - 1] || sessionId);
    } else if (sessionId) {
      parts.push(sessionId);
    }
    if (activeView.type === "file") {
      parts.push(activeView.path.split("/").pop() || activeView.path);
    } else if (activeView.type === "overview") {
      parts.push("Overview");
    } else if (activeView.type === "canvas" && canvasFiles.length > 1 && activeView.filename) {
      parts.push(activeView.filename.replace(/\.jsx$/, ""));
    } else if (compareRevision) {
      parts.push("Compare");
    }
    document.title = parts.join(" — ");
  }, [sessionId, projectRoot, activeView, compareRevision]);

  // Scroll position restore per view
  const scrollPositions = useRef<Map<string, number>>(new Map());

  const selectedRevInfo = revisions.find((r) => r.revision === selectedRevision);
  const isReadOnly = selectedRevision !== currentRevision || !!selectedRevInfo?.hasFeedback || sharedFeedbackSubmitted;

  const setActiveView = useCallback((v: ActiveView) => {
    // Save current scroll position before switching
    const key = activeView.type === "overview" ? "overview" : activeView.type === "canvas" ? `canvas:${activeView.filename}` : `file:${activeView.path}`;
    scrollPositions.current.set(key, window.scrollY);
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
        return canvasFiles.length > 1 ? { type: "overview" } : { type: "canvas", filename: canvasFiles[0] || "" };
      }
      return prev;
    });
  }, [canvasFiles]);

  // Restore scroll synchronously after DOM update (before paint)
  useLayoutEffect(() => {
    const key = activeView.type === "overview" ? "overview" : activeView.type === "canvas" ? `canvas:${activeView.filename}` : `file:${activeView.path}`;
    window.scrollTo(0, scrollPositions.current.get(key) || 0);
  }, [activeView]);

  // Fetch initial meta
  useEffect(() => {
    if (!sessionId) return;
    fetch(metaUrl())
      .then((r) => r.json())
      .then((data: any) => {
        if (data.currentRevision) {
          setCurrentRevision(data.currentRevision);
          setSelectedRevision(data.currentRevision);
          setRevisions(data.revisions || []);
        }
        if (data.canvasFiles) {
          const files = (data.canvasFiles as string[]).sort();
          setCanvasFiles(files);
          setActiveViewRaw((prev) => {
            if (prev.type === "overview") {
              // On initial load: overview if multiple files, direct if single
              return files.length > 1 ? prev : { type: "canvas", filename: files[0] || "" };
            }
            if (prev.type === "canvas" && (!prev.filename || !files.includes(prev.filename))) {
              return { type: "canvas", filename: files[0] || "" };
            }
            return prev;
          });
        }
        if (data.projectRoot) setProjectRoot(data.projectRoot);
        if (Array.isArray(data.shares)) setShares(data.shares);
        setShareEnabled(!!data.shareEnabled);
      })
      .catch(() => {});
  }, [sessionId]);

  // Load any already-persisted remote feedback for the currently selected
  // revision on first render. New entries arrive via WebSocket broadcast.
  // This only runs in local (daemon) mode — shared mode has no notion of
  // "previously polled remote feedback": the reviewer IS the remote.
  useEffect(() => {
    if (!sessionId || !selectedRevision || isSharedMode) return;
    fetch(`/api/session/${sessionId}/revision/${selectedRevision}/remote-feedback`)
      .then((r) => r.json())
      .then((data: any) => {
        if (!Array.isArray(data.entries)) return;
        const anns = remoteFeedbackToAnnotations(data.entries);
        setRemoteAnnotationsByRev((prev) => {
          const next = new Map(prev);
          next.set(selectedRevision, anns);
          return next;
        });
      })
      .catch(() => {});
  }, [sessionId, selectedRevision, isSharedMode]);

  useEffect(() => {
    if (!sessionId) return;
    if (!WS_AVAILABLE) {
      // In shared mode there is no WebSocket — the worker only exposes HTTP.
      // Live updates and watcher status are unavailable. The canvas is a
      // static snapshot from the author's perspective, so "connected" is
      // effectively always true.
      setConnected(true);
      return;
    }
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
            if (data.revisions) {
              const allRevisions = data.revisions as RevisionInfo[];
              setRevisions(allRevisions);
              const latest = allRevisions.find((r: RevisionInfo) => r.revision === data.currentRevision);
              if (latest?.canvasFiles) {
                const files = latest.canvasFiles.map((cf: CanvasFileInfo) => cf.filename).sort();
                setCanvasFiles(files);
                // Determine what changed and auto-navigate
                const previous = allRevisions.find((r: RevisionInfo) => r.revision === data.currentRevision - 1);
                const changes = categorizeChanges(latest, previous);
                const affected = getAffectedFiles(changes);
                if (affected.length === 1) {
                  setActiveViewRaw({ type: "canvas", filename: affected[0] });
                } else if (affected.length > 1 || files.length > 1) {
                  setActiveViewRaw({ type: "overview" });
                } else {
                  setActiveViewRaw({ type: "canvas", filename: files[0] || "" });
                }
              }
            }
          }
          if (data.type === "revision-updated") {
            if (data.revisions) setRevisions(data.revisions);
          }
          if (data.type === "watcher-status") {
            setAgentWatching(!!data.watching);
          }
          if (data.type === "remote-feedback") {
            const rev = data.revision as number;
            const entries = (data.entries || []) as RemoteFeedbackEntry[];
            const anns = remoteFeedbackToAnnotations(entries);
            setRemoteAnnotationsByRev((prev) => {
              const next = new Map(prev);
              const existing = next.get(rev) || [];
              const seenIds = new Set(existing.map((a) => a.id));
              const merged = [...existing, ...anns.filter((a) => !seenIds.has(a.id))];
              next.set(rev, merged);
              return next;
            });
          }
        } catch {}
      };
    };
    connect();
    return () => { if (reconnectTimer) clearTimeout(reconnectTimer); wsRef.current?.close(); };
  }, [sessionId]);

  const submitSharedFeedbackWithIdentity = useCallback(async (feedback: string, identity: { id: string; name: string }) => {
    try {
      const raw = localStorage.getItem(`canvas:${sessionId}:rev:${selectedRevision}`);
      let structuredAnnotations: any[] = [];
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          structuredAnnotations = (parsed.annotations || []).filter((a: any) => a.source !== "remote");
        } catch {}
      }
      await submitSharedFeedback({
        author: identity,
        revision: selectedRevision,
        annotations: structuredAnnotations,
        generalNote: feedback,
      });
      setSharedFeedbackSubmitted(true);
      setToast({ kind: "success", message: "Feedback submitted. The canvas author will see it shortly." });
    } catch (e: any) {
      setToast({ kind: "error", message: `Failed to submit feedback: ${e.message || e}` });
    }
  }, [sessionId, selectedRevision]);

  const handleSubmit = useCallback(async (feedback: string) => {
    if (isSharedMode) {
      // Shared mode: POST feedback to the worker via the reviewer identity
      // modal flow. If identity already cached, skip the modal.
      const identity = getReviewerIdentity();
      if (!identity) {
        setPendingFeedback(feedback);
        setReviewerDialogOpen(true);
        return;
      }
      await submitSharedFeedbackWithIdentity(feedback, identity);
      return;
    }

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "submit", feedback }));
      // Server will broadcast revision-updated with hasFeedback: true
      // which triggers isReadOnly via revisions state
    }
  }, [isSharedMode, submitSharedFeedbackWithIdentity]);

  if (!sessionId) {
    return <div className="flex items-center justify-center h-screen text-text-tertiary font-body">No session selected.</div>;
  }

  return (
    <SessionContext.Provider value={sessionId}>
      <RevisionContext.Provider value={{ currentRevision, selectedRevision, revisions, setSelectedRevision, isReadOnly, compareRevision, setCompareRevision, agentWatching }}>
        <AnnotationProvider
          key={`${sessionId}:${selectedRevision}`}
          sessionId={sessionId}
          revision={selectedRevision}
          isReadOnly={isReadOnly}
          remoteAnnotations={remoteAnnotationsByRev.get(selectedRevision)}
        >
          <ActiveViewContext.Provider value={{ activeView, setActiveView, openFiles, closeFile, canvasFiles }}>
          <ActiveViewCtx.Provider value={{ setActiveView }}>
            <div className="min-h-screen bg-bg-base">
              {/* Left panel — fixed to viewport */}
              <LeftPanel sessionId={sessionId} projectRoot={projectRoot} connected={connected} onMobileSidebar={() => setMobileSidebar(!mobileSidebar)} collapsed={leftCollapsed} onToggle={() => setLeftCollapsed((c) => !c)} />

              {/* Right panel — fixed to viewport, resizable */}
              <ResizableSidebar collapsed={rightCollapsed} onToggle={() => setRightCollapsed((c) => !c)}>
                <AnnotationSidebar onSubmit={handleSubmit} />
              </ResizableSidebar>

              {/* Center content — normal document flow, browser scroll */}
              {compareRevision !== null ? (
                <div className={`${leftCollapsed ? "lg:ml-0" : "lg:ml-60"} ${rightCollapsed ? "lg:mr-0" : "lg:mr-[var(--sidebar-width,320px)]"} transition-[margin] duration-200`}>
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
                    {!isSharedMode && <SessionSwitcher currentSessionId={sessionId} projectRoot={projectRoot} />}
                    {isSharedMode && <span className="text-[11px] text-text-tertiary font-body">Shared canvas</span>}
                    {!isSharedMode && <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-accent-green" : "bg-accent-red"}`} />}
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
                {/* Overview — shows all affected canvases inline */}
                {activeView.type === "overview" && (
                  <OverviewView
                    revision={selectedRevision}
                    responseBanner={selectedRevInfo?.response ? <ResponseBanner markdown={selectedRevInfo.response} /> : undefined}
                  />
                )}
                {/* Individual canvas view — only mounted when active */}
                {activeView.type === "canvas" && canvasFiles.includes(activeView.filename) && (
                  <div className="relative max-w-[720px] mx-auto px-6 pt-12 pb-32">
                    {shareEnabled && (
                      <div className="absolute top-3 right-12 z-10">
                        <ShareButton
                          onClick={() => setShareDialogOpen(true)}
                          hasShare={shares.some((s) => s.revision === selectedRevision)}
                          title={shares.some((s) => s.revision === selectedRevision) ? "Manage share link" : "Share this revision"}
                        />
                      </div>
                    )}
                    <button
                      onClick={() => {
                        const planContent = document.querySelector(`[data-canvas-file="${activeView.filename}"] .plan-content`);
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
                    {/* Show response banner on individual canvas only when there's no overview (single canvas) */}
                    {canvasFiles.length <= 1 && selectedRevInfo?.response && (
                      <ResponseBanner markdown={selectedRevInfo.response} />
                    )}
                    <div data-canvas-file={activeView.filename}>
                      <PlanRenderer key={activeView.filename} revision={selectedRevision} filename={activeView.filename} />
                    </div>
                  </div>
                )}
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
                      <AnnotationSidebar onSubmit={handleSubmit} />
                    </div>
                  </div>
                </div>
              )}

              <ShareDialog
                sessionId={sessionId}
                revision={selectedRevision}
                open={shareDialogOpen}
                shareEnabled={shareEnabled}
                existingShares={shares}
                onClose={() => setShareDialogOpen(false)}
                onShareCreated={(share) => {
                  setShares((prev) => [...prev.filter((s) => s.shareId !== share.shareId), share]);
                  setToast({ kind: "success", message: "Share link created. Copy and send it to reviewers." });
                }}
                onShareRevoked={(shareId) => {
                  setShares((prev) => prev.filter((s) => s.shareId !== shareId));
                  setToast({ kind: "success", message: "Share link revoked." });
                }}
              />

              <ReviewerIdentityDialog
                open={reviewerDialogOpen}
                onClose={() => { setReviewerDialogOpen(false); setPendingFeedback(null); }}
                onSubmit={async (name) => {
                  const identity = setReviewerIdentity(name);
                  setReviewerDialogOpen(false);
                  if (pendingFeedback !== null) {
                    await submitSharedFeedbackWithIdentity(pendingFeedback, identity);
                    setPendingFeedback(null);
                  }
                }}
              />

              {toast && (
                <div
                  className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-lg shadow-lg text-[13px] font-body font-medium flex items-center gap-2 ${
                    toast.kind === "error"
                      ? "bg-accent-red text-white"
                      : "bg-accent-green text-white"
                  }`}
                >
                  {toast.message}
                  <button
                    onClick={() => setToast(null)}
                    className="ml-2 opacity-70 hover:opacity-100"
                  >
                    &#x2715;
                  </button>
                </div>
              )}
            </div>
          </ActiveViewCtx.Provider>
          </ActiveViewContext.Provider>
        </AnnotationProvider>
      </RevisionContext.Provider>
    </SessionContext.Provider>
  );
}

function LeftPanel({ sessionId, projectRoot, connected, onMobileSidebar, collapsed, onToggle }: { sessionId: string; projectRoot?: string; connected: boolean; onMobileSidebar: () => void; collapsed: boolean; onToggle: () => void }) {
  const isSharedMode = MODE.isShared;
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
            {isSharedMode ? (
              <span className="text-[12px] font-body text-text-secondary truncate flex-1">Shared canvas</span>
            ) : (
              <>
                <SessionSwitcher currentSessionId={sessionId} projectRoot={projectRoot} />
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${connected ? "bg-accent-green" : "bg-accent-red"}`} />
              </>
            )}
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

function ResponseBanner({ markdown }: { markdown: string }) {
  const [dismissed, setDismissed] = useState(false);
  const html = useMemo(() => marked.parse(markdown, { async: false }) as string, [markdown]);
  const contentRef = useRef<HTMLDivElement>(null);
  const { annotations, addAnnotationWithId, removeAnnotation, updateAnnotation, addAnnotationImage, removeAnnotationImage, activeAnnotationId, setActiveAnnotationId } = useAnnotations();
  const [createPopover, setCreatePopover] = useState<{ anchorEl: HTMLElement; tempId: string; snippet: string; ctx: any } | null>(null);
  const [editPopover, setEditPopover] = useState<{ anchorEl: HTMLElement; annId: string } | null>(null);

  const responseAnnotations = useMemo(() => annotations.filter((a) => a.filePath === RESPONSE_ANNOTATION_PATH), [annotations]);

  // Reset dismissed state when markdown changes
  const [prevMarkdown, setPrevMarkdown] = useState(markdown);
  if (markdown !== prevMarkdown) {
    setPrevMarkdown(markdown);
    setDismissed(false);
  }

  // Restore marks after content renders
  useEffect(() => {
    if (!contentRef.current || responseAnnotations.length === 0) return;
    const timer = setTimeout(() => {
      if (contentRef.current) restoreMarks(contentRef.current, responseAnnotations);
    }, 50);
    return () => clearTimeout(timer);
  }, [html, responseAnnotations.length]);

  // Update mark active states
  const prevActiveRef = useRef<string | null>(null);
  useEffect(() => {
    updateAllMarkStates(activeAnnotationId, prevActiveRef.current);
    prevActiveRef.current = activeAnnotationId;
  }, [activeAnnotationId]);

  // Click/hover handlers on marks
  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;
    const handleClick = (e: MouseEvent) => {
      const mark = (e.target as HTMLElement).closest("[data-annotation-id]") as HTMLElement | null;
      if (!mark) return;
      e.stopPropagation();
      const annId = mark.getAttribute("data-annotation-id")!;
      if (annId === activeAnnotationId) {
        setEditPopover({ anchorEl: mark, annId });
      } else {
        setActiveAnnotationId(annId);
      }
    };
    const handleMouseOver = (e: MouseEvent) => {
      const mark = (e.target as HTMLElement).closest("[data-annotation-id]") as HTMLElement | null;
      if (mark) setActiveAnnotationId(mark.getAttribute("data-annotation-id")!);
    };
    const handleMouseOut = (e: MouseEvent) => {
      const mark = (e.target as HTMLElement).closest("[data-annotation-id]");
      const relatedMark = (e.relatedTarget as HTMLElement | null)?.closest?.("[data-annotation-id]");
      if (mark && !relatedMark) setActiveAnnotationId(null);
    };
    container.addEventListener("click", handleClick);
    container.addEventListener("mouseover", handleMouseOver);
    container.addEventListener("mouseout", handleMouseOut);
    return () => {
      container.removeEventListener("click", handleClick);
      container.removeEventListener("mouseover", handleMouseOver);
      container.removeEventListener("mouseout", handleMouseOut);
    };
  }, [html, activeAnnotationId]);

  // Text selection → annotation
  useEffect(() => {
    const handler = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
      if (!contentRef.current) return;
      const range = sel.getRangeAt(0);
      if (!contentRef.current.contains(range.startContainer)) return;
      if ((range.startContainer.parentElement as HTMLElement)?.closest?.("[data-annotation-id]")) return;
      const snippet = sel.toString().trim();
      if (snippet.length < 2) return;
      const savedRange = range.cloneRange();
      const ctx = extractContext(range, contentRef.current);
      const tempId = `__pending_${Date.now()}`;
      try { wrapRangeWithMark(savedRange, tempId); } catch {}
      window.getSelection()?.removeAllRanges();
      const marks = document.querySelectorAll(`[data-annotation-id="${tempId}"]`);
      const lastMark = marks[marks.length - 1] as HTMLElement | undefined;
      if (!lastMark) return;
      setCreatePopover({ anchorEl: lastMark, tempId, snippet, ctx });
    };
    document.addEventListener("mouseup", handler);
    return () => document.removeEventListener("mouseup", handler);
  }, []);

  if (dismissed) return null;

  const scrollContainer = document.getElementById("plan-scroll-container");

  return (
    <div className="mb-6 rounded-lg border border-accent-blue/20 bg-accent-blue/5 relative">
      <button
        onClick={() => setDismissed(true)}
        className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated transition-colors"
      >
        <span className="text-xs">&#x2715;</span>
      </button>
      <div className="px-4 py-3 pr-10">
        <div className="flex items-center gap-2 mb-1.5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent-blue flex-shrink-0">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span className="text-[11px] font-medium uppercase tracking-widest text-accent-blue font-body">Agent Response</span>
        </div>
        <div ref={contentRef} className="prose-canvas text-sm" dangerouslySetInnerHTML={{ __html: html }} />
      </div>

      {createPopover && (
        <AnnotationCreatePopover
          anchorEl={createPopover.anchorEl}
          scrollContainer={scrollContainer}
          snippet={createPopover.snippet}
          truncateAt={80}
          onAdd={(note, images) => {
            const id = generateAnnotationId();
            renameMarkId(createPopover.tempId, id);
            addAnnotationWithId(id, createPopover.snippet, note, RESPONSE_ANNOTATION_PATH, createPopover.ctx, images);
            setCreatePopover(null);
          }}
          onCancel={() => {
            unwrapMarks(createPopover.tempId);
            setCreatePopover(null);
          }}
        />
      )}

      {editPopover && (() => {
        const ann = annotations.find((a) => a.id === editPopover.annId);
        if (!ann) return null;
        return (
          <AnnotationEditPopover
            anchorEl={editPopover.anchorEl}
            scrollContainer={scrollContainer}
            initialNote={ann.note}
            initialImages={ann.images}
            onUpdate={(note, images) => {
              updateAnnotation(editPopover.annId, note);
              const current = ann.images || [];
              for (const img of images) {
                if (!current.includes(img)) addAnnotationImage(editPopover.annId, img);
              }
              for (const img of current) {
                if (!images.includes(img)) removeAnnotationImage(editPopover.annId, img);
              }
            }}
            onDelete={() => { removeAnnotation(editPopover.annId); setActiveAnnotationId(null); }}
            onClose={() => setEditPopover(null)}
          />
        );
      })()}
    </div>
  );
}

function ContentTabs() {
  const { activeView, setActiveView, openFiles, closeFile, canvasFiles } = React.useContext(ActiveViewContext);
  const sessionId = React.useContext(SessionContext);
  const { addAnnotationWithId, setActiveAnnotationId } = useAnnotations();

  const showTabs = canvasFiles.length > 1 || openFiles.length > 0;
  if (!showTabs) return null;

  return (
    <div className="flex items-center border-b border-border-medium bg-bg-surface overflow-x-auto sticky top-0 z-10">
      {/* Overview tab — only when multiple canvases */}
      {canvasFiles.length > 1 && (
        <>
          <button
            onClick={() => setActiveView({ type: "overview" })}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-body whitespace-nowrap transition-colors relative ${
              activeView.type === "overview"
                ? "text-text-primary"
                : "text-text-tertiary hover:text-text-secondary"
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="opacity-60">
              <path d="M12 7L2 12l10 5 10-5-10-5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Overview
            {activeView.type === "overview" && (
              <span className="absolute bottom-0 left-3 right-3 h-[2px] bg-text-primary rounded-full" />
            )}
          </button>
          <span className="w-px h-4 bg-border-medium flex-shrink-0" />
        </>
      )}

      {/* Canvas tabs */}
      {canvasFiles.map((filename, i) => {
        const label = filename.replace(/\.jsx$/, "");
        const isActive = activeView.type === "canvas" && activeView.filename === filename;
        return (
          <React.Fragment key={filename}>
            <button
              onClick={() => setActiveView({ type: "canvas", filename })}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-body whitespace-nowrap transition-colors relative ${
                isActive
                  ? "text-text-primary"
                  : "text-text-tertiary hover:text-text-secondary"
              }`}
            >
              {label}
              {isActive && (
                <span className="absolute bottom-0 left-3 right-3 h-[2px] bg-text-primary rounded-full" />
              )}
            </button>
            {i < canvasFiles.length - 1 && (
              <span className="w-px h-4 bg-border-medium flex-shrink-0" />
            )}
          </React.Fragment>
        );
      })}

      {openFiles.length > 0 && <>
      {/* Separator between canvas and file tabs */}
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
                className={`flex items-center gap-1.5 pl-3 pr-1 py-2.5 text-[13px] font-body whitespace-nowrap transition-colors relative ${
                  isActive
                    ? "text-text-primary"
                    : "text-text-tertiary hover:text-text-secondary"
                }`}
              >
                <FileIcon name={name} type="file" />
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
        {activeView.type === "file" && FS_AVAILABLE && (
          <button
            onClick={async () => {
              const path = activeView.path;
              try {
                const res = await fetch(`/api/file?session=${sessionId}&path=${encodeURIComponent(path)}`);
                const data = await res.json() as any;
                if (!data.error) {
                  const preview = data.content.split("\n").slice(0, 3).join("\n") + (data.content.split("\n").length > 3 ? "\n..." : "");
                  const id = generateAnnotationId();
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
