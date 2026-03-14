import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { getPopoverPosition } from "./popoverPosition";

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
  const { style: posStyle, parent } = getPopoverPosition(anchorEl, scrollContainer);

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

/* ── Create annotation popover ─────────────────────────────── */

interface AnnotationCreatePopoverProps {
  anchorEl: HTMLElement;
  scrollContainer?: HTMLElement | null;
  snippet: string;
  /** Max length for displayed snippet (default 100) */
  truncateAt?: number;
  /** Custom header instead of the default quoted snippet */
  header?: React.ReactNode;
  onAdd: (note: string) => void;
  onCancel: () => void;
}

const SUGGESTION_GROUPS: { label: string; items: string[] }[] = [
  { label: "Clarity", items: ["Unclear", "Why?", "Needs example", "Missing context"] },
  { label: "Scope", items: ["Overkill", "Out of scope", "Important", "Risky"] },
  { label: "Action", items: ["Simplify", "Rethink", "Expand on this", "Skip this"] },
];
const ALL_SUGGESTIONS = SUGGESTION_GROUPS.flatMap((g) => g.items);

export function AnnotationCreatePopover({ anchorEl, scrollContainer, snippet, truncateAt = 100, header, onAdd, onCancel }: AnnotationCreatePopoverProps) {
  const [note, setNote] = useState("");
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [suppressed, setSuppressed] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { textareaRef.current?.focus(); }, []);

  const submit = useCallback(() => {
    if (note.trim()) onAdd(note.trim());
    else onCancel();
  }, [note, onAdd, onCancel]);

  const matches = note.trim().length > 0
    ? ALL_SUGGESTIONS.filter((s) => s.toLowerCase().startsWith(note.trim().toLowerCase()))
    : ALL_SUGGESTIONS;
  // Don't show if the input already exactly matches a suggestion, or if suppressed
  const filtered = suppressed ? [] : matches.length === 1 && matches[0].toLowerCase() === note.trim().toLowerCase() ? [] : matches;
  const matchSet = new Set(filtered);

  // Build filtered groups for grouped display
  const filteredGroups = SUGGESTION_GROUPS
    .map((g) => ({ label: g.label, items: g.items.filter((s) => matchSet.has(s)) }))
    .filter((g) => g.items.length > 0);

  // Each group = one column
  const colItems = filteredGroups.map((g) => g.items);
  const flatFiltered = colItems.flat();

  // Navigation state as [col, row]
  const selectedCol = useMemo(() => {
    if (selectedIdx === null) return 0;
    let count = 0;
    for (let c = 0; c < colItems.length; c++) {
      if (selectedIdx < count + colItems[c].length) return c;
      count += colItems[c].length;
    }
    return 0;
  }, [selectedIdx, colItems]);
  const selectedRow = useMemo(() => {
    if (selectedIdx === null) return 0;
    let count = 0;
    for (let c = 0; c < selectedCol; c++) count += colItems[c].length;
    return selectedIdx - count;
  }, [selectedIdx, selectedCol, colItems]);

  const colRowToFlat = (col: number, row: number) => {
    let idx = 0;
    for (let c = 0; c < col; c++) idx += colItems[c].length;
    return idx + row;
  };

  // Reset selection and unsuppress when input changes
  useEffect(() => { setSelectedIdx(null); setSuppressed(false); }, [note]);

  const applySuggestion = useCallback((s: string) => {
    setNote(s);
  }, []);

  const truncated = snippet.length > truncateAt ? snippet.slice(0, truncateAt) + "..." : snippet;

  return (
    <Popover anchorEl={anchorEl} scrollContainer={scrollContainer} onClose={onCancel} width="420px">
      {header ?? (
        <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", fontStyle: "italic", marginBottom: "8px", lineHeight: "1.4", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          &ldquo;{truncated}&rdquo;
        </div>
      )}
      <textarea
        ref={textareaRef}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (flatFiltered.length > 0 && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "ArrowLeft" || e.key === "ArrowRight")) {
            e.preventDefault();
            if (selectedIdx === null) {
              setSelectedIdx(0);
              return;
            }
            if (e.key === "ArrowDown") {
              const newRow = Math.min(selectedRow + 1, colItems[selectedCol].length - 1);
              setSelectedIdx(colRowToFlat(selectedCol, newRow));
            } else if (e.key === "ArrowUp") {
              const newRow = Math.max(selectedRow - 1, 0);
              setSelectedIdx(colRowToFlat(selectedCol, newRow));
            } else if (e.key === "ArrowRight") {
              const newCol = Math.min(selectedCol + 1, colItems.length - 1);
              const newRow = Math.min(selectedRow, colItems[newCol].length - 1);
              setSelectedIdx(colRowToFlat(newCol, newRow));
            } else if (e.key === "ArrowLeft") {
              const newCol = Math.max(selectedCol - 1, 0);
              const newRow = Math.min(selectedRow, colItems[newCol].length - 1);
              setSelectedIdx(colRowToFlat(newCol, newRow));
            }
            return;
          }
          if (selectedIdx !== null && flatFiltered.length > 0) {
            if (e.key === "Tab") { e.preventDefault(); applySuggestion(flatFiltered[selectedIdx]); return; }
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onAdd(flatFiltered[selectedIdx]); return; }
          }
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); return; }
          if (e.key === "Escape") { if (flatFiltered.length > 0 && !suppressed) { setSuppressed(true); } else { onCancel(); } }
        }}
        style={{ width: "100%", minHeight: "60px", background: "transparent", border: "none", color: "var(--color-text-primary)", fontFamily: "'Inter', sans-serif", fontSize: "13px", lineHeight: "1.5", resize: "vertical", outline: "none" }}
        placeholder="Add your note..."
      />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "8px" }}>
        <button onClick={onCancel} style={{ fontSize: "11px", color: "var(--color-text-tertiary)", background: "none", border: "none", cursor: "pointer", padding: "4px 12px", fontFamily: "'Inter', sans-serif" }}>Cancel</button>
        <button onClick={submit} style={{ fontSize: "11px", fontWeight: 500, padding: "4px 12px", borderRadius: "6px", background: "var(--color-highlight-bg)", color: "var(--color-text-primary)", border: "1px solid var(--color-highlight-border)", cursor: "pointer", fontFamily: "'Inter', sans-serif" }}>Add</button>
      </div>
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
                    onMouseDown={(e) => { e.preventDefault(); applySuggestion(s); }}
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

