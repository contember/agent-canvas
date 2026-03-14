import React, { useEffect, useState, useCallback, useRef, createContext } from "react";
import { createRoot } from "react-dom/client";
import { SessionContext } from "@planner/runtime";
import { AnnotationProvider } from "./AnnotationProvider";
import { PlanRenderer } from "./PlanRenderer";
import { AnnotationSidebar } from "./AnnotationSidebar";
import { ResponsePreview } from "./ResponsePreview";
import { FileBrowser } from "./FileBrowser";
import { FileViewer } from "./FileViewer";
import { SessionSwitcher } from "./SessionSwitcher";

export type ActiveView = { type: "plan" } | { type: "file"; path: string };

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

function App() {
  const sessionId = window.location.pathname.replace("/s/", "") || "";
  const [version, setVersion] = useState(1);
  const [connected, setConnected] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [activeView, setActiveViewRaw] = useState<ActiveView>({ type: "plan" });
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

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
          if (data.type === "plan-updated") setVersion(data.version);
        } catch {}
      };
    };
    connect();
    return () => { if (reconnectTimer) clearTimeout(reconnectTimer); wsRef.current?.close(); };
  }, [sessionId]);

  const handleSubmit = useCallback((feedback: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "submit", feedback }));
    }
  }, []);

  if (!sessionId) {
    return <div className="flex items-center justify-center h-screen text-text-tertiary font-body">No session selected.</div>;
  }

  return (
    <SessionContext.Provider value={sessionId}>
      <AnnotationProvider>
        <ActiveViewContext.Provider value={{ activeView, setActiveView, openFiles, closeFile }}>
          <div className="flex flex-col h-screen bg-bg-base">
            {/* Top bar */}
            <header className="flex items-center justify-between px-5 py-2.5 border-b border-border-subtle bg-bg-surface flex-shrink-0">
              <div className="flex items-center gap-3">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-text-tertiary">
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <SessionSwitcher currentSessionId={sessionId} />
                <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-accent-green" : "bg-accent-red"}`} />
              </div>
            </header>

            <div className="flex flex-1 overflow-hidden">
              <FileBrowser />

              {/* Center content */}
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* Tab bar */}
                <ContentTabs />

                {/* Content area */}
                <div className="flex-1 overflow-y-auto" id="plan-scroll-container">
                  {activeView.type === "plan" ? (
                    <div className="max-w-[720px] mx-auto px-6 pt-12 pb-32">
                      <PlanRenderer version={version} />
                    </div>
                  ) : (
                    <FileViewer path={activeView.path} />
                  )}
                </div>
              </div>

              {/* Right sidebar */}
              <div className="w-80 border-l border-border-subtle flex flex-col bg-bg-surface" style={{ minWidth: "280px" }}>
                <AnnotationSidebar onPreview={() => setPreviewOpen(true)} onSubmit={handleSubmit} />
              </div>
            </div>

            <ResponsePreview open={previewOpen} onClose={() => setPreviewOpen(false)} onSubmit={handleSubmit} />
          </div>
        </ActiveViewContext.Provider>
      </AnnotationProvider>
    </SessionContext.Provider>
  );
}

function ContentTabs() {
  const { activeView, setActiveView, openFiles, closeFile } = React.useContext(ActiveViewContext);

  if (openFiles.length === 0) return null;

  return (
    <div className="flex items-center border-b border-[rgba(255,248,240,0.08)] bg-bg-surface overflow-x-auto flex-shrink-0">
      {/* Plan tab */}
      <button
        onClick={() => setActiveView({ type: "plan" })}
        className={`flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-body whitespace-nowrap transition-colors relative ${
          activeView.type === "plan"
            ? "text-[#e8e4df]"
            : "text-[#847d75] hover:text-[#b0a99f]"
        }`}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="opacity-60">
          <path d="M12 2L2 7l10 5 10-5-10-5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Plan
        {activeView.type === "plan" && (
          <span className="absolute bottom-0 left-3 right-3 h-[2px] bg-[#e8e4df] rounded-full" />
        )}
      </button>

      {/* Separator */}
      <span className="w-px h-4 bg-[rgba(255,248,240,0.08)] flex-shrink-0" />

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
                    ? "text-[#e8e4df]"
                    : "text-[#847d75] hover:text-[#b0a99f]"
                }`}
              >
                {name}
                {isActive && (
                  <span className="absolute bottom-0 left-3 right-1 h-[2px] bg-[#e8e4df] rounded-full" />
                )}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); closeFile(path); }}
                className="text-[#847d75] hover:text-[#b0a99f] px-1.5 py-1 text-[10px] transition-colors rounded hover:bg-[rgba(255,248,240,0.05)]"
              >
                &#x2715;
              </button>
            </div>
            {i < openFiles.length - 1 && (
              <span className="w-px h-4 bg-[rgba(255,248,240,0.08)] flex-shrink-0" />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}
