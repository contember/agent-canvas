import React, { useRef, useEffect, useCallback, useState, useContext } from "react";
import { useAnnotations, Annotation } from "./AnnotationProvider";
import { setMarkActive } from "./highlightRange";
import { generateMarkdown, hasValue, getMissingRequiredLabels } from "./generateMarkdown";
import { RevisionContext, ActiveViewContext, type ActiveView } from "./App";
import { SessionContext } from "#canvas/runtime";
import { MarkdownPreview } from "./ResponsePreview";
import { FileIcon } from "./FileIcon";
import { autoResizeTextarea, RESPONSE_ANNOTATION_PATH } from "./utils";
import { AnnotationEditor, ImageThumbnails } from "./AnnotationEditor";
import { findAnnotationElement, scrollToAnnotation } from "./annotationDom";
import { MODE, FS_AVAILABLE } from "./clientApi";

interface AnnotationSidebarProps {
  onPreview: () => void;
  onSubmit: (feedback: string) => void;
  collapseButton?: React.ReactNode;
}

export function AnnotationSidebar({ onPreview, onSubmit, collapseButton }: AnnotationSidebarProps) {
  const { isReadOnly, selectedRevision, currentRevision, revisions, agentWatching } = useContext(RevisionContext);
  const sessionId = useContext(SessionContext);
  const selectedRevInfo = revisions.find((r) => r.revision === selectedRevision);
  const isCurrentButSubmitted = isReadOnly && selectedRevision === currentRevision;
  const feedbackConsumed = !!selectedRevInfo?.feedbackConsumed;
  const roundLabel = selectedRevInfo?.label || `Round ${selectedRevision}`;

  if (isReadOnly) {
    return <ReadOnlyAnnotationSidebar sessionId={sessionId} revision={selectedRevision} label={roundLabel} waitingForUpdate={isCurrentButSubmitted} feedbackConsumed={feedbackConsumed} agentWatching={agentWatching} collapseButton={collapseButton} />;
  }

  return <AnnotationSidebarInner onPreview={onPreview} onSubmit={onSubmit} agentWatching={agentWatching} collapseButton={collapseButton} />;
}

function FeedbackDisplay({ sessionId, revision, label, waitingForUpdate, feedbackConsumed, agentWatching, collapseButton }: { sessionId: string; revision: number; label: string; waitingForUpdate?: boolean; feedbackConsumed?: boolean; agentWatching?: boolean; collapseButton?: React.ReactNode }) {
  const isSharedMode = MODE.isShared;
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    // Shared mode has no prior local feedback to fetch — shared canvases
    // are always one-off snapshots. Skip the call entirely.
    if (!FS_AVAILABLE) { setFeedback(null); setLoading(false); return; }
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

      {waitingForUpdate && !isSharedMode && <WaitingBanner feedbackConsumed={feedbackConsumed} agentWatching={agentWatching} />}

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
  const { annotations, generalNote, activeAnnotationId, setActiveAnnotationId } = useAnnotations();
  const { setActiveView } = useContext(ActiveViewContext);
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
        <ReadOnlyAnnotationList
          annotations={annotations}
          generalNote={generalNote}
          activeAnnotationId={activeAnnotationId}
          setActiveAnnotationId={setActiveAnnotationId}
          setActiveView={setActiveView}
        />
      )}
    </div>
  );
}