/* ── Edit annotation popover ───────────────────────────────── */

interface AnnotationEditPopoverProps {
  anchorEl: HTMLElement;
  scrollContainer?: HTMLElement | null;
  initialNote: string;
  onUpdate: (note: string) => void;
  onDelete: () => void;
  onClose: () => void;
}

export function AnnotationEditPopover({ anchorEl, scrollContainer, initialNote, onUpdate, onDelete, onClose }: AnnotationEditPopoverProps) {
  const [note, setNote] = useState(initialNote);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [deleteHover, setDeleteHover] = useState(false);

  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = ta.scrollHeight + "px";
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
  }, []);

  const handleClose = useCallback(() => {
    if (!note.trim()) { onDelete(); onClose(); return; }
    onUpdate(note);
    onClose();
  }, [note, onUpdate, onDelete, onClose]);

  return (
    <Popover anchorEl={anchorEl} scrollContainer={scrollContainer} onClose={handleClose} ignoreSelector="[data-annotation-id]" zIndex="60" padding="10px 12px">
      <textarea
        ref={textareaRef}
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
          onUpdate(e.target.value);
          e.target.style.height = "auto";
          e.target.style.height = e.target.scrollHeight + "px";
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleClose(); }
          if (e.key === "Escape") handleClose();
        }}
        style={{ width: "100%", background: "transparent", border: "none", color: "var(--color-text-primary)", fontFamily: "'Inter', sans-serif", fontSize: "13px", lineHeight: "1.5", resize: "none", outline: "none", overflow: "hidden" }}
      />
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "6px" }}>
        <button
          onClick={() => { onDelete(); onClose(); }}
          onMouseEnter={() => setDeleteHover(true)}
          onMouseLeave={() => setDeleteHover(false)}
          style={{ fontSize: "11px", color: deleteHover ? "var(--color-accent-red)" : "var(--color-text-tertiary)", background: "none", border: "none", cursor: "pointer", padding: "2px 0", fontFamily: "'Inter', sans-serif" }}
        >Delete</button>
      </div>
    </Popover>
  );
}
