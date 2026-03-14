import React, { useEffect, useRef, useState, useCallback } from "react";
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
  children: React.ReactNode;
}

export function Popover({ anchorEl, scrollContainer, onClose, ignoreSelector, zIndex = "50", padding = "12px", children }: PopoverProps) {
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
        width: "280px",
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

export function AnnotationCreatePopover({ anchorEl, scrollContainer, snippet, truncateAt = 100, header, onAdd, onCancel }: AnnotationCreatePopoverProps) {
  const [note, setNote] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { textareaRef.current?.focus(); }, []);

  const submit = useCallback(() => {
    if (note.trim()) onAdd(note.trim());
    else onCancel();
  }, [note, onAdd, onCancel]);

  const truncated = snippet.length > truncateAt ? snippet.slice(0, truncateAt) + "..." : snippet;

  return (
    <Popover anchorEl={anchorEl} scrollContainer={scrollContainer} onClose={onCancel}>
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
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
          if (e.key === "Escape") onCancel();
        }}
        style={{ width: "100%", minHeight: "60px", background: "transparent", border: "none", color: "var(--color-text-primary)", fontFamily: "'Inter', sans-serif", fontSize: "13px", lineHeight: "1.5", resize: "vertical", outline: "none" }}
        placeholder="Add your note..."
      />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "8px" }}>
        <button onClick={onCancel} style={{ fontSize: "11px", color: "var(--color-text-tertiary)", background: "none", border: "none", cursor: "pointer", padding: "4px 12px", fontFamily: "'Inter', sans-serif" }}>Cancel</button>
        <button onClick={submit} style={{ fontSize: "11px", fontWeight: 500, padding: "4px 12px", borderRadius: "6px", background: "var(--color-highlight-bg)", color: "var(--color-text-primary)", border: "1px solid var(--color-highlight-border)", cursor: "pointer", fontFamily: "'Inter', sans-serif" }}>Add</button>
      </div>
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
    onUpdate(note);
    onClose();
  }, [note, onUpdate, onClose]);

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
