import React, { useEffect, useState, useRef, useContext, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { SessionContext } from "#canvas/runtime";
import { useAnnotations } from "./AnnotationProvider";
import { wrapRangeWithMark, updateAllMarkStates, renameMarkId, unwrapMarks, restoreMarks } from "./highlightRange";
import { extractContext } from "./annotationContext";
import { AnnotationCreatePopover, AnnotationEditPopover } from "./Popover";
import { generateAnnotationId } from "./utils";

/** All navigable blocks (keyboard arrows) */
const BLOCK_SELECTOR = "[data-md='item'], [data-md='section'], [data-md='table'] tbody tr, [data-md='callout'], [data-md='note'], [data-md='checklist-item'], [data-md='choice-option'], [data-md='multichoice-option'], [data-md='userinput'], [data-md='rangeinput'], [data-md='image']";
/** Blocks eligible for annotation comment icons (excludes interactive controls) */
const ANNOTATABLE_SELECTOR = "[data-md='item'], [data-md='section'], [data-md='table'] tbody tr, [data-md='callout'], [data-md='note'], [data-md='checklist-item'], [data-md='image']";

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

  // Block annotation hover state
  const [hoveredBlock, setHoveredBlock] = useState<HTMLElement | null>(null);
  const [blockPopover, setBlockPopover] = useState<{ anchorEl: HTMLElement; snippet: string; annId?: string } | null>(null);

  // Keyboard navigation state
  const [focusedBlockIndex, setFocusedBlockIndex] = useState<number | null>(null);
  const [keyboardNav, setKeyboardNav] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setFocusedBlockIndex(null);
    import(`/api/session/${sessionId}/plan.js?rev=${revision}&t=${Date.now()}`)
      .then((mod) => { setPlanComponent(() => mod.default); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [sessionId, revision]);

  // Restore persisted annotation marks after plan renders
  useEffect(() => {
    if (!PlanComponent || !containerRef.current) return;
    // Small delay to ensure the plan DOM is fully rendered
    const timer = setTimeout(() => {
      if (containerRef.current) {
        restoreMarks(containerRef.current, annotations);
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [PlanComponent]);

  // Update mark active states when activeAnnotationId changes
  const prevActiveRef = useRef<string | null>(null);
  useEffect(() => {
    updateAllMarkStates(activeAnnotationId, prevActiveRef.current);
    prevActiveRef.current = activeAnnotationId;
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
  }, [PlanComponent, annotations, activeAnnotationId]);

  // Build a map of block snippets to annotation IDs for quick lookup
  const blockAnnotationMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const ann of annotations) {
      if (ann.snippet.startsWith("[")) {
        map.set(ann.snippet, ann.id);
      }
    }
    return map;
  }, [annotations]);

  // Block annotation: hover detection
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleMove = (e: MouseEvent) => {
      // Don't change hover when a popover is open
      if (blockPopover || createPopover || editPopover) return;
      const target = e.target as HTMLElement;
      // Ignore events on the block comment button itself
      if (target.closest("[data-block-comment-btn]")) return;
      setKeyboardNav(false);
      // Track keyboard nav position on any navigable block
      const navBlock = target.closest(BLOCK_SELECTOR) as HTMLElement | null;
      if (navBlock && container.contains(navBlock)) {
        const blocks = getOrderedBlocks(container);
        const idx = blocks.indexOf(navBlock);
        setFocusedBlockIndex(idx >= 0 ? idx : null);
      } else {
        setFocusedBlockIndex(null);
      }
      // Only show comment icons on annotatable blocks
      const block = target.closest(ANNOTATABLE_SELECTOR) as HTMLElement | null;
      if (block && container.contains(block)) {
        setHoveredBlock(block);
        const snippet = getBlockSnippet(block);
        const annId = snippet ? blockAnnotationMap.get(snippet) : undefined;
        if (annId && annId !== activeAnnotationId) {
          setActiveAnnotationId(annId);
        }
      } else {
        setHoveredBlock(null);
      }
    };

    const handleLeave = (e: MouseEvent) => {
      if (blockPopover || createPopover || editPopover) return;
      // Don't clear if moving onto the block comment button
      const related = e.relatedTarget as HTMLElement | null;
      if (related?.closest("[data-block-comment-btn]")) return;
      setHoveredBlock(null);
      setActiveAnnotationId(null);
    };

    container.addEventListener("mousemove", handleMove);
    container.addEventListener("mouseleave", handleLeave);
    return () => {
      container.removeEventListener("mousemove", handleMove);
      container.removeEventListener("mouseleave", handleLeave);
    };
  }, [PlanComponent, blockPopover, createPopover, editPopover, blockAnnotationMap, activeAnnotationId]);

  // Keyboard navigation: document-level key listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Guard: skip if input/textarea focused or popover open
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement).isContentEditable) return;
      if (blockPopover || createPopover || editPopover) return;

      const container = containerRef.current;
      if (!container) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setKeyboardNav(true);
        const blocks = getOrderedBlocks(container);
        if (blocks.length === 0) return;
        setFocusedBlockIndex((prev) => {
          if (prev === null) return 0;
          return Math.min(prev + 1, blocks.length - 1);
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setKeyboardNav(true);
        const blocks = getOrderedBlocks(container);
        if (blocks.length === 0) return;
        setFocusedBlockIndex((prev) => {
          if (prev === null) return blocks.length - 1;
          return Math.max(prev - 1, 0);
        });
      } else if (e.key === "a" || e.key === "A") {
        if (focusedBlockIndex === null || !container) return;
        e.preventDefault();
        const blocks = getOrderedBlocks(container);
        const block = blocks[focusedBlockIndex];
        if (!block) return;
        const snippet = getBlockSnippet(block);
        if (!snippet) return;
        const existingAnnId = blockAnnotationMap.get(snippet);
        if (existingAnnId) {
          setActiveAnnotationId(existingAnnId);
          setBlockPopover({ anchorEl: block, snippet, annId: existingAnnId });
        } else {
          setBlockPopover({ anchorEl: block, snippet });
        }
      } else if (e.key === " " || e.key === "Enter") {
        if (focusedBlockIndex === null) return;
        const blocks = getOrderedBlocks(container);
        const block = blocks[focusedBlockIndex];
        if (!block) return;
        const md = block.getAttribute("data-md");
        if (md === "choice-option" || md === "multichoice-option") {
          e.preventDefault();
          block.dispatchEvent(new CustomEvent("kb-select", { bubbles: true }));
        } else if (md === "userinput") {
          e.preventDefault();
          const textarea = block.querySelector("textarea");
          if (textarea) {
            textarea.focus();
            const exitHandler = (te: KeyboardEvent) => {
              if (te.key === "Escape") {
                te.preventDefault();
                textarea.blur();
                setKeyboardNav(true);
              }
            };
            textarea.addEventListener("keydown", exitHandler);
            textarea.addEventListener("blur", () => textarea.removeEventListener("keydown", exitHandler), { once: true });
          }
        } else if (md === "rangeinput") {
          e.preventDefault();
          const input = block.querySelector("input[type='range']") as HTMLInputElement | null;
          if (input) {
            input.focus();
            const exitHandler = (re: KeyboardEvent) => {
              if (re.key === "Escape" || re.key === "ArrowUp" || re.key === "ArrowDown") {
                re.preventDefault();
                input.blur();
                setKeyboardNav(true);
              }
            };
            input.addEventListener("keydown", exitHandler);
            input.addEventListener("blur", () => input.removeEventListener("keydown", exitHandler), { once: true });
          }
        }
      } else if (e.key === "Escape") {
        setFocusedBlockIndex(null);
        setKeyboardNav(false);
        setActiveAnnotationId(null);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [focusedBlockIndex, blockPopover, createPopover, editPopover, blockAnnotationMap]);

  // Keyboard navigation: visual focus outline + scroll into view + sidebar sync
  useEffect(() => {
    const container = containerRef.current;
    if (!container || focusedBlockIndex === null || !keyboardNav) return;
    const blocks = getOrderedBlocks(container);
    const block = blocks[focusedBlockIndex];
    if (!block) return;

    block.style.outline = "2px solid var(--color-accent-blue)";
    block.style.outlineOffset = "-2px";
    block.style.borderRadius = "8px";
    block.scrollIntoView({ block: "nearest", behavior: "smooth" });

    // Sync sidebar if block has an annotation
    const snippet = getBlockSnippet(block);
    const annId = snippet ? blockAnnotationMap.get(snippet) : undefined;
    if (annId) setActiveAnnotationId(annId);

    return () => {
      block.style.outline = "";
      block.style.outlineOffset = "";
      block.style.borderRadius = "";
    };
  }, [focusedBlockIndex, keyboardNav, blockAnnotationMap]);

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

  // Memoize so context-triggered re-renders of PlanRenderer don't re-render the plan tree.
  // This prevents remounting custom components defined inside the Plan function.
  const planElement = useMemo(() => PlanComponent ? <PlanComponent /> : null, [PlanComponent]);

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
        {planElement}
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
            const id = generateAnnotationId();
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

      {/* Block annotation floating buttons */}
      <BlockCommentButtons
        containerRef={containerRef}
        hoveredBlock={hoveredBlock}
        focusedBlockIndex={focusedBlockIndex}
        blockPopover={blockPopover}
        blockAnnotationMap={blockAnnotationMap}
        activeAnnotationId={activeAnnotationId}
        onOpen={(anchorEl, snippet, annId) => {
          if (annId) {
            setActiveAnnotationId(annId);
            setBlockPopover({ anchorEl, snippet, annId });
          } else {
            setBlockPopover({ anchorEl, snippet });
          }
        }}
      />

      {/* Block annotation popover */}
      {blockPopover && !blockPopover.annId && (
        <AnnotationCreatePopover
          anchorEl={blockPopover.anchorEl}
          scrollContainer={scrollContainer}
          snippet={blockPopover.snippet}
          truncateAt={80}
          onAdd={(note) => {
            const id = generateAnnotationId();
            addAnnotationWithId(id, blockPopover.snippet, note);
            setBlockPopover(null);
          }}
          onCancel={() => setBlockPopover(null)}
        />
      )}
      {blockPopover?.annId && (() => {
        const ann = annotations.find((a) => a.id === blockPopover.annId);
        if (!ann) return null;
        return (
          <AnnotationEditPopover
            anchorEl={blockPopover.anchorEl}
            scrollContainer={scrollContainer}
            initialNote={ann.note}
            onUpdate={(note) => updateAnnotation(blockPopover.annId!, note)}
            onDelete={() => { removeAnnotation(blockPopover.annId!); setActiveAnnotationId(null); setBlockPopover(null); }}
            onClose={() => setBlockPopover(null)}
          />
        );
      })()}
    </>
  );
}

