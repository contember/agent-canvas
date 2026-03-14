import React, { useEffect, useState, useRef, useContext, useCallback } from "react";
import { SessionContext } from "#canvas/runtime";
import { useAnnotations } from "./AnnotationProvider";
import { wrapRangeWithMark, updateAllMarkStates, renameMarkId, unwrapMarks } from "./highlightRange";
import { extractContext } from "./annotationContext";
import { getPopoverPosition } from "./popoverPosition";

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
        const ann = annotations.find((a) => a.id === annId);
        if (ann) showInlinePopover(mark, ann, document.getElementById("plan-scroll-container"), setEditingAnn, removeAnnotation, setActiveAnnotationId, updateAnnotation);
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
    const scrollContainer = document.getElementById("plan-scroll-container");
    showAnnotationPopover(tempId, snippet, scrollContainer, (s, n) => {
      const id = `ann-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      renameMarkId(tempId, id);
      addAnnotationWithId(id, s, n, undefined, ctx);
    });
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

function showAnnotationPopover(
  tempId: string,
  snippet: string,
  scrollContainer: HTMLElement | null,
  onAdd: (snippet: string, note: string) => void
) {
  const existing = document.getElementById("annotation-popover");
  if (existing) existing.remove();

  // Position based on the temp mark elements (always valid after wrapRangeWithMark)
  const marks = document.querySelectorAll(`[data-annotation-id="${tempId}"]`);
  const lastMark = marks[marks.length - 1] as HTMLElement | undefined;
  if (!lastMark) return;

  const { style: posStyle, parent } = getPopoverPosition(lastMark, scrollContainer);
  const popover = document.createElement("div");
  popover.id = "annotation-popover";
  Object.assign(popover.style, {
    ...posStyle, zIndex: "50",
    width: "280px", background: "var(--color-bg-elevated)",
    border: "1px solid var(--color-border-hover)",
    borderRadius: "8px", boxShadow: "0 4px 12px var(--color-shadow)",
    padding: "12px", fontFamily: "'Inter', sans-serif",
  });

  const truncated = snippet.length > 80 ? snippet.slice(0, 80) + "..." : snippet;
  popover.innerHTML = `
    <div style="font-size:12px;color:var(--color-text-tertiary);font-style:italic;margin-bottom:8px;line-height:1.4;">"${escapeHtml(truncated)}"</div>
    <textarea id="annotation-note" style="width:100%;min-height:60px;background:transparent;border:none;color:var(--color-text-primary);font-family:'Inter',sans-serif;font-size:13px;line-height:1.5;resize:vertical;outline:none;" placeholder="Add your note..."></textarea>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px;">
      <button id="annotation-cancel" style="font-size:12px;color:var(--color-text-tertiary);background:none;border:none;cursor:pointer;padding:4px 12px;font-family:'Inter',sans-serif;">Cancel</button>
      <button id="annotation-add" style="font-size:12px;font-weight:500;padding:4px 12px;border-radius:6px;background:var(--color-highlight-bg);color:var(--color-text-primary);border:1px solid var(--color-highlight-border);cursor:pointer;font-family:'Inter',sans-serif;">Add</button>
    </div>
  `;
  parent.appendChild(popover);
  (document.getElementById("annotation-note") as HTMLTextAreaElement).focus();

  const cleanup = (cancelled = false) => { popover.remove(); window.getSelection()?.removeAllRanges(); if (cancelled) unwrapMarks(tempId); };

  document.getElementById("annotation-cancel")!.onclick = () => cleanup(true);
  const submit = () => {
    const note = (document.getElementById("annotation-note") as HTMLTextAreaElement).value.trim();
    if (note) { onAdd(snippet, note); cleanup(); }
    else cleanup(true);
  };
  document.getElementById("annotation-add")!.onclick = submit;
  (document.getElementById("annotation-note") as HTMLTextAreaElement).addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit();
    if (e.key === "Escape") cleanup(true);
  });
  setTimeout(() => {
    const handler = (e: MouseEvent) => {
      if (!popover.contains(e.target as Node)) { cleanup(true); document.removeEventListener("mousedown", handler); }
    };
    document.addEventListener("mousedown", handler);
  }, 0);
}

function showInlinePopover(
  anchor: HTMLElement,
  ann: { id: string; snippet: string; note: string },
  scrollContainer: HTMLElement | null,
  onEdit: (a: { id: string; note: string }) => void,
  onDelete: (id: string) => void,
  setActive: (id: string | null) => void,
  updateAnnotation?: (id: string, note: string) => void,
) {
  document.getElementById("ann-inline-popover")?.remove();
  const { style: posStyle, parent } = getPopoverPosition(anchor, scrollContainer);
  const pop = document.createElement("div");
  pop.id = "ann-inline-popover";
  Object.assign(pop.style, {
    ...posStyle, zIndex: "60",
    width: "280px", background: "var(--color-bg-elevated)",
    border: "1px solid var(--color-border-hover)",
    borderRadius: "8px", boxShadow: "0 4px 12px var(--color-shadow)",
    padding: "10px 12px", fontFamily: "'Inter', sans-serif",
  });

  pop.innerHTML = `
    <textarea id="ann-pop-textarea" style="width:100%;background:transparent;border:none;color:var(--color-text-primary);font-family:'Inter',sans-serif;font-size:13px;line-height:1.5;resize:none;outline:none;overflow:hidden;">${escapeHtml(ann.note)}</textarea>
    <div style="display:flex;justify-content:flex-end;margin-top:6px;">
      <button id="ann-pop-delete" style="font-size:11px;color:var(--color-text-tertiary);background:none;border:none;cursor:pointer;padding:2px 0;font-family:'Inter',sans-serif;">Delete</button>
    </div>
  `;
  parent.appendChild(pop);

  const textarea = document.getElementById("ann-pop-textarea") as HTMLTextAreaElement;
  // Auto-size
  textarea.style.height = "auto";
  textarea.style.height = textarea.scrollHeight + "px";
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);

  textarea.addEventListener("input", () => {
    textarea.style.height = "auto";
    textarea.style.height = textarea.scrollHeight + "px";
    if (updateAnnotation) updateAnnotation(ann.id, textarea.value);
  });

  const cleanup = () => pop.remove();

  const deleteBtn = document.getElementById("ann-pop-delete")!;
  deleteBtn.onclick = (e) => { e.stopPropagation(); cleanup(); onDelete(ann.id); setActive(null); };
  deleteBtn.addEventListener("mouseenter", () => { deleteBtn.style.color = "var(--color-accent-red)"; });
  deleteBtn.addEventListener("mouseleave", () => { deleteBtn.style.color = "var(--color-text-tertiary)"; });

  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Escape") cleanup();
  });

  setTimeout(() => {
    const handler = (e: MouseEvent) => {
      if (!pop.contains(e.target as Node) && !(e.target as HTMLElement).closest("[data-annotation-id]")) {
        // Save on close
        if (updateAnnotation) updateAnnotation(ann.id, textarea.value);
        cleanup();
        document.removeEventListener("mousedown", handler);
      }
    };
    document.addEventListener("mousedown", handler);
  }, 0);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
