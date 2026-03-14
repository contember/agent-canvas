import React, { useEffect, useState, useRef, useCallback } from "react";
import { RevisionSelect } from "./RevisionSelect";
import { runDomDiff } from "./domDiff";

interface CompareViewProps {
  initialLeft: number;
  initialRight: number;
  sessionId: string;
  onExit: () => void;
}

export function CompareView({ initialLeft, initialRight, sessionId, onExit }: CompareViewProps) {
  const [leftRev, setLeftRev] = useState(initialLeft);
  const [rightRev, setRightRev] = useState(initialRight);

  const oldRef = useRef<HTMLDivElement>(null);
  const newRef = useRef<HTMLDivElement>(null);
  const diffGen = useRef(0);
  const [diffDone, setDiffDone] = useState(false);
  const [hasChanges, setHasChanges] = useState(true);
  const [syncScroll, setSyncScroll] = useState(true);
  const [leftReady, setLeftReady] = useState(false);
  const [rightReady, setRightReady] = useState(false);

  // Only reset the flag for the panel whose revision actually changed
  const prevLeft = useRef(leftRev);
  const prevRight = useRef(rightRev);
  if (prevLeft.current !== leftRev || prevRight.current !== rightRev) {
    diffGen.current++;
    setDiffDone(false);
    setHasChanges(true);
    if (prevLeft.current !== leftRev) setLeftReady(false);
    if (prevRight.current !== rightRev) setRightReady(false);
    prevLeft.current = leftRev;
    prevRight.current = rightRev;
  }

  // Run diff once both panels are ready
  useEffect(() => {
    if (!leftReady || !rightReady || diffDone) return;
    if (!oldRef.current || !newRef.current) return;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!oldRef.current || !newRef.current) return;
        const changed = runDomDiff(oldRef.current, newRef.current);
        setHasChanges(changed);
        setDiffDone(true);
      });
    });
  }, [leftReady, rightReady, diffDone]);

  // Synchronized scrolling
  const isSyncing = useRef(false);
  const leftPanelRef = useRef<HTMLDivElement>(null);
  const rightPanelRef = useRef<HTMLDivElement>(null);

  const handleSyncScroll = useCallback((source: HTMLDivElement, target: HTMLDivElement) => {
    if (!syncScroll || isSyncing.current) return;
    isSyncing.current = true;

    const sourceMax = source.scrollHeight - source.clientHeight;
    const targetMax = target.scrollHeight - target.clientHeight;
    if (sourceMax > 0 && targetMax > 0) {
      const ratio = source.scrollTop / sourceMax;
      target.scrollTop = ratio * targetMax;
    }

    requestAnimationFrame(() => {
      isSyncing.current = false;
    });
  }, [syncScroll]);

  useEffect(() => {
    const left = leftPanelRef.current;
    const right = rightPanelRef.current;
    if (!left || !right) return;

    const onLeftScroll = () => handleSyncScroll(left, right);
    const onRightScroll = () => handleSyncScroll(right, left);

    left.addEventListener("scroll", onLeftScroll);
    right.addEventListener("scroll", onRightScroll);
    return () => {
      left.removeEventListener("scroll", onLeftScroll);
      right.removeEventListener("scroll", onRightScroll);
    };
  }, [handleSyncScroll]);

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
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={syncScroll}
              onChange={(e) => setSyncScroll(e.target.checked)}
              className="accent-accent-amber w-3.5 h-3.5"
            />
            <span className="text-[11px] font-body text-text-secondary">Sync scroll</span>
          </label>
          <button
            onClick={onExit}
            className="text-[12px] font-body font-medium text-text-secondary hover:text-text-primary px-3 py-1.5 rounded-md hover:bg-bg-elevated transition-colors"
          >
            Exit Compare
          </button>
        </div>
      </div>

      {/* Side-by-side panels */}
      <div className="flex flex-1 min-h-0">
        {/* Left panel */}
        <div
          ref={leftPanelRef}
          className="w-1/2 overflow-y-auto border-r border-border-subtle"
        >
          <div className="max-w-[720px] mx-auto px-6 pt-8 pb-32">
            <ComparePanelRenderer
              key={`left-${leftRev}`}
              ref={oldRef}
              sessionId={sessionId}
              revision={leftRev}
              onReady={() => { const g = diffGen.current; requestAnimationFrame(() => { if (g === diffGen.current) setLeftReady(true); }); }}
            />
          </div>
        </div>

        {/* Right panel */}
        <div
          ref={rightPanelRef}
          className="w-1/2 overflow-y-auto"
        >
          <div className="max-w-[720px] mx-auto px-6 pt-8 pb-32">
            <ComparePanelRenderer
              key={`right-${rightRev}`}
              ref={newRef}
              sessionId={sessionId}
              revision={rightRev}
              onReady={() => { const g = diffGen.current; requestAnimationFrame(() => { if (g === diffGen.current) setRightReady(true); }); }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

interface ComparePanelRendererProps {
  sessionId: string;
  revision: number;
  onReady: () => void;
}

const ComparePanelRenderer = React.forwardRef<HTMLDivElement, ComparePanelRendererProps>(
  ({ sessionId, revision, onReady }, ref) => {
    const [PlanComponent, setPlanComponent] = useState<React.ComponentType | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
      setLoading(true);
      setError(null);
      import(`/api/session/${sessionId}/plan.js?rev=${revision}&t=${Date.now()}`)
        .then((mod) => {
          setPlanComponent(() => mod.default);
          setLoading(false);
        })
        .catch((e) => {
          setError(e.message);
          setLoading(false);
        });
    }, [sessionId, revision]);

    useEffect(() => {
      if (!PlanComponent) return;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          onReady();
        });
      });
    }, [PlanComponent, onReady]);

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
      return <div className="text-text-tertiary text-center py-8 font-body text-body">No plan loaded</div>;
    }

    return (
      <div ref={ref}>
        <PlanComponent />
      </div>
    );
  }
);
