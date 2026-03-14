import React, { useEffect, useState, useRef, useContext, useCallback } from "react";
import { SessionContext } from "#canvas/runtime";
import { runDomDiff } from "./domDiff";

interface CompareViewProps {
  oldRevision: number;
  newRevision: number;
  sessionId: string;
  onExit: () => void;
}

export function CompareView({ oldRevision, newRevision, sessionId, onExit }: CompareViewProps) {
  const oldRef = useRef<HTMLDivElement>(null);
  const newRef = useRef<HTMLDivElement>(null);
  const [oldReady, setOldReady] = useState(false);
  const [newReady, setNewReady] = useState(false);
  const [diffDone, setDiffDone] = useState(false);
  const [hasChanges, setHasChanges] = useState(true);

  // Run diff after both panels mount
  useEffect(() => {
    if (!oldReady || !newReady) return;
    if (!oldRef.current || !newRef.current) return;

    // Double rAF to ensure paint is complete
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!oldRef.current || !newRef.current) return;
        const changed = runDomDiff(oldRef.current, newRef.current);
        setHasChanges(changed);
        setDiffDone(true);
      });
    });
  }, [oldReady, newReady]);

  // Synchronized scrolling
  const isSyncing = useRef(false);
  const leftPanelRef = useRef<HTMLDivElement>(null);
  const rightPanelRef = useRef<HTMLDivElement>(null);

  const syncScroll = useCallback((source: HTMLDivElement, target: HTMLDivElement) => {
    if (isSyncing.current) return;
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
  }, []);

  useEffect(() => {
    const left = leftPanelRef.current;
    const right = rightPanelRef.current;
    if (!left || !right) return;

    const onLeftScroll = () => syncScroll(left, right);
    const onRightScroll = () => syncScroll(right, left);

    left.addEventListener("scroll", onLeftScroll);
    right.addEventListener("scroll", onRightScroll);
    return () => {
      left.removeEventListener("scroll", onLeftScroll);
      right.removeEventListener("scroll", onRightScroll);
    };
  }, [syncScroll]);

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border-subtle bg-bg-surface flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-[13px] font-body font-medium text-text-primary">
            Comparing Round {oldRevision} → Round {newRevision}
          </span>
          {diffDone && !hasChanges && (
            <span className="text-[11px] font-body text-text-tertiary bg-bg-elevated px-2 py-0.5 rounded">
              No changes
            </span>
          )}
        </div>
        <button
          onClick={onExit}
          className="text-[12px] font-body font-medium text-text-secondary hover:text-text-primary px-3 py-1.5 rounded-md hover:bg-bg-elevated transition-colors"
        >
          Exit Compare
        </button>
      </div>

      {/* Side-by-side panels */}
      <div className="flex flex-1 min-h-0">
        {/* Left panel — old revision */}
        <div
          ref={leftPanelRef}
          className="w-1/2 overflow-y-auto border-r border-border-subtle"
        >
          <div className="px-3 py-2 border-b border-border-subtle bg-bg-surface sticky top-0 z-10">
            <span className="text-[11px] font-body font-medium text-accent-red">
              Round {oldRevision}
            </span>
          </div>
          <div className="max-w-[720px] mx-auto px-6 pt-8 pb-32">
            <ComparePanelRenderer
              ref={oldRef}
              sessionId={sessionId}
              revision={oldRevision}
              onReady={() => setOldReady(true)}
            />
          </div>
        </div>

        {/* Right panel — new revision */}
        <div
          ref={rightPanelRef}
          className="w-1/2 overflow-y-auto"
        >
          <div className="px-3 py-2 border-b border-border-subtle bg-bg-surface sticky top-0 z-10">
            <span className="text-[11px] font-body font-medium text-accent-green">
              Round {newRevision}
            </span>
          </div>
          <div className="max-w-[720px] mx-auto px-6 pt-8 pb-32">
            <ComparePanelRenderer
              ref={newRef}
              sessionId={sessionId}
              revision={newRevision}
              onReady={() => setNewReady(true)}
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

    // Signal ready after component mounts and paints
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
