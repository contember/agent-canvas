import React, { useEffect, useState, useRef, useContext, useCallback } from "react";
import { SessionContext } from "#canvas/runtime";
import { useAnnotations } from "./AnnotationProvider";
import { wrapRangeWithMark, updateAllMarkStates, renameMarkId, unwrapMarks } from "./highlightRange";
import { extractContext } from "./annotationContext";
import { AnnotationCreatePopover, AnnotationEditPopover } from "./Popover";

interface PlanRendererProps {
  revision: number;
}

export function PlanRenderer({ revision }: PlanRendererProps) {
  const sessionId = useContext(SessionContext);
  const [PlanComponent, setPlanComponent] = useState<React.ComponentType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const { annotations, addAnnotationWithId, removeAnnotation, updateAnnotation, activeAnnotationId, setActiveAnnotationId } = useAnnotations();
  const [editingAnn, setEditingAnn] = useState<{ id: string; note: string } | null>(null);

  // Popover state
  const [editPopover, setEditPopover] = useState<{ anchorEl: HTMLElement; annId: string } | null>(null);
  const [createPopover, setCreatePopover] = useState<{ anchorEl: HTMLElement; tempId: string; snippet: string; ctx: any } | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    import(`/api/session/${sessionId}/plan.js?rev=${revision}&t=${Date.now()}`)
      .then((mod) => { setPlanComponent(() => mod.default); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [sessionId, revision]);

  // Update mark active states when activeAnnotationId changes
  useEffect(() => {
    updateAllMarkStates(activeAnnotationId);
  }, [activeAnnotationId]);

  // Click handler for marks in plan
  useEffect(() => {
    const container = containerRef.current;
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

    // Hover on inline marks → highlight sidebar card
    const handleMouseOver = (e: MouseEvent) => {
      const mark = (e.target as HTMLElement).closest("[data-annotation-id]") as HTMLElement | null;
      if (mark) {
        const annId = mark.getAttribute("data-annotation-id")!;
        setActiveAnnotationId(annId);
      }
    };

    const handleMouseOut = (e: MouseEvent) => {
      const mark = (e.target as HTMLElement).closest("[data-annotation-id]");
      const relatedMark = (e.relatedTarget as HTMLElement | null)?.closest?.("[data-annotation-id]");
      if (mark && !relatedMark) {
        // Left a mark without entering another one — only deactivate if popover isn't open
        if (!document.getElementById("ann-inline-popover")) {
          setActiveAnnotationId(null);
        }
      }
    };

    container.addEventListener("click", handleClick);
    container.addEventListener("mouseover", handleMouseOver);
    container.addEventListener("mouseout", handleMouseOut);
    return () => {
      container.removeEventListener("click", handleClick);
      container.removeEventListener("mouseover", handleMouseOver);
      container.removeEventListener("mouseout", handleMouseOut);
    };
  }, [annotations, activeAnnotationId]);

  // Use document-level mouseup so selections that end outside the container still work
  useEffect(() => {
    const handler = () => handleMouseUp();
    document.addEventListener("mouseup", handler);
    return () => document.removeEventListener("mouseup", handler);
  }, []);

  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
    if (!containerRef.current) return;
    const range = sel.getRangeAt(0);
    // Selection must have started inside the plan container
    if (!containerRef.current.contains(range.startContainer)) return;
    // Don't create new annotation if clicking inside existing mark
    if ((range.startContainer.parentElement as HTMLElement)?.closest?.("[data-annotation-id]")) return;
    const snippet = sel.toString().trim();
    if (snippet.length < 2) return;

    // Capture context before popover disturbs the DOM
    const savedRange = range.cloneRange();
    const ctx = extractContext(range, containerRef.current);
    const tempId = `__pending_${Date.now()}`;
    try { wrapRangeWithMark(savedRange, tempId); } catch {}
    window.getSelection()?.removeAllRanges();

    const marks = document.querySelectorAll(`[data-annotation-id="${tempId}"]`);
    const lastMark = marks[marks.length - 1] as HTMLElement | undefined;
    if (!lastMark) return;

    setCreatePopover({ anchorEl: lastMark, tempId, snippet, ctx });
  }, [addAnnotationWithId]);

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-text-tertiary font-body text-body">Loading plan...</div>;
  }

  if (error) {
    return (
      <div className="bg-accent-red-muted rounded-lg p-5">
        <h3 className="font-body font-semibold text-accent-red mb-2">Compilation Error</h3>
        <pre className="text-code font-mono text-text-secondary whitespace-pre-wrap">{error}</pre>
      </div>
    );
  }

  if (!PlanComponent) {
    return <div className="text-text-tertiary text-center py-8 font-body text-body">No plan loaded</div>;
  }

  const scrollContainer = document.getElementById("plan-scroll-container");

  return (
    <>
      <div ref={containerRef} className="plan-content plan-updated">
        <PlanComponent />
      </div>
      {editingAnn && (
        <EditAnnotationModal
          note={editingAnn.note}
          onSave={(note) => { updateAnnotation(editingAnn.id, note); setEditingAnn(null); }}
          onCancel={() => setEditingAnn(null)}
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
            onUpdate={(note) => updateAnnotation(editPopover.annId, note)}
            onDelete={() => { removeAnnotation(editPopover.annId); setActiveAnnotationId(null); }}
            onClose={() => setEditPopover(null)}
          />
        );
      })()}

      {createPopover && (
        <AnnotationCreatePopover
          anchorEl={createPopover.anchorEl}
          scrollContainer={scrollContainer}
          snippet={createPopover.snippet}
          truncateAt={80}
          onAdd={(note) => {
            const id = `ann-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            renameMarkId(createPopover.tempId, id);
            addAnnotationWithId(id, createPopover.snippet, note, undefined, createPopover.ctx);
            setCreatePopover(null);
          }}
          onCancel={() => {
            unwrapMarks(createPopover.tempId);
            setCreatePopover(null);
          }}
        />
      )}
    </>
  );
}

function EditAnnotationModal({ note, onSave, onCancel }: { note: string; onSave: (n: string) => void; onCancel: () => void }) {
  const [text, setText] = React.useState(note);
  const ref = React.useRef<HTMLTextAreaElement>(null);
  React.useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={onCancel}>
      <div className="bg-bg-elevated border border-border-hover rounded-lg shadow-md p-4 w-80" onClick={(e) => e.stopPropagation()}>
        <div className="text-tiny uppercase tracking-widest text-text-tertiary font-body mb-2">Edit annotation</div>
        <textarea ref={ref} value={text} onChange={(e) => setText(e.target.value)}
          className="w-full bg-transparent border-none text-body font-body text-text-primary resize-vertical focus:outline-none min-h-[60px]"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) onSave(text.trim());
            if (e.key === "Escape") onCancel();
          }}
        />
        <div className="flex justify-end gap-2 mt-2">
          <button onClick={onCancel} className="text-meta text-text-tertiary font-body px-3 py-1">Cancel</button>
          <button onClick={() => onSave(text.trim())} className="text-meta font-medium font-body px-3 py-1 rounded-md bg-highlight-bg text-text-primary border border-highlight-border">Save</button>
        </div>
      </div>
    </div>
  );
}

