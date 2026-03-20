import React, { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { RevisionSelect } from "./RevisionSelect";
import { runDomDiff } from "./domDiff";
import { extractBlockTree, matchBlocks, buildUnifiedDom } from "./unifiedDiff";
import { useAnnotations } from "./AnnotationProvider";
import { useTextAnnotation } from "./useTextAnnotation";
import { extractContext } from "./annotationContext";

interface CompareViewProps {
  initialLeft: number;
  initialRight: number;
  sessionId: string;
  onExit: () => void;
}

type CompareMode = "unified" | "side-by-side";

export function CompareView({ initialLeft, initialRight, sessionId, onExit }: CompareViewProps) {
  const [leftRev, setLeftRev] = useState(initialLeft);
  const [rightRev, setRightRev] = useState(initialRight);
  const [mode, setMode] = useState<CompareMode>("unified");
  const [hasChanges, setHasChanges] = useState(true);
  const [diffDone, setDiffDone] = useState(false);

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border-subtle bg-bg-surface flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-[13px] font-body font-medium text-text-primary">Compare</span>
          <RevisionSelect value={leftRev} onChange={setLeftRev} accent="red" />
          <span className="text-text-tertiary text-[13px]">&rarr;</span>
          <RevisionSelect value={rightRev} onChange={setRightRev} accent="green" />
          {diffDone && !hasChanges && (
            <span className="text-[11px] font-body text-text-tertiary bg-bg-elevated px-2 py-0.5 rounded">
              No changes
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          {/* Mode toggle */}
          <div className="flex items-center bg-bg-elevated rounded-md p-0.5">
            <button
              onClick={() => setMode("unified")}
              className={`text-[11px] font-body px-2.5 py-1 rounded transition-colors ${
                mode === "unified"
                  ? "bg-bg-surface text-text-primary font-medium shadow-sm"
                  : "text-text-tertiary hover:text-text-secondary"
              }`}
            >
              Unified
            </button>
            <button
              onClick={() => setMode("side-by-side")}
              className={`text-[11px] font-body px-2.5 py-1 rounded transition-colors ${
                mode === "side-by-side"
                  ? "bg-bg-surface text-text-primary font-medium shadow-sm"
                  : "text-text-tertiary hover:text-text-secondary"
              }`}
            >
              Side-by-side
            </button>
          </div>

          {/* Sync scroll — only in side-by-side mode */}
          {mode === "side-by-side" && <SyncScrollCheckbox />}

          <button
            onClick={onExit}
            className="text-[12px] font-body font-medium text-text-secondary hover:text-text-primary px-3 py-1.5 rounded-md hover:bg-bg-elevated transition-colors"
          >
            Exit Compare
          </button>
        </div>
      </div>

      {mode === "unified" ? (
        <UnifiedView
          key={`unified-${leftRev}-${rightRev}`}
          sessionId={sessionId}
          leftRev={leftRev}
          rightRev={rightRev}
          onDiffResult={(done, changes) => { setDiffDone(done); setHasChanges(changes); }}
        />
      ) : (
        <SideBySideView
          key={`sbs-${leftRev}-${rightRev}`}
          sessionId={sessionId}
          leftRev={leftRev}
          rightRev={rightRev}
          onDiffResult={(done, changes) => { setDiffDone(done); setHasChanges(changes); }}
        />
      )}
    </div>
  );
}

/* ── Sync scroll checkbox (lifted out to avoid re-render issues) ── */

function SyncScrollCheckbox() {
  const [checked, setChecked] = useState(true);
  // Store in a ref accessible to SideBySideView via DOM attribute
  useEffect(() => {
    document.documentElement.dataset.syncScroll = checked ? "1" : "0";
    return () => { delete document.documentElement.dataset.syncScroll; };
  }, [checked]);

  return (
    <label className="flex items-center gap-1.5 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => setChecked(e.target.checked)}
        className="accent-accent-amber w-3.5 h-3.5"
      />
      <span className="text-[11px] font-body text-text-secondary">Sync scroll</span>
    </label>
  );
}

/* ── Unified view ── */

interface ViewProps {
  sessionId: string;
  leftRev: number;
  rightRev: number;
  onDiffResult: (done: boolean, hasChanges: boolean) => void;
}

function UnifiedView({ sessionId, leftRev, rightRev, onDiffResult }: ViewProps) {
  const oldRef = useRef<HTMLDivElement>(null);
  const newRef = useRef<HTMLDivElement>(null);
  const unifiedRef = useRef<HTMLDivElement>(null);
  const [leftReady, setLeftReady] = useState(false);
  const [rightReady, setRightReady] = useState(false);
  const [done, setDone] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [slow, setSlow] = useState(false);

  const { annotations } = useAnnotations();
  const planAnnotations = annotations.filter(a => !a.filePath);
  const { popovers } = useTextAnnotation({
    containerRef: unifiedRef,
    restoreKey: done,
    restoreAnnotations: planAnnotations,
    extractContext: (range) => extractContext(range, unifiedRef.current!),
  });

  // Detect stuck loading — log diagnostic state after 10s
  useEffect(() => {
    if (done || loadError) return;
    const id = setTimeout(() => {
      console.warn("[unified-diff] still loading after 10s", {
        leftReady, rightReady, oldRef: !!oldRef.current, newRef: !!newRef.current,
      });
      setSlow(true);
    }, 10_000);
    return () => clearTimeout(id);
  }, [done, loadError, leftReady, rightReady]);

  useEffect(() => {
    if (!leftReady || !rightReady || done) return;
    if (!oldRef.current || !newRef.current) return;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!oldRef.current || !newRef.current || !unifiedRef.current) {
          console.warn("[unified-diff] refs lost between rAF frames", {
            old: !!oldRef.current, new: !!newRef.current, unified: !!unifiedRef.current,
          });
          return;
        }

        try {
          const oldTree = extractBlockTree(oldRef.current);
          const newTree = extractBlockTree(newRef.current);
          const matches = matchBlocks(oldTree, newTree);
          const { fragment, hasChanges } = buildUnifiedDom(matches);

          unifiedRef.current.innerHTML = "";
          unifiedRef.current.appendChild(fragment);
          setDone(true);
          onDiffResult(true, hasChanges);
        } catch (e) {
          console.error("[unified-diff] diff computation failed", e);
          setLoadError(e instanceof Error ? e.message : String(e));
        }
      });
    });
  }, [leftReady, rightReady, done]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      {/* Offscreen source panels — unmount after diff is built */}
      {!done && !loadError && (
        <div style={{ position: "absolute", left: -9999, visibility: "hidden" as const, pointerEvents: "none" as const, width: 720 }}>
          <ComparePanelRenderer
            ref={oldRef}
            sessionId={sessionId}
            revision={leftRev}
            onReady={() => setLeftReady(true)}
            onError={(msg) => setLoadError(`Rev ${leftRev}: ${msg}`)}
          />
          <ComparePanelRenderer
            ref={newRef}
            sessionId={sessionId}
            revision={rightRev}
            onReady={() => setRightReady(true)}
            onError={(msg) => setLoadError(`Rev ${rightRev}: ${msg}`)}
          />
        </div>
      )}

      {/* Visible output */}
      <div className="max-w-[720px] mx-auto px-6 pt-8 pb-32">
        {!done && !loadError && (
          <div className="flex flex-col items-center justify-center h-64 text-text-tertiary font-body text-body gap-2">
            <span>Loading...</span>
            {slow && (
              <span className="text-[11px]">
                Taking longer than expected — check Network tab for pending requests
              </span>
            )}
          </div>
        )}
        {loadError && (
          <div className="bg-accent-red-muted rounded-lg p-5 mt-8">
            <h3 className="font-body font-semibold text-accent-red mb-2">Failed to load revision</h3>
            <pre className="text-code font-mono text-text-secondary whitespace-pre-wrap">{loadError}</pre>
          </div>
        )}
        <div ref={unifiedRef} />
      </div>
      {popovers}
    </div>
  );
}

