import React, { useRef, useEffect, useCallback, useState, useContext } from "react";
import { useAnnotations, Annotation } from "./AnnotationProvider";
import { setMarkActive } from "./highlightRange";
import { generateMarkdown, hasValue, getMissingRequired, getMissingRequiredFeedback } from "./generateMarkdown";
import { RevisionContext, ActiveViewContext } from "./App";
import { SessionContext } from "#canvas/runtime";
import { MarkdownPreview } from "./ResponsePreview";
import { FileIcon } from "./FileIcon";

interface AnnotationSidebarProps {
  onPreview: () => void;
  onSubmit: (feedback: string) => void;
  collapseButton?: React.ReactNode;
}

export function AnnotationSidebar({ onPreview, onSubmit, collapseButton }: AnnotationSidebarProps) {
  const { isReadOnly, selectedRevision, currentRevision, revisions } = useContext(RevisionContext);
  const sessionId = useContext(SessionContext);
  const isCurrentButSubmitted = isReadOnly && selectedRevision === currentRevision;
  const selectedRevInfo = revisions.find((r) => r.revision === selectedRevision);
  const roundLabel = selectedRevInfo?.label || `Round ${selectedRevision}`;

  if (isReadOnly) {
    return <FeedbackDisplay sessionId={sessionId} revision={selectedRevision} label={roundLabel} waitingForUpdate={isCurrentButSubmitted} collapseButton={collapseButton} />;
  }

  return <AnnotationSidebarInner onPreview={onPreview} onSubmit={onSubmit} collapseButton={collapseButton} />;
}