/** Get all navigable blocks in DOM order */
function getOrderedBlocks(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll(BLOCK_SELECTOR)) as HTMLElement[];
}

/** Extract a snippet identifier for a block element */
function getBlockSnippet(block: HTMLElement): string | null {
  const md = block.getAttribute("data-md");
  if (md === "item") {
    const label = block.getAttribute("data-md-label");
    return label ? `[Item] ${label}` : null;
  }
  if (md === "section") {
    const title = block.getAttribute("data-md-title");
    return title ? `[Section] ${title}` : null;
  }
  if (md === "callout") {
    const type = block.getAttribute("data-md-type") || "info";
    const text = block.textContent?.trim().slice(0, 60) || "Callout";
    return `[Callout:${type}] ${text}`;
  }
  if (md === "note") {
    const text = block.textContent?.trim().slice(0, 60) || "Note";
    return `[Note] ${text}`;
  }
  // Table row
  if (block.tagName === "TR") {
    const cells = Array.from(block.querySelectorAll("td")).map((td) => td.textContent?.trim()).filter(Boolean);
    return cells.length ? `[Row] ${cells.join(" | ")}` : null;
  }
  if (md === "checklist-item") {
    const label = block.getAttribute("data-md-label");
    return label ? `[Checklist] ${label}` : null;
  }
  if (md === "choice-option" || md === "multichoice-option") {
    const label = block.getAttribute("data-md-label");
    return label ? `[Option] ${label}` : null;
  }
  if (md === "userinput") {
    const label = block.getAttribute("data-md-label");
    return label ? `[Input] ${label}` : null;
  }
  if (md === "rangeinput") {
    const label = block.getAttribute("data-md-label");
    return label ? `[Range] ${label}` : null;
  }
  if (md === "image") {
    const src = block.getAttribute("data-md-src");
    return src ? `[Image] ${src}` : null;
  }
  return null;
}

