import { useContext, useEffect, useRef } from "react";
import { useAnnotations } from "./AnnotationProvider";
import type { Annotation } from "./AnnotationProvider";
import { SessionContext } from "@fabrika/annotations/runtime";
import { setMarkActive } from "./highlightRange";
import { describeSnippet } from "./annotationDom";
import { AnnotationEditor, ImageThumbnails } from "./AnnotationEditor";

/**
 * The annotations a host has collected, as a list of editable cards.
 *
 * Flat by design: what an annotation belongs to — a file, a screen, a section —
 * is the host's taxonomy, so the host slices the annotations into groups and
 * renders one list per group. The card itself is the same everywhere.
 */

/** The one line a card shows for what its annotation points at. */
function snippetLabel(snippet: string): string {
  const label = describeSnippet(snippet);
  return label.length > 80 ? label.slice(0, 80) + "..." : label;
}

export interface AnnotationListProps {
  annotations: Annotation[];
  /** Frozen view: notes read as text, nothing is deletable, and the list does
   *  not chase the active card. */
  readOnly?: boolean;
  /** A card just became the active one — hosts reveal what it points at here. */
  onSelect?: (ann: Annotation) => void;
  /** Backs the reveal button. Omit it and no button is drawn. */
  onReveal?: (ann: Annotation) => void;
  /** Remote annotations ticked for submission. Pass both or neither — a host
   *  with no notion of remote annotations passes neither and gets none of the
   *  remote affordances. */
  includedRemoteIds?: Set<string>;
  onToggleRemoteId?: (id: string) => void;
}

export function AnnotationList({
  annotations, readOnly = false, onSelect, onReveal,
  includedRemoteIds, onToggleRemoteId,
}: AnnotationListProps) {
  const {
    updateAnnotation, removeAnnotation,
    addAnnotationImage, removeAnnotationImage,
    activeAnnotationId, setActiveAnnotationId,
  } = useAnnotations();
  const sessionId = useContext(SessionContext);
  const annRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Follow the active annotation, which is as often picked in the document as
  // in this list.
  useEffect(() => {
    if (readOnly || !activeAnnotationId) return;
    const el = annRefs.current.get(activeAnnotationId);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activeAnnotationId, readOnly]);

  // Hover on a card → highlight the mark it points at.
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
      return;
    }
    setActiveAnnotationId(ann.id);
    onSelect?.(ann);
  };

  // Remote is only a concept for hosts that handle it.
  const handlesRemote = !!includedRemoteIds && !!onToggleRemoteId;

  const renderAnnotation = (ann: Annotation) => {
    const isRemote = handlesRemote && ann.source === "remote";
    return (
      <div
        key={ann.id}
        ref={(el) => { if (el) annRefs.current.set(ann.id, el); else annRefs.current.delete(ann.id); }}
        className={`group/ann relative px-3 py-2.5 transition-colors duration-150 ${readOnly ? "cursor-pointer " : ""}${
          activeAnnotationId === ann.id
            ? "bg-highlight-selected"
            : isRemote
              ? "bg-accent-purple-muted/30 hover:bg-accent-purple-muted/50"
              : "odd:bg-bg-elevated-half hover:bg-bg-input"
        }`}
        onMouseEnter={() => handleMouseEnter(ann.id)}
        onMouseLeave={() => handleMouseLeave(ann.id)}
        onClick={() => handleClick(ann)}
      >
        {isRemote && ann.author && (
          <div className="flex items-center gap-1.5 mb-1.5">
            <input
              type="checkbox"
              checked={includedRemoteIds.has(ann.id)}
              onChange={(e) => { e.stopPropagation(); onToggleRemoteId(ann.id); }}
              onClick={(e) => e.stopPropagation()}
              className="accent-accent-purple flex-shrink-0"
              title="Include in submission"
            />
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
          {snippetLabel(ann.snippet)}
        </div>

        {/* Editable note + images — only the reader's own live annotations. */}
        {readOnly ? (
          <>
            {ann.note.trim() && (
              <div className="text-[13px] font-body text-text-primary leading-relaxed">
                {ann.note}
              </div>
            )}
            <ImageThumbnails images={ann.images || []} />
          </>
        ) : isRemote ? (
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
          {onReveal && (
            <button
              onClick={(e) => { e.stopPropagation(); onReveal(ann); }}
              className="w-5 h-5 flex items-center justify-center rounded text-text-tertiary hover:text-text-secondary hover:bg-bg-input transition-colors"
              title="Scroll to annotation"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
              </svg>
            </button>
          )}
          {!readOnly && !isRemote && (
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

  return <>{annotations.map(renderAnnotation)}</>;
}
