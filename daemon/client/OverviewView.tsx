import React, { useState, useContext, useMemo, useRef, useEffect, useCallback } from "react";
import { SessionContext } from "#canvas/runtime";
import { PlanRenderer } from "./PlanRenderer";
import { ComparePanelRenderer } from "./CompareView";
import { ActiveViewContext, RevisionContext, type CanvasFileInfo, type RevisionInfo } from "./App";
import { extractBlockTree, matchBlocks, buildUnifiedDom } from "./unifiedDiff";
import { runDomDiff } from "./domDiff";

interface OverviewViewProps {
  revision: number;
  responseBanner?: React.ReactNode;
}

interface FileChange {
  filename: string;
  status: "new" | "changed" | "unchanged";
  diffStats?: { added: number; removed: number };
}

export function categorizeChanges(
  currentRev: RevisionInfo | undefined,
  previousRev: RevisionInfo | undefined,
): FileChange[] {
  if (!currentRev) return [];

  return currentRev.canvasFiles.map(cf => {
    if (!cf.diffStats) {
      return { filename: cf.filename, status: "new" as const };
    }
    if (cf.diffStats.added === 0 && cf.diffStats.removed === 0) {
      return { filename: cf.filename, status: "unchanged" as const, diffStats: cf.diffStats };
    }
    return { filename: cf.filename, status: "changed" as const, diffStats: cf.diffStats };
  });
}

export function getAffectedFiles(changes: FileChange[]): string[] {
  return changes.filter(c => c.status !== "unchanged").map(c => c.filename);
}

export function OverviewView({ revision, responseBanner }: OverviewViewProps) {
  const { setActiveView } = useContext(ActiveViewContext);
  const { revisions } = useContext(RevisionContext);

  const currentRev = revisions.find(r => r.revision === revision);
  const previousRev = revisions.find(r => r.revision === revision - 1);
  const changes = useMemo(() => categorizeChanges(currentRev, previousRev), [currentRev, previousRev]);

  const affected = changes.filter(c => c.status !== "unchanged");
  const unchanged = changes.filter(c => c.status === "unchanged");

  return (
    <div className="max-w-[720px] mx-auto px-6 pt-12 pb-32">
      {responseBanner}

      {affected.map(change => (
        <OverviewFileSection
          key={change.filename}
          change={change}
          revision={revision}
          previousRevision={previousRev?.revision}
          onOpenTab={() => setActiveView({ type: "canvas", filename: change.filename })}
        />
      ))}

      {unchanged.length > 0 && (
        <div className="mt-8 border-t border-border-subtle pt-4">
          <div className="text-[11px] font-body font-medium uppercase tracking-widest text-text-tertiary mb-3">
            Unchanged
          </div>
          {unchanged.map(change => (
            <UnchangedFileRow
              key={change.filename}
              change={change}
              revision={revision}
              onOpenTab={() => setActiveView({ type: "canvas", filename: change.filename })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

type ViewMode = "rendered" | "unified" | "side-by-side";

function ViewModeToggle({ mode, onChange, showDiff }: { mode: ViewMode; onChange: (m: ViewMode) => void; showDiff: boolean }) {
  if (!showDiff) return null;
  return (
    <div className="flex items-center bg-bg-elevated rounded-md p-0.5">
      {(["rendered", "unified", "side-by-side"] as ViewMode[]).map(m => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={`text-[10px] font-body px-2 py-0.5 rounded transition-colors ${
            mode === m
              ? "bg-bg-surface text-text-primary font-medium shadow-sm"
              : "text-text-tertiary hover:text-text-secondary"
          }`}
        >
          {m === "rendered" ? "Full" : m === "unified" ? "Unified" : "Split"}
        </button>
      ))}
    </div>
  );
}

function OverviewFileSection({
  change,
  revision,
  previousRevision,
  onOpenTab,
}: {
  change: FileChange;
  revision: number;
  previousRevision?: number;
  onOpenTab: () => void;
}) {
  const label = change.filename.replace(/\.jsx$/, "");
  const isNew = change.status === "new";
  const diffStats = change.diffStats;
  const canDiff = change.status === "changed" && previousRevision != null;
  const [viewMode, setViewMode] = useState<ViewMode>("rendered");

  return (
    <div className="mb-8">
      {/* File header */}
      <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border-subtle">
        <span className={`text-[11px] font-mono px-1.5 py-0.5 rounded ${
          isNew
            ? "bg-accent-green/10 text-accent-green border border-accent-green/20"
            : "bg-accent-amber/10 text-accent-amber border border-accent-amber/20"
        }`}>
          {isNew ? "new" : "modified"}
        </span>
        <span className="text-[14px] font-body font-medium text-text-primary">{label}</span>
        {diffStats && (diffStats.added > 0 || diffStats.removed > 0) && (
          <span className="text-[11px] font-mono text-text-tertiary">
            <span className="text-accent-green">+{diffStats.added}</span>
            {" "}
            <span className="text-accent-red">-{diffStats.removed}</span>
          </span>
        )}
        <ViewModeToggle mode={viewMode} onChange={setViewMode} showDiff={canDiff} />
        <button
          onClick={onOpenTab}
          className={`${canDiff ? "" : "ml-auto"} text-[11px] font-body font-medium text-accent-blue hover:text-accent-blue/80 transition-colors`}
        >
          Open in tab
        </button>
      </div>

      {/* Content based on view mode */}
      {viewMode === "rendered" ? (
        <div data-canvas-file={change.filename}>
          <PlanRenderer revision={revision} filename={change.filename} />
        </div>
      ) : canDiff && previousRevision != null ? (
        <InlineDiff
          key={`${viewMode}-${revision}-${previousRevision}`}
          filename={change.filename}
          leftRev={previousRevision}
          rightRev={revision}
          mode={viewMode}
        />
      ) : null}
    </div>
  );
}

/* ── Inline diff for overview ── */

function InlineDiff({
  filename,
  leftRev,
  rightRev,
  mode,
}: {
  filename: string;
  leftRev: number;
  rightRev: number;
  mode: "unified" | "side-by-side";
}) {
  const sessionId = useContext(SessionContext);

  if (mode === "unified") {
    return <InlineUnifiedDiff sessionId={sessionId} filename={filename} leftRev={leftRev} rightRev={rightRev} />;
  }
  return <InlineSideBySideDiff sessionId={sessionId} filename={filename} leftRev={leftRev} rightRev={rightRev} />;
}

function InlineUnifiedDiff({ sessionId, filename, leftRev, rightRev }: { sessionId: string; filename: string; leftRev: number; rightRev: number }) {
  const oldRef = useRef<HTMLDivElement>(null);
  const newRef = useRef<HTMLDivElement>(null);
  const unifiedRef = useRef<HTMLDivElement>(null);
  const [leftReady, setLeftReady] = useState(false);
  const [rightReady, setRightReady] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!leftReady || !rightReady || done) return;
    if (!oldRef.current || !newRef.current) return;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!oldRef.current || !newRef.current || !unifiedRef.current) return;
        try {
          const oldTree = extractBlockTree(oldRef.current);
          const newTree = extractBlockTree(newRef.current);
          const matches = matchBlocks(oldTree, newTree);
          const { fragment } = buildUnifiedDom(matches);
          unifiedRef.current.innerHTML = "";
          unifiedRef.current.appendChild(fragment);
          setDone(true);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      });
    });
  }, [leftReady, rightReady, done]);

  return (
    <div>
      {/* Offscreen panels for diff computation */}
      {!done && !error && (
        <div style={{ position: "absolute", left: -9999, visibility: "hidden" as const, pointerEvents: "none" as const, width: 720 }}>
          <ComparePanelRenderer ref={oldRef} sessionId={sessionId} revision={leftRev} filename={filename} onReady={() => setLeftReady(true)} onError={(msg) => setError(msg)} />
          <ComparePanelRenderer ref={newRef} sessionId={sessionId} revision={rightRev} filename={filename} onReady={() => setRightReady(true)} onError={(msg) => setError(msg)} />
        </div>
      )}
      {!done && !error && (
        <div className="flex items-center justify-center h-24 text-text-tertiary font-body text-[13px]">Computing diff...</div>
      )}
      {error && (
        <div className="text-accent-red text-[13px] font-body p-3 bg-accent-red-muted rounded-lg">{error}</div>
      )}
      <div ref={unifiedRef} />
    </div>
  );
}

