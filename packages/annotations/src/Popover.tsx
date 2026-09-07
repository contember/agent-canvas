import React, { useEffect, useRef, useState, useCallback, useMemo, useContext } from "react";
import { createPortal } from "react-dom";
import { getPopoverPosition, pxWidth } from "./popoverPosition";
import { AnnotationEditor, AttachButton } from "./AnnotationEditor";
import { SessionContext, useAnnotationHost } from "@fabrika/annotations/runtime";
import { hostAcceptsUploads } from "./utils";

interface PopoverProps {
  anchorEl: HTMLElement;
  scrollContainer?: HTMLElement | null;
  onClose: () => void;
  /** Selectors that should not trigger outside-click close */
  ignoreSelector?: string;
  zIndex?: string;
  padding?: string;
  width?: string;
  children: React.ReactNode;
}

export function Popover({ anchorEl, scrollContainer, onClose, ignoreSelector, zIndex = "50", padding = "12px", width = "280px", children }: PopoverProps) {
  const popRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Placed by the width it is about to be rendered at, or it overflows the edge
  // it was supposed to be clamped away from.
  const { style: posStyle, parent } = getPopoverPosition(anchorEl, scrollContainer, pxWidth(width));

  useEffect(() => {
    const timer = setTimeout(() => {
      const handler = (e: MouseEvent) => {
        if (popRef.current && !popRef.current.contains(e.target as Node)) {
          if (ignoreSelector && (e.target as HTMLElement).closest?.(ignoreSelector)) return;
          onCloseRef.current();
          document.removeEventListener("mousedown", handler);
        }
      };
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }, 0);
    return () => clearTimeout(timer);
  }, [ignoreSelector]);

  return createPortal(
    <div
      ref={popRef}
      style={{
        ...posStyle,
        zIndex,
        width,
        background: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border-hover)",
        borderRadius: "8px",
        boxShadow: "0 4px 12px var(--color-shadow)",
        padding,
        fontFamily: "'Inter', sans-serif",
      }}
    >
      {children}
    </div>,
    parent,
  );
}

/* ── Create/Edit annotation popover ────────────────────────── */

interface AnnotationPopoverProps {
  anchorEl: HTMLElement;
  scrollContainer?: HTMLElement | null;
  snippet: string;
  /** Max length for displayed snippet (default 100) */
  truncateAt?: number;
  /** Custom header instead of the default quoted snippet */
  header?: React.ReactNode;
  /** Initial note text (for edit mode) */
  initialNote?: string;
  /** Initial images (for edit mode) */
  initialImages?: string[];
  /** Called on confirm — passes note and images */
  onConfirm: (note: string, images: string[]) => void;
  /** Called on cancel / close without saving */
  onCancel: () => void;
  /** Called when annotation should be deleted (edit mode) */
  onDelete?: () => void;
}

const SUGGESTION_GROUPS: { label: string; items: string[] }[] = [
  { label: "Clarity", items: ["Unclear", "Why?", "Needs example", "Missing context"] },
  { label: "Scope", items: ["Overkill", "Out of scope", "Important", "Risky"] },
  { label: "Action", items: ["Simplify", "Rethink", "Expand on this", "Skip this"] },
];
const ALL_SUGGESTIONS = SUGGESTION_GROUPS.flatMap((g) => g.items);