/* ── Side-by-side view ── */

function SideBySideView({ sessionId, leftRev, rightRev, onDiffResult }: ViewProps) {
  const oldRef = useRef<HTMLDivElement>(null);
  const newRef = useRef<HTMLDivElement>(null);
  const [leftReady, setLeftReady] = useState(false);
  const [rightReady, setRightReady] = useState(false);
  const [done, setDone] = useState(false);

  const viewRef = useRef<HTMLDivElement>(null);
  const leftPanelRef = useRef<HTMLDivElement>(null);
  const rightPanelRef = useRef<HTMLDivElement>(null);
  const isSyncing = useRef(false);

  const handleLeftReady = useCallback(() => setLeftReady(true), []);
  const handleRightReady = useCallback(() => setRightReady(true), []);

  const { annotations } = useAnnotations();
  const planAnnotations = annotations.filter(a => !a.filePath);
  const { popovers } = useTextAnnotation({
    containerRef: viewRef,
    restoreKey: done,
    restoreAnnotations: planAnnotations,
    extractContext: (range) => extractContext(range, viewRef.current!),
  });

  // Run diff
  useEffect(() => {
    if (!leftReady || !rightReady || done) return;
    if (!oldRef.current || !newRef.current) return;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!oldRef.current || !newRef.current) return;
        const changed = runDomDiff(oldRef.current, newRef.current);
        setDone(true);
        onDiffResult(true, changed);
      });
    });
  }, [leftReady, rightReady, done]);

  // Sync scroll
  useEffect(() => {
    const left = leftPanelRef.current;
    const right = rightPanelRef.current;
    if (!left || !right) return;

    const handleSync = (source: HTMLDivElement, target: HTMLDivElement) => {
      if (document.documentElement.dataset.syncScroll === "0") return;
      if (isSyncing.current) return;
      isSyncing.current = true;
      const sourceMax = source.scrollHeight - source.clientHeight;
      const targetMax = target.scrollHeight - target.clientHeight;
      if (sourceMax > 0 && targetMax > 0) {
        target.scrollTop = (source.scrollTop / sourceMax) * targetMax;
      }
      requestAnimationFrame(() => { isSyncing.current = false; });
    };

    const onLeft = () => handleSync(left, right);
    const onRight = () => handleSync(right, left);
    left.addEventListener("scroll", onLeft);
    right.addEventListener("scroll", onRight);
    return () => {
      left.removeEventListener("scroll", onLeft);
      right.removeEventListener("scroll", onRight);
    };
  }, []);

  return (
    <div ref={viewRef} className="flex flex-1 min-h-0">
      <div ref={leftPanelRef} className="w-1/2 overflow-y-auto border-r border-border-subtle">
        <div className="max-w-[720px] mx-auto px-6 pt-8 pb-32">
          <ComparePanelRenderer
            ref={oldRef}
            sessionId={sessionId}
            revision={leftRev}
            onReady={handleLeftReady}
          />
        </div>
      </div>
      <div ref={rightPanelRef} className="w-1/2 overflow-y-auto">
        <div className="max-w-[720px] mx-auto px-6 pt-8 pb-32">
          <ComparePanelRenderer
            ref={newRef}
            sessionId={sessionId}
            revision={rightRev}
            onReady={handleRightReady}
          />
        </div>
      </div>
      {popovers}
    </div>
  );
}