function InlineSideBySideDiff({ sessionId, filename, leftRev, rightRev }: { sessionId: string; filename: string; leftRev: number; rightRev: number }) {
  const oldRef = useRef<HTMLDivElement>(null);
  const newRef = useRef<HTMLDivElement>(null);
  const [leftReady, setLeftReady] = useState(false);
  const [rightReady, setRightReady] = useState(false);
  const [done, setDone] = useState(false);

  const handleLeftReady = useCallback(() => setLeftReady(true), []);
  const handleRightReady = useCallback(() => setRightReady(true), []);

  useEffect(() => {
    if (!leftReady || !rightReady || done) return;
    if (!oldRef.current || !newRef.current) return;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!oldRef.current || !newRef.current) return;
        runDomDiff(oldRef.current, newRef.current);
        setDone(true);
      });
    });
  }, [leftReady, rightReady, done]);

  return (
    <div className="flex gap-0 border border-border-subtle rounded-lg overflow-hidden">
      <div className="w-1/2 border-r border-border-subtle">
        <div className="px-2 py-1 text-[10px] font-body font-medium text-text-tertiary bg-bg-elevated border-b border-border-subtle">
          Rev {leftRev}
        </div>
        <div className="p-4">
          <ComparePanelRenderer ref={oldRef} sessionId={sessionId} revision={leftRev} filename={filename} onReady={handleLeftReady} />
        </div>
      </div>
      <div className="w-1/2">
        <div className="px-2 py-1 text-[10px] font-body font-medium text-text-tertiary bg-bg-elevated border-b border-border-subtle">
          Rev {rightRev}
        </div>
        <div className="p-4">
          <ComparePanelRenderer ref={newRef} sessionId={sessionId} revision={rightRev} filename={filename} onReady={handleRightReady} />
        </div>
      </div>
    </div>
  );
}

function UnchangedFileRow({
  change,
  revision,
  onOpenTab,
}: {
  change: FileChange;
  revision: number;
  onOpenTab: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const label = change.filename.replace(/\.jsx$/, "");

  return (
    <div className="mb-2">
      <div className="flex items-center gap-2 py-1.5">
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-text-tertiary hover:text-text-secondary transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className={`transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}>
            <path d="M3.5 2L6.5 5L3.5 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <span className="text-[13px] font-body text-text-secondary">{label}</span>
        <button
          onClick={onOpenTab}
          className="ml-auto text-[11px] font-body text-text-tertiary hover:text-accent-blue transition-colors"
        >
          Open in tab
        </button>
      </div>
      {expanded && (
        <div className="ml-5 mt-1 mb-3" data-canvas-file={change.filename}>
          <PlanRenderer revision={revision} filename={change.filename} />
        </div>
      )}
    </div>
  );
}
