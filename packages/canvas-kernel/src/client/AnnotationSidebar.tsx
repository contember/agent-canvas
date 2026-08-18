import React, { useEffect, useState, useContext, useMemo, useCallback } from "react";
import { useAnnotations } from "./AnnotationProvider";
import type { Annotation } from "./AnnotationProvider";
import { generateMarkdown, hasValue, getMissingRequiredLabels } from "./generateMarkdown";
import { RevisionContext, ActiveViewContext } from "./appContext";
import { SessionContext } from "#canvas/runtime";
import { MarkdownPreview } from "./ResponsePreview";
import { FileIcon } from "./FileIcon";
import { fileAnnotationPath, RESPONSE_ANNOTATION_PATH } from "./utils";
import { AnnotationList } from "./AnnotationList";
import { AnnotationDraftFooter } from "./AnnotationDraftFooter";
import { findAnnotationElement, scrollToAnnotation } from "./annotationDom";
import { useCanvasHost } from "./hostContext";
import { ResponsePreview } from "./ResponsePreview";

/**
 * The canvas host's sidebar: the reusable annotation list and draft footer,
 * wrapped in the chrome only a canvas has — revisions, per-revision feedback,
 * canvas files, agent responses, and the wait for the agent to come back.
 */

interface AnnotationSidebarProps {
  onSubmit: (feedback: string) => void;
  collapseButton?: React.ReactNode;
}

export function AnnotationSidebar({ onSubmit, collapseButton }: AnnotationSidebarProps) {
  const { isReadOnly, selectedRevision, currentRevision, revisions, agentWatching } = useContext(RevisionContext);
  const sessionId = useContext(SessionContext);
  const selectedRevInfo = revisions.find((r) => r.revision === selectedRevision);
  const isCurrentButSubmitted = isReadOnly && selectedRevision === currentRevision;
  const feedbackConsumed = !!selectedRevInfo?.feedbackConsumed;
  const roundLabel = selectedRevInfo?.label || `Round ${selectedRevision}`;

  if (isReadOnly) {
    return <ReadOnlyAnnotationSidebar sessionId={sessionId} revision={selectedRevision} label={roundLabel} waitingForUpdate={isCurrentButSubmitted} feedbackConsumed={feedbackConsumed} agentWatching={agentWatching} collapseButton={collapseButton} />;
  }

  return <AnnotationSidebarInner onSubmit={onSubmit} agentWatching={agentWatching} collapseButton={collapseButton} />;
}

function FeedbackDisplay({ sessionId, revision, label, waitingForUpdate, feedbackConsumed, agentWatching, collapseButton }: { sessionId: string; revision: number; label: string; waitingForUpdate?: boolean; feedbackConsumed?: boolean; agentWatching?: boolean; collapseButton?: React.ReactNode }) {
  const host = useCanvasHost();
  const isSharedMode = host.isShared;

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 flex items-center justify-between flex-shrink-0">
        <span className="text-[11px] font-medium uppercase tracking-widest text-text-tertiary font-body">
          {waitingForUpdate ? "Feedback sent" : `Feedback — ${label}`}
        </span>
        {collapseButton}
      </div>

      {waitingForUpdate && !isSharedMode && <WaitingBanner feedbackConsumed={feedbackConsumed} agentWatching={agentWatching} />}

      <FeedbackDisplayContent sessionId={sessionId} revision={revision} />
    </div>
  );
}

function WaitingBanner({ feedbackConsumed, agentWatching }: { feedbackConsumed?: boolean; agentWatching?: boolean }) {
  if (feedbackConsumed) {
    return (
      <div className="mx-4 mb-3 px-3 py-2.5 rounded-lg bg-accent-green-muted flex items-center gap-2 flex-shrink-0">
        <span className="w-2 h-2 rounded-full bg-accent-green animate-pulse" />
        <span className="text-[12px] font-body text-accent-green">Feedback received — waiting for next revision...</span>
      </div>
    );
  }
  if (agentWatching) {
    return (
      <div className="mx-4 mb-3 px-3 py-2.5 rounded-lg bg-accent-blue-muted flex items-center gap-2 flex-shrink-0">
        <span className="w-2 h-2 rounded-full bg-accent-blue animate-pulse" />
        <span className="text-[12px] font-body text-accent-blue">Waiting for agent to pick up feedback...</span>
      </div>
    );
  }
  return (
    <div className="mx-4 mb-3 px-3 py-2.5 rounded-lg bg-accent-amber-muted flex items-center gap-2 flex-shrink-0">
      <span className="w-2 h-2 rounded-full bg-accent-amber" />
      <span className="text-[12px] font-body text-accent-amber">Agent disconnected — tell Claude to check feedback</span>
    </div>
  );
}

type ReadOnlyTab = "feedback" | "annotations";