/** Renders comment icons: always visible on annotated blocks, on hover for others */
function BlockCommentButtons({
  containerRef,
  hoveredBlock,
  focusedBlockIndex,
  blockPopover,
  blockAnnotationMap,
  activeAnnotationId,
  onOpen,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  hoveredBlock: HTMLElement | null;
  focusedBlockIndex: number | null;
  blockPopover: { anchorEl: HTMLElement; snippet: string; annId?: string } | null;
  blockAnnotationMap: Map<string, string>;
  activeAnnotationId: string | null;
  onOpen: (anchorEl: HTMLElement, snippet: string, annId?: string) => void;
}) {
  // Find all blocks that have annotations
  const [annotatedBlocks, setAnnotatedBlocks] = useState<HTMLElement[]>([]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || blockAnnotationMap.size === 0) { setAnnotatedBlocks([]); return; }
    const blocks: HTMLElement[] = [];
    for (const el of container.querySelectorAll(ANNOTATABLE_SELECTOR)) {
      const snippet = getBlockSnippet(el as HTMLElement);
      if (snippet && blockAnnotationMap.has(snippet)) {
        blocks.push(el as HTMLElement);
      }
    }
    setAnnotatedBlocks(blocks);
  }, [blockAnnotationMap, containerRef.current]);

  // Also highlight block when its annotation is active from sidebar hover
  const [activeBlock, setActiveBlock] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!activeAnnotationId || !containerRef.current) { setActiveBlock(null); return; }
    // Find block matching active annotation
    for (const el of containerRef.current.querySelectorAll(BLOCK_SELECTOR)) {
      const snippet = getBlockSnippet(el as HTMLElement);
      if (snippet && blockAnnotationMap.get(snippet) === activeAnnotationId) {
        setActiveBlock(el as HTMLElement);
        return;
      }
    }
    setActiveBlock(null);
  }, [activeAnnotationId, blockAnnotationMap]);

  // Apply highlight style to active block
  useEffect(() => {
    if (!activeBlock) return;
    activeBlock.style.boxShadow = "inset 0 0 0 1.5px var(--color-highlight-bg)";
    activeBlock.style.borderRadius = "8px";
    return () => {
      activeBlock.style.boxShadow = "";
      activeBlock.style.borderRadius = "";
    };
  }, [activeBlock]);

  // Resolve keyboard-focused block element (only annotatable blocks get comment icons)
  const focusedBlock = useMemo(() => {
    if (focusedBlockIndex === null || !containerRef.current) return null;
    const block = getOrderedBlocks(containerRef.current)[focusedBlockIndex];
    if (!block) return null;
    // Only show comment icon on annotatable blocks, not interactive controls
    return block.matches(ANNOTATABLE_SELECTOR) ? block : null;
  }, [focusedBlockIndex, containerRef.current]);

  // Collect all blocks that need a button: annotated + hovered + focused + popover target
  const targets = useMemo(() => {
    const set = new Set<HTMLElement>(annotatedBlocks);
    if (hoveredBlock) set.add(hoveredBlock);
    if (focusedBlock) set.add(focusedBlock);
    if (blockPopover?.anchorEl) set.add(blockPopover.anchorEl);
    return Array.from(set);
  }, [annotatedBlocks, hoveredBlock, focusedBlock, blockPopover]);

  return (
    <>
      {targets.map((block) => (
        <BlockCommentIcon
          key={block.getAttribute("data-task-id") || block.getAttribute("data-md-title") || block.textContent?.slice(0, 30) || "block"}
          block={block}
          isHovered={block === hoveredBlock || block === focusedBlock || block === blockPopover?.anchorEl}
          blockAnnotationMap={blockAnnotationMap}
          activeAnnotationId={activeAnnotationId}
          onOpen={onOpen}
        />
      ))}
    </>
  );
}