function FeedbackDisplay({ sessionId, revision, label, waitingForUpdate, collapseButton }: { sessionId: string; revision: number; label: string; waitingForUpdate?: boolean; collapseButton?: React.ReactNode }) {
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/session/${sessionId}/revision/${revision}/feedback`)
      .then((r) => r.json())
      .then((data: any) => { setFeedback(data.feedback || null); setLoading(false); })
      .catch(() => { setFeedback(null); setLoading(false); });
  }, [sessionId, revision]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 flex items-center justify-between flex-shrink-0">
        <span className="text-[11px] font-medium uppercase tracking-widest text-text-tertiary font-body">
          {waitingForUpdate ? "Feedback sent" : `Feedback — ${label}`}
        </span>
        {collapseButton}
      </div>

      {waitingForUpdate && (
        <div className="mx-4 mb-3 px-3 py-2.5 rounded-lg bg-accent-green-muted flex items-center gap-2 flex-shrink-0">
          <span className="w-2 h-2 rounded-full bg-accent-green animate-pulse" />
          <span className="text-[12px] font-body text-accent-green">Waiting for next revision...</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4">
        {loading ? (
          <p className="text-[12px] text-text-tertiary font-body py-4">Loading...</p>
        ) : feedback ? (
          <MarkdownPreview text={feedback} />
        ) : (
          <p className="text-[12px] text-text-tertiary font-body py-4">No feedback was submitted for this revision.</p>
        )}
      </div>
    </div>
  );
}

function AnnotationSidebarInner({ onPreview, onSubmit, collapseButton }: AnnotationSidebarProps) {
  const {
    annotations, updateAnnotation, removeAnnotation,
    generalNote, setGeneralNote,
    activeAnnotationId, setActiveAnnotationId,
    responses, feedbackEntries,
  } = useAnnotations();
  const { setActiveView } = React.useContext(ActiveViewContext);

  const listRef = useRef<HTMLDivElement>(null);
  const annRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const planAnnotations = annotations.filter((a) => !a.filePath);
  const fileAnnotations = annotations.filter((a) => a.filePath);
  const fileGroups: Record<string, Annotation[]> = {};
  for (const ann of fileAnnotations) {
    const key = ann.filePath!;
    if (!fileGroups[key]) fileGroups[key] = [];
    fileGroups[key].push(ann);
  }

  // Scroll to active annotation in sidebar
  useEffect(() => {
    if (!activeAnnotationId) return;
    const el = annRefs.current.get(activeAnnotationId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [activeAnnotationId]);

  // Hover on sidebar card → highlight inline mark + block + scroll to it
  const handleMouseEnter = useCallback((annId: string) => {
    setActiveAnnotationId(annId);
    setMarkActive(annId, true);
    // Scroll inline mark into view
    const mark = document.querySelector(`[data-annotation-id="${annId}"]`) as HTMLElement | null;
    if (mark) {
      mark.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [setActiveAnnotationId]);

  const handleMouseLeave = useCallback((annId: string) => {
    setActiveAnnotationId(null);
    setMarkActive(annId, false);
  }, [activeAnnotationId]);

  const hasResponses = Array.from(responses.values()).some(hasValue);
  const hasFeedback = feedbackEntries.size > 0;
  const hasContent = annotations.length > 0 || generalNote.trim().length > 0 || hasResponses || hasFeedback;
  const [validationError, setValidationError] = useState<string | null>(null);

  const renderAnnotation = (ann: Annotation) => (
    <div
      key={ann.id}
      ref={(el) => { if (el) annRefs.current.set(ann.id, el); else annRefs.current.delete(ann.id); }}
      className={`group/ann relative px-3 py-2.5 transition-colors duration-150 ${
        activeAnnotationId === ann.id
          ? "bg-highlight-selected"
          : "odd:bg-bg-elevated-half hover:bg-bg-input"
      }`}
      onMouseEnter={() => handleMouseEnter(ann.id)}
      onMouseLeave={() => handleMouseLeave(ann.id)}
      onClick={() => {
        if (ann.id === activeAnnotationId) {
          setActiveAnnotationId(null);
        } else {
          setActiveAnnotationId(ann.id);
          if (ann.filePath) {
            setActiveView({ type: "file", path: ann.filePath });
            // Scroll to mark after file view renders
            setTimeout(() => {
              const mark = document.querySelector(`[data-annotation-id="${ann.id}"]`) as HTMLElement | null;
              if (mark) mark.scrollIntoView({ behavior: "smooth", block: "center" });
            }, 150);
          }
        }
      }}
    >
      {/* Snippet quote */}
      <div className="text-[11px] text-text-tertiary italic line-clamp-2 mb-1.5 leading-snug font-body border-l-2 border-border-medium pl-2">
        {ann.snippet.length > 80 ? ann.snippet.slice(0, 80) + "..." : ann.snippet}
      </div>

      {/* Seamless editable note */}
      <textarea
        value={ann.note}
        onChange={(e) => updateAnnotation(ann.id, e.target.value)}
        onClick={(e) => e.stopPropagation()}
        className="w-full bg-transparent text-[13px] font-body text-text-primary resize-none focus:outline-none leading-relaxed p-0 border-none min-h-[20px]"
        rows={1}
        style={{ height: "auto", overflow: "hidden" }}
        onInput={(e) => {
          const t = e.target as HTMLTextAreaElement;
          t.style.height = "auto";
          t.style.height = t.scrollHeight + "px";
        }}
        ref={(el) => {
          if (el) {
            el.style.height = "auto";
            el.style.height = el.scrollHeight + "px";
          }
        }}
      />

      {/* Delete — top right on hover */}
      <div className="absolute top-1.5 right-1.5 opacity-0 group-hover/ann:opacity-100 transition-opacity duration-100">
        <button
          onClick={(e) => { e.stopPropagation(); removeAnnotation(ann.id); }}
          className="w-5 h-5 flex items-center justify-center rounded text-text-tertiary hover:text-accent-red hover:bg-accent-red-muted transition-colors"
          title="Delete annotation"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
          </svg>
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between flex-shrink-0">
        <span className="text-[11px] font-medium uppercase tracking-widest text-text-tertiary font-body flex items-center gap-2">
          Annotations
          {annotations.length > 0 && (
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-border-subtle text-[10px] font-medium text-text-secondary">{annotations.length}</span>
          )}
        </span>
        {collapseButton}
      </div>

      {/* Annotation list */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-1">
        {annotations.length === 0 && (
          <p className="text-[12px] text-text-tertiary px-3 py-4 leading-relaxed font-body">
            Select text in the plan or in files to add annotations.
          </p>
        )}

        {planAnnotations.length > 0 && fileAnnotations.length > 0 && (
          <div className="text-[10px] uppercase tracking-widest text-text-tertiary font-body px-3 mb-1 mt-1">Plan</div>
        )}
        {planAnnotations.map(renderAnnotation)}

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
            {anns.map(renderAnnotation)}
          </div>
        ))}
      </div>

      {/* General note — seamless */}
      <div className="border-t border-border-subtle px-4 py-3 flex-shrink-0">
        <textarea
          value={generalNote}
          onChange={(e) => setGeneralNote(e.target.value)}
          className="w-full bg-transparent text-[13px] font-body text-text-primary resize-none leading-relaxed p-0 border-none ring-0 shadow-none outline-none focus:outline-none focus:ring-0 focus:border-none placeholder:text-text-disabled min-h-[40px]"
          placeholder="General notes..."
          onInput={(e) => {
            const t = e.target as HTMLTextAreaElement;
            t.style.height = "auto";
            t.style.height = Math.max(40, t.scrollHeight) + "px";
          }}
          ref={(el) => {
            if (el) {
              el.style.height = "auto";
              el.style.height = Math.max(40, el.scrollHeight) + "px";
            }
          }}
        />
      </div>

      {/* Validation error */}
      {validationError && (
        <div className="px-4 py-2 text-[12px] text-accent-red font-body border-t border-border-subtle flex-shrink-0 flex items-center justify-between gap-2">
          <span>{validationError}</span>
          <button
            onClick={() => {
              setValidationError(null);
              const md = generateMarkdown(annotations, generalNote, responses, feedbackEntries);
              onSubmit(md);
            }}
            className="text-[11px] text-text-tertiary hover:text-text-secondary font-body whitespace-nowrap underline"
          >
            Submit anyway
          </button>
        </div>
      )}

      {/* Action buttons */}
      <div className="px-4 py-3 border-t border-border-subtle flex-shrink-0">
        {hasContent ? (
          <div className="flex gap-2">
            <button
              onClick={onPreview}
              className="flex-1 py-2 rounded-lg font-body text-[13px] font-medium transition-all bg-border-subtle text-text-secondary hover:bg-border-medium hover:text-text-primary"
            >
              Preview
            </button>
            <button
              onClick={() => {
                const missingResponses = getMissingRequired(responses);
                const missingFeedback = getMissingRequiredFeedback(feedbackEntries);
                const allMissing = [
                  ...missingResponses.map((r) => r.label),
                  ...missingFeedback.map((e) => e.label || e.id),
                ];
                if (allMissing.length > 0) {
                  setValidationError(`Please answer: ${allMissing.join(", ")}`);
                  return;
                }
                setValidationError(null);
                const md = generateMarkdown(annotations, generalNote, responses, feedbackEntries);
                onSubmit(md);
              }}
              className="flex-1 py-2 rounded-lg font-body text-[13px] font-medium transition-all bg-btn-primary text-btn-primary-text hover:opacity-90 hover:-translate-y-px shadow-sm"
            >
              Submit
            </button>
          </div>
        ) : (
          <button
            onClick={() => onSubmit("No feedback — looks good.")}
            className="w-full py-2 rounded-lg font-body text-[13px] font-medium border border-border-medium text-text-secondary hover:text-text-primary hover:border-border-hover hover:bg-bg-input transition-all"
          >
            Submit without feedback
          </button>
        )}
      </div>
    </div>
  );
}