/* ── Panel renderer ── */

interface ComparePanelRendererProps {
  sessionId: string;
  revision: number;
  onReady: () => void;
  onError?: (message: string) => void;
}

const ComparePanelRenderer = React.memo(React.forwardRef<HTMLDivElement, ComparePanelRendererProps>(
  ({ sessionId, revision, onReady, onError }, ref) => {
    const [PlanComponent, setPlanComponent] = useState<React.ComponentType | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
      setLoading(true);
      setError(null);
      import(`/api/session/${sessionId}/plan.js?rev=${revision}&t=${Date.now()}`)
        .then((mod) => {
          if (!mod.default) {
            const msg = "Module has no default export";
            setError(msg);
            setLoading(false);
            onError?.(msg);
            return;
          }
          setPlanComponent(() => mod.default);
          setLoading(false);
        })
        .catch((e) => {
          setError(e.message);
          setLoading(false);
          onError?.(e.message);
        });
    }, [sessionId, revision]);

    useEffect(() => {
      if (!PlanComponent) return;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          onReady();
        });
      });
    }, [PlanComponent]);

    const planElement = useMemo(() => PlanComponent ? <PlanComponent /> : null, [PlanComponent]);

    if (loading) {
      return (
        <div className="flex items-center justify-center h-64 text-text-tertiary font-body text-body">
          Loading...
        </div>
      );
    }

    if (error) {
      return (
        <div className="bg-accent-red-muted rounded-lg p-5">
          <h3 className="font-body font-semibold text-accent-red mb-2">Error</h3>
          <pre className="text-code font-mono text-text-secondary whitespace-pre-wrap">{error}</pre>
        </div>
      );
    }

    if (!PlanComponent) {
      return <div className="text-text-tertiary text-center py-8 font-body text-body">No canvas loaded</div>;
    }

    return (
      <div ref={ref}>
        {planElement}
      </div>
    );
  }
));