function BlockCommentIcon({
  block,
  isHovered,
  blockAnnotationMap,
  activeAnnotationId,
  onOpen,
}: {
  block: HTMLElement;
  isHovered: boolean;
  blockAnnotationMap: Map<string, string>;
  activeAnnotationId: string | null;
  onOpen: (anchorEl: HTMLElement, snippet: string, annId?: string) => void;
}) {
  const snippet = getBlockSnippet(block);
  if (!snippet) return null;

  const existingAnnId = blockAnnotationMap.get(snippet);
  const hasAnnotation = !!existingAnnId;
  const isActive = existingAnnId === activeAnnotationId;

  return createPortal(
    <button
      data-block-comment-btn
      onClick={(e) => {
        e.stopPropagation();
        onOpen(e.currentTarget as HTMLElement, snippet, existingAnnId);
      }}
      className={`absolute top-1 right-1 z-10 w-6 h-6 flex items-center justify-center rounded transition-all duration-150 ${
        hasAnnotation
          ? isActive
            ? "text-accent-amber bg-accent-amber-muted"
            : "text-accent-amber opacity-60 hover:opacity-100"
          : isHovered
            ? "text-text-disabled hover:text-text-tertiary opacity-50 hover:opacity-100"
            : "text-text-disabled opacity-0 group-hover/section:opacity-20 hover:!opacity-80"
      }`}
      title={hasAnnotation ? "Edit annotation" : "Add annotation"}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill={hasAnnotation ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    </button>,
    block,
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