function FeedbackDisplayContent({ sessionId, revision }: { sessionId: string; revision: number }) {
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    // Shared mode has no prior local feedback to fetch — shared canvases
    // are always one-off snapshots. Skip the call entirely.
    if (!FS_AVAILABLE) { setFeedback(null); setLoading(false); return; }
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

function ReadOnlyAnnotationList({ annotations, generalNote, activeAnnotationId, setActiveAnnotationId, setActiveView }: {
  annotations: Annotation[];
  generalNote: string;
  activeAnnotationId: string | null;
  setActiveAnnotationId: (id: string | null) => void;
  setActiveView: (view: ActiveView) => void;
}) {
  const responseAnnotations = annotations.filter((a) => a.filePath === RESPONSE_ANNOTATION_PATH);
  const planAnnotations = annotations.filter((a) => !a.filePath);
  const fileAnnotations = annotations.filter((a) => a.filePath && a.filePath !== RESPONSE_ANNOTATION_PATH);
  const fileGroups: Record<string, Annotation[]> = {};
  for (const ann of fileAnnotations) {
    const key = ann.filePath!;
    if (!fileGroups[key]) fileGroups[key] = [];
    fileGroups[key].push(ann);
  }

  const handleMouseEnter = (annId: string) => {
    setActiveAnnotationId(annId);
    setMarkActive(annId, true);
  };

  const handleMouseLeave = (annId: string) => {
    setActiveAnnotationId(null);
    setMarkActive(annId, false);
  };

  const handleClick = (ann: Annotation) => {
    if (ann.id === activeAnnotationId) {
      setActiveAnnotationId(null);
    } else {
      setActiveAnnotationId(ann.id);
      if (ann.filePath) {
        setActiveView({ type: "file", path: ann.filePath });
        setTimeout(() => {
          const el = findAnnotationElement(ann);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 150);
      }
    }
  };

  const renderAnnotation = (ann: Annotation) => (
    <div
      key={ann.id}
      className={`group/ann relative px-3 py-2.5 transition-colors duration-150 cursor-pointer ${
        activeAnnotationId === ann.id
          ? "bg-highlight-selected"
          : "odd:bg-bg-elevated-half hover:bg-bg-input"
      }`}
      onMouseEnter={() => handleMouseEnter(ann.id)}
      onMouseLeave={() => handleMouseLeave(ann.id)}
      onClick={() => handleClick(ann)}
    >
      <div className="text-[11px] text-text-tertiary italic line-clamp-2 mb-1.5 leading-snug font-body border-l-2 border-border-medium pl-2">
        {ann.snippet.length > 80 ? ann.snippet.slice(0, 80) + "..." : ann.snippet}
      </div>
      {ann.note.trim() && (
        <div className="text-[13px] font-body text-text-primary leading-relaxed">
          {ann.note}
        </div>
      )}
      <ImageThumbnails images={ann.images || []} />
      <div className="absolute top-1.5 right-1.5 opacity-0 group-hover/ann:opacity-100 transition-opacity duration-100">
        <button
          onClick={(e) => { e.stopPropagation(); scrollToAnnotation(ann, setActiveView); }}
          className="w-5 h-5 flex items-center justify-center rounded text-text-tertiary hover:text-text-secondary hover:bg-bg-input transition-colors"
          title="Scroll to annotation"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
          </svg>
        </button>
      </div>
    </div>
  );

  const hasMultipleGroups = [responseAnnotations, planAnnotations, fileAnnotations].filter((g) => g.length > 0).length > 1;

  return (
    <>
      <div className="flex-1 overflow-y-auto">
        {responseAnnotations.length > 0 && (
          <>
            {hasMultipleGroups && (
              <div className="text-[10px] uppercase tracking-widest text-text-tertiary font-body px-3 mb-1 mt-1">Agent Response</div>
            )}
            {responseAnnotations.map(renderAnnotation)}
          </>
        )}

        {planAnnotations.length > 0 && (
          <>
            {hasMultipleGroups && (
              <div className="text-[10px] uppercase tracking-widest text-text-tertiary font-body px-3 mb-1 mt-1">Canvas</div>
            )}
            {planAnnotations.map(renderAnnotation)}
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
            {anns.map(renderAnnotation)}
          </div>
        ))}
      </div>

      {generalNote.trim() && (
        <div className="border-t border-border-subtle px-4 py-3 flex-shrink-0">
          <div className="text-[13px] font-body text-text-primary leading-relaxed">
            {generalNote}
          </div>
        </div>
      )}
    </>
  );
}

function AnnotationSidebarInner({ onPreview, onSubmit, agentWatching, collapseButton }: AnnotationSidebarProps & { agentWatching: boolean }) {
  const {
    annotations, updateAnnotation, removeAnnotation,
    addAnnotationImage, removeAnnotationImage,
    generalNote, setGeneralNote,
    activeAnnotationId, setActiveAnnotationId,
    responses, feedbackEntries,
  } = useAnnotations();
  const sessionId = useContext(SessionContext);
  const { setActiveView } = React.useContext(ActiveViewContext);

  const listRef = useRef<HTMLDivElement>(null);
  const annRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const responseAnnotations = annotations.filter((a) => a.filePath === RESPONSE_ANNOTATION_PATH);
  const planAnnotations = annotations.filter((a) => !a.filePath);
  const fileAnnotations = annotations.filter((a) => a.filePath && a.filePath !== RESPONSE_ANNOTATION_PATH);
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

  // Hover on sidebar card → highlight inline mark + block
  const handleMouseEnter = useCallback((annId: string) => {
    setActiveAnnotationId(annId);
    setMarkActive(annId, true);
  }, [setActiveAnnotationId]);

  const handleMouseLeave = useCallback((annId: string) => {
    setActiveAnnotationId(null);
    setMarkActive(annId, false);
  }, [activeAnnotationId]);

  const hasResponses = Array.from(responses.values()).some(hasValue);
  const hasFeedback = feedbackEntries.size > 0;
  const hasContent = annotations.length > 0 || generalNote.trim().length > 0 || hasResponses || hasFeedback;
  const [validationError, setValidationError] = useState<string | null>(null);

  const renderAnnotation = (ann: Annotation) => {
    const isRemote = ann.source === "remote";
    return (
    <div
      key={ann.id}
      ref={(el) => { if (el) annRefs.current.set(ann.id, el); else annRefs.current.delete(ann.id); }}
      className={`group/ann relative px-3 py-2.5 transition-colors duration-150 ${
        activeAnnotationId === ann.id
          ? "bg-highlight-selected"
          : isRemote
            ? "bg-accent-purple-muted/30 hover:bg-accent-purple-muted/50"
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
            setTimeout(() => {
              const el = findAnnotationElement(ann);
              if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
            }, 150);
          }
        }
      }}
    >
      {isRemote && ann.author && (
        <div className="flex items-center gap-1.5 mb-1.5">
          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-accent-purple text-white text-[9px] font-medium uppercase">
            {ann.author.name.charAt(0)}
          </span>
          <span className="text-[11px] font-medium text-accent-purple font-body">
            {ann.author.name}
          </span>
          <span className="text-[10px] text-text-tertiary font-body uppercase tracking-widest">
            Remote
          </span>
        </div>
      )}

      {/* Snippet quote */}
      <div className="text-[11px] text-text-tertiary italic line-clamp-2 mb-1.5 leading-snug font-body border-l-2 border-border-medium pl-2">
        {ann.snippet.length > 80 ? ann.snippet.slice(0, 80) + "..." : ann.snippet}
      </div>

      {/* Editable note + images — only for local annotations. Remote are read-only. */}
      {isRemote ? (
        <div className="text-[13px] font-body text-text-primary leading-relaxed whitespace-pre-wrap">
          {ann.note}
        </div>
      ) : (
        <div onClick={(e) => e.stopPropagation()}>
          <AnnotationEditor
            note={ann.note}
            onNoteChange={(note) => updateAnnotation(ann.id, note)}
            images={ann.images || []}
            onAddImage={(path) => addAnnotationImage(ann.id, path)}
            onRemoveImage={(path) => removeAnnotationImage(ann.id, path)}
            sessionId={sessionId}
            autoResize
            minHeight={20}
            textareaClassName="w-full bg-transparent text-[13px] font-body text-text-primary resize-none focus:outline-none leading-relaxed p-0 border-none min-h-[20px]"
            textareaStyle={{ height: "auto", overflow: "hidden" }}
            placeholder="Add your note..."
            attachButton="on-focus"
          />
        </div>
      )}

      {/* Actions — top right on hover */}
      <div className="absolute top-1.5 right-1.5 opacity-0 group-hover/ann:opacity-100 transition-opacity duration-100 flex items-center gap-0.5">
        <button
          onClick={(e) => {
            e.stopPropagation();
            scrollToAnnotation(ann, setActiveView);
          }}
          className="w-5 h-5 flex items-center justify-center rounded text-text-tertiary hover:text-text-secondary hover:bg-bg-input transition-colors"
          title="Scroll to annotation"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
          </svg>
        </button>
        {!isRemote && (
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
        )}
      </div>
    </div>
    );
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
          {!MODE.isShared && (
            <span
              className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${agentWatching ? "bg-accent-green" : "bg-accent-amber"}`}
              title={agentWatching ? "Agent connected" : "Agent disconnected"}
            />
          )}
        </span>
        {collapseButton}
      </div>

      {/* Annotation list */}
      <div ref={listRef} className="flex-1 overflow-y-auto">
        {annotations.length === 0 && (
          <p className="text-[12px] text-text-tertiary px-3 py-4 leading-relaxed font-body">
            Select text in the canvas or in files to add annotations.
          </p>
        )}

        {responseAnnotations.length > 0 && (
          <>
            {(planAnnotations.length > 0 || fileAnnotations.length > 0) && (
              <div className="text-[10px] uppercase tracking-widest text-text-tertiary font-body px-3 mb-1 mt-1">Agent Response</div>
            )}
            {responseAnnotations.map(renderAnnotation)}
          </>
        )}

        {planAnnotations.length > 0 && (responseAnnotations.length > 0 || fileAnnotations.length > 0) && (
          <div className="text-[10px] uppercase tracking-widest text-text-tertiary font-body px-3 mb-1 mt-1">Canvas</div>
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
          onInput={(e) => autoResizeTextarea(e.target as HTMLTextAreaElement, 40)}
          ref={(el) => { if (el) autoResizeTextarea(el, 40); }}
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
                const allMissing = getMissingRequiredLabels(responses, feedbackEntries);
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