function ReadOnlyAnnotationSidebar({ sessionId, revision, label, waitingForUpdate, feedbackConsumed, agentWatching, collapseButton }: { sessionId: string; revision: number; label: string; waitingForUpdate?: boolean; feedbackConsumed?: boolean; agentWatching?: boolean; collapseButton?: React.ReactNode }) {
  const { annotations, generalNote } = useAnnotations();
  const hasAnnotations = annotations.length > 0 || generalNote.trim().length > 0;
  const [activeTab, setActiveTab] = useState<ReadOnlyTab>("feedback");

  // If no annotations in localStorage, just show feedback
  if (!hasAnnotations) {
    return <FeedbackDisplay sessionId={sessionId} revision={revision} label={label} waitingForUpdate={waitingForUpdate} feedbackConsumed={feedbackConsumed} agentWatching={agentWatching} collapseButton={collapseButton} />;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header with tab switcher */}
      <div className="px-4 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-1 bg-bg-input rounded-md p-0.5">
          <button
            onClick={() => setActiveTab("feedback")}
            className={`px-2.5 py-1 rounded text-[11px] font-medium font-body transition-colors ${
              activeTab === "feedback"
                ? "bg-bg-elevated text-text-primary shadow-sm"
                : "text-text-tertiary hover:text-text-secondary"
            }`}
          >
            Feedback
          </button>
          <button
            onClick={() => setActiveTab("annotations")}
            className={`px-2.5 py-1 rounded text-[11px] font-medium font-body transition-colors flex items-center gap-1.5 ${
              activeTab === "annotations"
                ? "bg-bg-elevated text-text-primary shadow-sm"
                : "text-text-tertiary hover:text-text-secondary"
            }`}
          >
            Annotations
            <span className="inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full bg-border-subtle text-[10px] font-medium">{annotations.length}</span>
          </button>
        </div>
        {collapseButton}
      </div>

      {waitingForUpdate && <WaitingBanner feedbackConsumed={feedbackConsumed} agentWatching={agentWatching} />}

      {activeTab === "feedback" ? (
        <FeedbackDisplayContent sessionId={sessionId} revision={revision} />
      ) : (
        <>
          <div className="flex-1 overflow-y-auto">
            <CanvasAnnotationGroups annotations={annotations} readOnly />
          </div>
          {generalNote.trim() && (
            <div className="border-t border-border-subtle px-4 py-3 flex-shrink-0">
              <div className="text-[13px] font-body text-text-primary leading-relaxed">
                {generalNote}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FeedbackDisplayContent({ sessionId, revision }: { sessionId: string; revision: number }) {
  const host = useCanvasHost();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    // Shared mode has no prior local feedback to fetch — shared canvases
    // are always one-off snapshots. Skip the call entirely.
    if (!host.fsAvailable) { setFeedback(null); setLoading(false); return; }
    fetch(`/api/session/${sessionId}/revision/${revision}/feedback`)
      .then((r) => r.json())
      .then((data: any) => { setFeedback(data.feedback || null); setLoading(false); })
      .catch(() => { setFeedback(null); setLoading(false); });
  }, [sessionId, revision]);

  return (
    <div className="flex-1 overflow-y-auto px-4">
      {loading ? (
        <p className="text-[12px] text-text-tertiary font-body py-4">Loading...</p>
      ) : feedback ? (
        <MarkdownPreview text={feedback} />
      ) : (
        <p className="text-[12px] text-text-tertiary font-body py-4">No feedback was submitted for this revision.</p>
      )}
    </div>
  );
}

/** How a canvas splits its annotations: the agent's response, the canvas
 *  itself, then one group per file the reader opened. */
function groupAnnotations(annotations: Annotation[]) {
  const response = annotations.filter((a) => a.filePath === RESPONSE_ANNOTATION_PATH);
  const plan = annotations.filter((a) => !a.filePath);
  const files = annotations.filter((a) => fileAnnotationPath(a) !== undefined);
  const fileGroups: Record<string, Annotation[]> = {};
  for (const ann of files) {
    const key = fileAnnotationPath(ann);
    if (!key) continue;
    const group = fileGroups[key];
    if (group) group.push(ann);
    else fileGroups[key] = [ann];
  }
  const hasMultipleGroups = [response, plan, files].filter((g) => g.length > 0).length > 1;
  return { response, plan, fileGroups, hasMultipleGroups };
}

function GroupHeading({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] uppercase tracking-widest text-text-tertiary font-body px-3 mb-1 mt-1">{children}</div>;
}

function CanvasAnnotationGroups({ annotations, readOnly, includedRemoteIds, onToggleRemoteId }: {
  annotations: Annotation[];
  readOnly?: boolean;
  includedRemoteIds?: Set<string>;
  onToggleRemoteId?: (id: string) => void;
}) {
  const { setActiveView } = useContext(ActiveViewContext);
  const { response, plan, fileGroups, hasMultipleGroups } = groupAnnotations(annotations);

  // Selecting a file annotation means opening its file first; the element only
  // exists once that view is mounted.
  const onSelect = useCallback((ann: Annotation) => {
    const filePath = fileAnnotationPath(ann);
    if (!filePath) return;
    setActiveView({ type: "file", path: filePath });
    setTimeout(() => {
      const el = findAnnotationElement(ann);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 150);
  }, [setActiveView]);

  const onReveal = useCallback((ann: Annotation) => scrollToAnnotation(ann, setActiveView), [setActiveView]);
  const listProps = { readOnly, onSelect, onReveal, includedRemoteIds, onToggleRemoteId };

  return (
    <>
      {response.length > 0 && (
        <>
          {hasMultipleGroups && <GroupHeading>Agent Response</GroupHeading>}
          <AnnotationList annotations={response} {...listProps} />
        </>
      )}

      {plan.length > 0 && (
        <>
          {hasMultipleGroups && <GroupHeading>Canvas</GroupHeading>}
          <AnnotationList annotations={plan} {...listProps} />
        </>
      )}

      {Object.entries(fileGroups).map(([filePath, anns]) => (
        <div key={filePath}>
          <button
            onClick={() => setActiveView({ type: "file", path: filePath })}
            className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-text-tertiary hover:text-text-secondary font-body px-3 pt-3 pb-1 truncate transition-colors w-full text-left"
            title={filePath}
          >
            <FileIcon name={filePath.split("/").pop() || filePath} type="file" />
            <span className="truncate">{filePath}</span>
          </button>
          <AnnotationList annotations={anns} {...listProps} />
        </div>
      ))}
    </>
  );
}

function AnnotationSidebarInner({ onSubmit, agentWatching, collapseButton }: Omit<AnnotationSidebarProps, "onPreview"> & { agentWatching: boolean }) {
  const host = useCanvasHost();
  const [previewOpen, setPreviewOpen] = useState(false);
  const {
    annotations, generalNote,
    submittableResponses, feedbackEntries,
  } = useAnnotations();

  const remoteAnnotations = useMemo(() => annotations.filter((a) => a.source === "remote"), [annotations]);
  const [includedRemoteIds, setIncludedRemoteIds] = useState<Set<string>>(() => new Set());

  // Auto-include new remote annotations as they arrive
  useEffect(() => {
    if (remoteAnnotations.length === 0) return;
    setIncludedRemoteIds((prev) => {
      const next = new Set(prev);
      for (const a of remoteAnnotations) next.add(a.id);
      return next.size === prev.size ? prev : next;
    });
  }, [remoteAnnotations]);

  const toggleRemoteId = useCallback((id: string) => {
    setIncludedRemoteIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const hasResponses = Array.from(submittableResponses.values()).some(hasValue);
  const hasFeedback = feedbackEntries.size > 0;
  const hasContent = annotations.length > 0 || generalNote.trim().length > 0 || hasResponses || hasFeedback;
  const [validationError, setValidationError] = useState<string | null>(null);

  const submitMarkdown = () => {
    const md = generateMarkdown(annotations, generalNote, submittableResponses, feedbackEntries, includedRemoteIds);
    onSubmit(md);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between flex-shrink-0">
        <span className="text-[11px] font-medium uppercase tracking-widest text-text-tertiary font-body flex items-center gap-2">
          Annotations
          {annotations.length > 0 && (
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-border-subtle text-[10px] font-medium text-text-secondary">{annotations.length}</span>
          )}
          {!host.isShared && (
            <span
              className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${agentWatching ? "bg-accent-green" : "bg-accent-amber"}`}
              title={agentWatching ? "Agent connected" : "Agent disconnected"}
            />
          )}
        </span>
        {collapseButton}
      </div>

      {/* Annotation list */}
      <div className="flex-1 overflow-y-auto">
        {annotations.length === 0 && (
          <p className="text-[12px] text-text-tertiary px-3 py-4 leading-relaxed font-body">
            Select text in the canvas or in files to add annotations.
          </p>
        )}

        <CanvasAnnotationGroups
          annotations={annotations}
          includedRemoteIds={includedRemoteIds}
          onToggleRemoteId={toggleRemoteId}
        />
      </div>

      <AnnotationDraftFooter
        hasContent={hasContent}
        onSubmit={() => {
          const allMissing = getMissingRequiredLabels(submittableResponses, feedbackEntries);
          if (allMissing.length > 0) {
            setValidationError(`Please answer: ${allMissing.join(", ")}`);
            return;
          }
          setValidationError(null);
          submitMarkdown();
        }}
        onSubmitEmpty={() => onSubmit("No feedback — looks good.")}
        notice={validationError && (
          <div className="px-4 py-2 text-[12px] text-accent-red font-body border-t border-border-subtle flex-shrink-0 flex items-center justify-between gap-2">
            <span>{validationError}</span>
            <button
              onClick={() => { setValidationError(null); submitMarkdown(); }}
              className="text-[11px] text-text-tertiary hover:text-text-secondary font-body whitespace-nowrap underline"
            >
              Submit anyway
            </button>
          </div>
        )}
        secondaryAction={
          <button
            onClick={() => setPreviewOpen(true)}
            className="flex-1 py-2 rounded-lg font-body text-[13px] font-medium transition-all bg-border-subtle text-text-secondary hover:bg-border-medium hover:text-text-primary"
          >
            Preview
          </button>
        }
      />

      <ResponsePreview
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        onSubmit={onSubmit}
        includedRemoteIds={includedRemoteIds}
        onToggleRemoteId={toggleRemoteId}
      />
    </div>
  );
}
