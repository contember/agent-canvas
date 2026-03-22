import React, { useState, useContext, useMemo } from "react";
import { PlanRenderer } from "./PlanRenderer";
import { ActiveViewContext, RevisionContext, type CanvasFileInfo, type RevisionInfo } from "./App";

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
  const prevFiles = new Set(previousRev?.canvasFiles.map(cf => cf.filename) || []);

  return currentRev.canvasFiles.map(cf => {
    if (!cf.diffStats) {
      // No diffStats → new file (not in previous revision) or first revision
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
  const { currentRevision, revisions } = useContext(RevisionContext);

  const currentRev = revisions.find(r => r.revision === revision);
  const previousRev = revisions.find(r => r.revision === revision - 1);
  const changes = useMemo(() => categorizeChanges(currentRev, previousRev), [currentRev, previousRev]);

  const affected = changes.filter(c => c.status !== "unchanged");
  const unchanged = changes.filter(c => c.status === "unchanged");

  return (
    <div className="max-w-[720px] mx-auto px-6 pt-12 pb-32">
      {responseBanner}

      {/* Affected files — expanded inline */}
      {affected.map(change => (
        <OverviewFileSection
          key={change.filename}
          change={change}
          revision={revision}
          onOpenTab={() => setActiveView({ type: "canvas", filename: change.filename })}
        />
      ))}

      {/* Unchanged files — collapsed */}
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

function OverviewFileSection({
  change,
  revision,
  onOpenTab,
}: {
  change: FileChange;
  revision: number;
  onOpenTab: () => void;
}) {
  const label = change.filename.replace(/\.jsx$/, "");
  const isNew = change.status === "new";
  const diffStats = change.diffStats;

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
        <button
          onClick={onOpenTab}
          className="ml-auto text-[11px] font-body font-medium text-accent-blue hover:text-accent-blue/80 transition-colors"
        >
          Open in tab
        </button>
      </div>

      {/* Rendered canvas content */}
      <div data-canvas-file={change.filename}>
        <PlanRenderer revision={revision} filename={change.filename} />
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
