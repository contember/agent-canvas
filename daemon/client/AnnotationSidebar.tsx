import React, { useRef, useEffect, useCallback } from "react";
import { useAnnotations, Annotation } from "./AnnotationProvider";
import { setMarkActive } from "./highlightRange";
import { generateMarkdown, hasValue } from "./generateMarkdown";

interface AnnotationSidebarProps {
  onPreview: () => void;
  onSubmit: (feedback: string) => void;
}

export function AnnotationSidebar({ onPreview, onSubmit }: AnnotationSidebarProps) {
  const {
    annotations, updateAnnotation, removeAnnotation,
    generalNote, setGeneralNote,
    activeAnnotationId, setActiveAnnotationId,
    responses,
  } = useAnnotations();

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

  // Hover on sidebar card → highlight inline mark + scroll to it
  const handleMouseEnter = useCallback((annId: string) => {
    setMarkActive(annId, true);
    // Scroll inline mark into view
    const mark = document.querySelector(`[data-annotation-id="${annId}"]`) as HTMLElement | null;
    if (mark) {
      mark.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, []);

  const handleMouseLeave = useCallback((annId: string) => {
    if (annId !== activeAnnotationId) {
      setMarkActive(annId, false);
    }
  }, [activeAnnotationId]);

  const hasResponses = Array.from(responses.values()).some(hasValue);
  const hasContent = annotations.length > 0 || generalNote.trim().length > 0 || hasResponses;

  const renderAnnotation = (ann: Annotation) => (
    <div
      key={ann.id}
      ref={(el) => { if (el) annRefs.current.set(ann.id, el); else annRefs.current.delete(ann.id); }}
      className={`group/ann rounded-md px-3 py-2.5 mb-1 transition-colors duration-150 ${
        activeAnnotationId === ann.id
          ? "bg-highlight-selected"
          : "hover:bg-bg-input"
      }`}
      onMouseEnter={() => handleMouseEnter(ann.id)}
      onMouseLeave={() => handleMouseLeave(ann.id)}
      onClick={() => setActiveAnnotationId(ann.id === activeAnnotationId ? null : ann.id)}
    >
      {/* Snippet quote */}
      <div className="text-[11px] text-text-tertiary italic line-clamp-2 mb-1 leading-snug font-body">
        "{ann.snippet.length > 80 ? ann.snippet.slice(0, 80) + "..." : ann.snippet}"
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

      {/* Delete — on hover */}
      <div className="flex mt-1 opacity-0 group-hover/ann:opacity-100 transition-opacity duration-100">
        <button
          onClick={(e) => { e.stopPropagation(); removeAnnotation(ann.id); }}
          className="text-[11px] text-text-tertiary hover:text-accent-red font-body transition-colors"
        >
          Delete
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between flex-shrink-0">
        <span className="text-[11px] font-medium uppercase tracking-widest text-text-tertiary font-body">
          Annotations
          {annotations.length > 0 && (
            <span className="ml-1 font-normal">{annotations.length}</span>
          )}
        </span>
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
            <div className="text-[10px] uppercase tracking-widest text-text-tertiary font-body px-3 pt-3 pb-1 truncate" title={filePath}>
              {filePath}
            </div>
            {anns.map(renderAnnotation)}
          </div>
        ))}
      </div>

      {/* General note — seamless */}
      <div className="border-t border-border-subtle px-4 py-3 flex-shrink-0">
        <textarea
          value={generalNote}
          onChange={(e) => setGeneralNote(e.target.value)}
          className="w-full bg-transparent text-[13px] font-body text-text-primary resize-none focus:outline-none leading-relaxed p-0 border-none placeholder:text-text-disabled min-h-[40px]"
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

      {/* Action buttons */}
      <div className="px-4 py-3 border-t border-border-subtle flex gap-2 flex-shrink-0">
        <button
          onClick={onPreview}
          disabled={!hasContent}
          className={`flex-1 py-2 rounded-lg font-body text-[13px] font-medium transition-all ${
            hasContent
              ? "bg-border-subtle text-text-secondary hover:bg-border-medium hover:text-text-primary"
              : "text-text-disabled cursor-default"
          }`}
        >
          Preview
        </button>
        <button
          onClick={() => {
            const md = generateMarkdown(annotations, generalNote, responses);
            onSubmit(md);
          }}
          disabled={!hasContent}
          className={`flex-1 py-2 rounded-lg font-body text-[13px] font-medium transition-all ${
            hasContent
              ? "bg-btn-primary text-btn-primary-text hover:opacity-90 hover:-translate-y-px shadow-sm"
              : "bg-bg-input text-text-disabled cursor-default"
          }`}
        >
          Submit
        </button>
      </div>
    </div>
  );
}