export function AnnotationPopover({
  anchorEl, scrollContainer, snippet, truncateAt = 100, header,
  initialNote = "", initialImages, onConfirm, onCancel, onDelete,
}: AnnotationPopoverProps) {
  const sessionId = useContext(SessionContext);
  // The footer draws the editor's attach button itself, so it owes the same
  // check the editor makes: no upload endpoint, no button.
  const host = useAnnotationHost();
  const canAttach = hostAcceptsUploads(host);
  const isEditMode = initialNote !== "" || !!onDelete;
  const [note, setNote] = useState(initialNote);
  const [images, setImages] = useState<string[]>(initialImages || []);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [suppressed, setSuppressed] = useState(isEditMode);
  const [deleteHover, setDeleteHover] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const openFilePickerRef = useRef<(() => void) | null>(null);

  const submit = useCallback(() => {
    if (note.trim() || images.length > 0) onConfirm(note.trim(), images);
    else if (isEditMode && onDelete) onDelete();
    else onCancel();
  }, [note, images, onConfirm, onCancel, isEditMode, onDelete]);

  const handleClose = useCallback(() => {
    if (isEditMode) {
      if (!note.trim() && images.length === 0 && onDelete) { onDelete(); onCancel(); return; }
      onConfirm(note, images);
      return;
    }
    onCancel();
  }, [note, images, isEditMode, onConfirm, onCancel, onDelete]);

  // Suggestions (only in create mode)
  const showSuggestions = !isEditMode;
  const matches = note.trim().length > 0
    ? ALL_SUGGESTIONS.filter((s) => s.toLowerCase().startsWith(note.trim().toLowerCase()))
    : ALL_SUGGESTIONS;
  const filtered = !showSuggestions || suppressed ? [] : matches.length === 1 && matches[0]?.toLowerCase() === note.trim().toLowerCase() ? [] : matches;
  const matchSet = new Set(filtered);

  const filteredGroups = SUGGESTION_GROUPS
    .map((g) => ({ label: g.label, items: g.items.filter((s) => matchSet.has(s)) }))
    .filter((g) => g.items.length > 0);

  const colItems = filteredGroups.map((g) => g.items);
  /** All the arrow-key math indexes columns; out of range simply means empty. */
  const colLength = (c: number) => colItems[c]?.length ?? 0;
  const flatFiltered = colItems.flat();

  const selectedCol = useMemo(() => {
    if (selectedIdx === null) return 0;
    let count = 0;
    for (let c = 0; c < colItems.length; c++) {
      if (selectedIdx < count + colLength(c)) return c;
      count += colLength(c);
    }
    return 0;
  }, [selectedIdx, colItems]);
  const selectedRow = useMemo(() => {
    if (selectedIdx === null) return 0;
    let count = 0;
    for (let c = 0; c < selectedCol; c++) count += colLength(c);
    return selectedIdx - count;
  }, [selectedIdx, selectedCol, colItems]);

  const colRowToFlat = (col: number, row: number) => {
    let idx = 0;
    for (let c = 0; c < col; c++) idx += colLength(c);
    return idx + row;
  };

  const [prevNote, setPrevNote] = useState(note);
  if (note !== prevNote) {
    setPrevNote(note);
    setSelectedIdx(null);
    setSuppressed(isEditMode);
  }

  const applySuggestion = useCallback((s: string) => {
    setNote(s);
  }, []);

  const truncated = snippet.length > truncateAt ? snippet.slice(0, truncateAt) + "..." : snippet;

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (flatFiltered.length > 0 && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      if (selectedIdx === null) { setSelectedIdx(0); return; }
      if (e.key === "ArrowDown") {
        const newRow = Math.min(selectedRow + 1, colLength(selectedCol) - 1);
        setSelectedIdx(colRowToFlat(selectedCol, newRow));
      } else if (e.key === "ArrowUp") {
        const newRow = Math.max(selectedRow - 1, 0);
        setSelectedIdx(colRowToFlat(selectedCol, newRow));
      } else if (e.key === "ArrowRight") {
        const newCol = Math.min(selectedCol + 1, colItems.length - 1);
        const newRow = Math.min(selectedRow, colLength(newCol) - 1);
        setSelectedIdx(colRowToFlat(newCol, newRow));
      } else if (e.key === "ArrowLeft") {
        const newCol = Math.max(selectedCol - 1, 0);
        const newRow = Math.min(selectedRow, colLength(newCol) - 1);
        setSelectedIdx(colRowToFlat(newCol, newRow));
      }
      return;
    }
    const selected = selectedIdx === null ? undefined : flatFiltered[selectedIdx];
    if (selected !== undefined) {
      if (e.key === "Tab") { e.preventDefault(); applySuggestion(selected); return; }
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onConfirm(selected, images); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); return; }
    if (e.key === "Escape") {
      if (flatFiltered.length > 0 && !suppressed) { setSuppressed(true); }
      else if (isEditMode) { handleClose(); }
      else { onCancel(); }
    }
  }, [flatFiltered, selectedIdx, selectedRow, selectedCol, colItems, colRowToFlat, applySuggestion, onConfirm, images, submit, suppressed, isEditMode, handleClose, onCancel]);

  return (
    <Popover
      anchorEl={anchorEl}
      scrollContainer={scrollContainer}
      onClose={isEditMode ? handleClose : onCancel}
      ignoreSelector={isEditMode ? "[data-annotation-id]" : undefined}
      zIndex={isEditMode ? "60" : "50"}
      padding={isEditMode ? "10px 12px" : "12px"}
      width="420px"
    >
      {!isEditMode && (header ?? (
        <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", fontStyle: "italic", marginBottom: "8px", lineHeight: "1.4", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          &ldquo;{truncated}&rdquo;
        </div>
      ))}

      <AnnotationEditor
        note={note}
        onNoteChange={setNote}
        images={images}
        onAddImage={(path) => setImages((prev) => [...prev, path])}
        onRemoveImage={(path) => setImages((prev) => prev.filter((p) => p !== path))}
        sessionId={sessionId}
        autoFocus
        autoResize={isEditMode}
        textareaRef={textareaRef}
        onKeyDown={handleKeyDown}
        attachButton="none"
        openFilePickerRef={openFilePickerRef}
        textareaStyle={isEditMode ? {
          width: "100%", background: "transparent", border: "none",
          color: "var(--color-text-primary)", fontFamily: "'Inter', sans-serif",
          fontSize: "13px", lineHeight: "1.5", resize: "none", outline: "none",
          overflow: "hidden",
        } : {
          width: "100%", minHeight: "60px", background: "transparent", border: "none",
          color: "var(--color-text-primary)", fontFamily: "'Inter', sans-serif",
          fontSize: "13px", lineHeight: "1.5", resize: "vertical", outline: "none",
        }}
        placeholder="Add your note..."
      />

      {/* Action buttons */}
      {/* Action buttons */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: isEditMode ? "6px" : "8px" }}>
        {canAttach && <AttachButton onClick={() => openFilePickerRef.current?.()} size={14} />}
        <div style={{ flex: 1 }} />
        {isEditMode ? (
          <button
            onClick={() => { if (onDelete) onDelete(); onCancel(); }}
            onMouseEnter={() => setDeleteHover(true)}
            onMouseLeave={() => setDeleteHover(false)}
            style={{ fontSize: "11px", color: deleteHover ? "var(--color-accent-red)" : "var(--color-text-tertiary)", background: "none", border: "none", cursor: "pointer", padding: "2px 0", fontFamily: "'Inter', sans-serif" }}
          >Delete</button>
        ) : (
          <>
            <button onClick={onCancel} style={{ fontSize: "11px", color: "var(--color-text-tertiary)", background: "none", border: "none", cursor: "pointer", padding: "4px 12px", fontFamily: "'Inter', sans-serif" }}>Cancel</button>
            <button onClick={submit} style={{ fontSize: "11px", fontWeight: 500, padding: "4px 12px", borderRadius: "6px", background: "var(--color-highlight-bg)", color: "var(--color-text-primary)", border: "1px solid var(--color-highlight-border)", cursor: "pointer", fontFamily: "'Inter', sans-serif" }}>Add</button>
          </>
        )}
      </div>

      {/* Suggestions (create mode only) */}
      {flatFiltered.length > 0 && (
        <div style={{ marginTop: "6px", borderTop: "1px solid var(--color-border-subtle)", paddingTop: "8px", display: "flex", gap: "4px" }}>
          {filteredGroups.map((group) => (
            <div key={group.label} style={{ flex: 1 }}>
              <div style={{ fontSize: "10px", fontWeight: 600, color: "var(--color-text-disabled)", textTransform: "uppercase", letterSpacing: "0.05em", padding: "2px 6px", marginBottom: "2px", fontFamily: "'Inter', sans-serif" }}>
                {group.label}
              </div>
              {group.items.map((s) => {
                const flatIdx = flatFiltered.indexOf(s);
                return (
                  <div
                    key={s}
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); applySuggestion(s); }}
                    onMouseEnter={() => setSelectedIdx(flatIdx)}
                    style={{
                      padding: "3px 6px",
                      fontSize: "12px",
                      borderRadius: "4px",
                      fontFamily: "'Inter', sans-serif",
                      color: flatIdx === selectedIdx ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                      background: flatIdx === selectedIdx ? "var(--color-highlight-selected)" : "transparent",
                      cursor: "pointer",
                    }}
                  >
                    <span style={{ fontWeight: 500 }}>{s.slice(0, note.trim().length)}</span>{s.slice(note.trim().length)}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </Popover>
  );
}

/* ── Legacy exports for backwards compatibility ───────────── */

interface AnnotationCreatePopoverProps {
  anchorEl: HTMLElement;
  scrollContainer?: HTMLElement | null;
  snippet: string;
  truncateAt?: number;
  header?: React.ReactNode;
  onAdd: (note: string, images?: string[]) => void;
  onCancel: () => void;
}

export function AnnotationCreatePopover({ anchorEl, scrollContainer, snippet, truncateAt, header, onAdd, onCancel }: AnnotationCreatePopoverProps) {
  return (
    <AnnotationPopover
      anchorEl={anchorEl}
      scrollContainer={scrollContainer}
      snippet={snippet}
      truncateAt={truncateAt}
      header={header}
      onConfirm={(note, images) => onAdd(note, images)}
      onCancel={onCancel}
    />
  );
}

interface AnnotationEditPopoverProps {
  anchorEl: HTMLElement;
  scrollContainer?: HTMLElement | null;
  initialNote: string;
  initialImages?: string[];
  onUpdate: (note: string, images: string[]) => void;
  onDelete: () => void;
  onClose: () => void;
}

export function AnnotationEditPopover({ anchorEl, scrollContainer, initialNote, initialImages, onUpdate, onDelete, onClose }: AnnotationEditPopoverProps) {
  return (
    <AnnotationPopover
      anchorEl={anchorEl}
      scrollContainer={scrollContainer}
      snippet=""
      initialNote={initialNote}
      initialImages={initialImages}
      onConfirm={(note, images) => { onUpdate(note, images); onClose(); }}
      onDelete={onDelete}
      onCancel={onClose}
    />
  );
}
