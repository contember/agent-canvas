import React, { useEffect, useState, useRef, useCallback } from "react";
import type { AnnotationContext, Annotation } from "./AnnotationProvider";
import { useAnnotations } from "./AnnotationProvider";
import { wrapRangeWithMark, updateAllMarkStates, renameMarkId, unwrapMarks, restoreMarks } from "./highlightRange";
import { AnnotationCreatePopover, AnnotationEditPopover } from "./Popover";
import { generateAnnotationId } from "./utils";

interface UseTextAnnotationOptions {
  /** Ref to the container element where text can be selected and marks are placed */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Trigger for mark restoration — when this value changes, marks are restored */
  restoreKey: unknown;
  /** Subset of annotations to restore in this container */
  restoreAnnotations: Annotation[];
  /** Build AnnotationContext from a selection Range */
  extractContext: (range: Range) => AnnotationContext | undefined;
  /** Optional filePath to associate with created annotations */
  filePath?: string;
  /** Scroll container for popover positioning */
  scrollContainer?: HTMLElement | null;
}

export function useTextAnnotation(options: UseTextAnnotationOptions) {
  const { containerRef, restoreKey, restoreAnnotations, extractContext, filePath, scrollContainer } = options;
  const { annotations: allAnnotations, addAnnotationWithId, removeAnnotation, updateAnnotation, addAnnotationImage, removeAnnotationImage, activeAnnotationId, setActiveAnnotationId } = useAnnotations();

  const [editPopover, setEditPopover] = useState<{ anchorEl: HTMLElement; annId: string } | null>(null);
  const [createPopover, setCreatePopover] = useState<{ anchorEl: HTMLElement; tempId: string; snippet: string; ctx?: AnnotationContext } | null>(null);

  // Refs for stable handlers (registered with empty or minimal deps)
  const extractContextRef = useRef(extractContext);
  extractContextRef.current = extractContext;
  const filePathRef = useRef(filePath);
  filePathRef.current = filePath;
  const addAnnotationRef = useRef(addAnnotationWithId);
  addAnnotationRef.current = addAnnotationWithId;
  const activeAnnotationIdRef = useRef(activeAnnotationId);
  activeAnnotationIdRef.current = activeAnnotationId;
  const setActiveAnnotationIdRef = useRef(setActiveAnnotationId);
  setActiveAnnotationIdRef.current = setActiveAnnotationId;

  // Mark restoration after content renders
  useEffect(() => {
    if (!containerRef.current) return;
    const timer = setTimeout(() => {
      if (containerRef.current) {
        restoreMarks(containerRef.current, restoreAnnotations);
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [restoreKey]);

  // Mark active state tracking
  const prevActiveRef = useRef<string | null>(null);
  useEffect(() => {
    updateAllMarkStates(activeAnnotationId, prevActiveRef.current);
    prevActiveRef.current = activeAnnotationId;
  }, [activeAnnotationId]);

  // Mark click/hover/out handlers on the container (uses refs to avoid re-registration on every hover)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleClick = (e: MouseEvent) => {
      const mark = (e.target as HTMLElement).closest("[data-annotation-id]") as HTMLElement | null;
      if (!mark) return;
      e.stopPropagation();
      const annId = mark.getAttribute("data-annotation-id")!;
      if (annId === activeAnnotationIdRef.current) {
        setEditPopover({ anchorEl: mark, annId });
      } else {
        setActiveAnnotationIdRef.current(annId);
      }
    };

    const handleMouseOver = (e: MouseEvent) => {
      const mark = (e.target as HTMLElement).closest("[data-annotation-id]") as HTMLElement | null;
      if (mark) setActiveAnnotationIdRef.current(mark.getAttribute("data-annotation-id")!);
    };

    const handleMouseOut = (e: MouseEvent) => {
      const mark = (e.target as HTMLElement).closest("[data-annotation-id]");
      const related = (e.relatedTarget as HTMLElement | null)?.closest?.("[data-annotation-id]");
      if (mark && !related && !document.getElementById("ann-inline-popover")) setActiveAnnotationIdRef.current(null);
    };

    container.addEventListener("click", handleClick);
    container.addEventListener("mouseover", handleMouseOver);
    container.addEventListener("mouseout", handleMouseOut);
    return () => {
      container.removeEventListener("click", handleClick);
      container.removeEventListener("mouseover", handleMouseOver);
      container.removeEventListener("mouseout", handleMouseOut);
    };
  }, [restoreKey]);

  // Document-level mouseup for text selection → mark → popover
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
    if (!containerRef.current.contains(range.startContainer)) return;
    if ((range.startContainer.parentElement as HTMLElement)?.closest?.("[data-annotation-id]")) return;
    const snippet = sel.toString().trim();
    if (snippet.length < 2) return;

    // Extract context before wrapping disturbs the DOM
    const ctx = extractContextRef.current(range);
    const savedRange = range.cloneRange();
    const tempId = `__pending_${Date.now()}`;
    try { wrapRangeWithMark(savedRange, tempId); } catch {}
    window.getSelection()?.removeAllRanges();

    const marks = document.querySelectorAll(`[data-annotation-id="${tempId}"]`);
    const lastMark = marks[marks.length - 1] as HTMLElement | undefined;
    if (!lastMark) return;

    setCreatePopover({ anchorEl: lastMark, tempId, snippet, ctx });
  }, []);

  const openCreatePopover = useCallback((anchorEl: HTMLElement, tempId: string, snippet: string, ctx?: AnnotationContext) => {
    setCreatePopover({ anchorEl, tempId, snippet, ctx });
  }, []);

  const popovers = (
    <>
      {editPopover && (() => {
        const ann = allAnnotations.find((a) => a.id === editPopover.annId);
        if (!ann) return null;
        return (
          <AnnotationEditPopover
            anchorEl={editPopover.anchorEl}
            scrollContainer={scrollContainer}
            initialNote={ann.note}
            initialImages={ann.images}
            onUpdate={(note, images) => {
              updateAnnotation(editPopover.annId, note);
              // Sync images
              const current = ann.images || [];
              for (const img of images) {
                if (!current.includes(img)) addAnnotationImage(editPopover.annId, img);
              }
              for (const img of current) {
                if (!images.includes(img)) removeAnnotationImage(editPopover.annId, img);
              }
            }}
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
          onAdd={(note, images) => {
            const id = generateAnnotationId();
            renameMarkId(createPopover.tempId, id);
            addAnnotationRef.current(id, createPopover.snippet, note, filePathRef.current, createPopover.ctx, images);
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

  return { popovers, openCreatePopover, isPopoverOpen: !!(editPopover || createPopover) };
}
