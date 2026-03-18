import React, { useState, useRef, useCallback, useEffect } from "react";
import { autoResizeTextarea } from "./utils";

interface AnnotationEditorProps {
  note: string;
  onNoteChange: (note: string) => void;
  images: string[];
  onAddImage: (path: string) => void;
  onRemoveImage: (path: string) => void;
  sessionId: string;

  placeholder?: string;
  autoFocus?: boolean;
  autoResize?: boolean;
  readOnly?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onTextareaClick?: (e: React.MouseEvent) => void;
  textareaRef?: React.MutableRefObject<HTMLTextAreaElement | null>;
  textareaClassName?: string;
  textareaStyle?: React.CSSProperties;
  minHeight?: number;
  /** "always" (default), "on-focus" (sidebar), or "none" (popover — use openFilePickerRef) */
  attachButton?: "always" | "on-focus" | "none";
  /** Parent can store the open-file-picker function for external trigger */
  openFilePickerRef?: React.MutableRefObject<(() => void) | null>;
}

export function imageToUrl(path: string): string {
  const filename = path.split("/").pop();
  return `/api/uploads/${filename}`;
}

async function uploadImage(sessionId: string, file: File): Promise<string | null> {
  const formData = new FormData();
  formData.append("image", file);
  try {
    const resp = await fetch(`/api/session/${sessionId}/upload`, { method: "POST", body: formData });
    const data = await resp.json();
    return data.path || null;
  } catch {
    return null;
  }
}

export function AnnotationEditor({
  note, onNoteChange, images, onAddImage, onRemoveImage, sessionId,
  placeholder = "Add your note...", autoFocus = false, autoResize = false,
  readOnly = false, onKeyDown, onTextareaClick, textareaRef: externalRef,
  textareaClassName, textareaStyle, minHeight,
  attachButton = "always", openFilePickerRef,
}: AnnotationEditorProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const dragCounter = useRef(0);
  const internalRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const openFilePicker = useCallback(() => fileInputRef.current?.click(), []);

  // Expose file picker to parent
  if (openFilePickerRef) openFilePickerRef.current = openFilePicker;

  const setRef = useCallback((el: HTMLTextAreaElement | null) => {
    internalRef.current = el;
    if (externalRef) externalRef.current = el;
    if (el && autoResize) autoResizeTextarea(el, minHeight);
  }, [externalRef, autoResize, minHeight]);

  useEffect(() => {
    if (autoFocus && internalRef.current) {
      const ta = internalRef.current;
      ta.focus();
      if (ta.value) ta.setSelectionRange(ta.value.length, ta.value.length);
    }
  }, [autoFocus]);

  const doUpload = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    setIsUploading(true);
    try {
      const path = await uploadImage(sessionId, file);
      if (path) onAddImage(path);
    } finally {
      setIsUploading(false);
    }
  }, [sessionId, onAddImage]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) doUpload(file);
        return;
      }
    }
  }, [doUpload]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    if (dragCounter.current === 1) setIsDragging(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragging(false);
    for (const file of e.dataTransfer.files) {
      if (file.type.startsWith("image/")) doUpload(file);
    }
  }, [doUpload]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onNoteChange(e.target.value);
    if (autoResize) {
      e.target.style.height = "auto";
      e.target.style.height = (minHeight ? Math.max(minHeight, e.target.scrollHeight) : e.target.scrollHeight) + "px";
    }
  }, [onNoteChange, autoResize, minHeight]);

  const defaultClassName = "w-full bg-transparent text-[13px] font-body text-text-primary resize-none focus:outline-none leading-relaxed p-0 border-none";
  const defaultStyle: React.CSSProperties = {
    width: "100%", background: "transparent", border: "none",
    color: "var(--color-text-primary)", fontFamily: "'Inter', sans-serif",
    fontSize: "13px", lineHeight: "1.5", outline: "none",
    ...(autoResize ? { resize: "none" as const, overflow: "hidden" } : { resize: "vertical" as const }),
  };

  const showButton = !readOnly && (
    attachButton === "always" ||
    (attachButton === "on-focus" && isFocused)
  );

  return (
    <div
      style={{ position: "relative" }}
      onDragEnter={readOnly ? undefined : handleDragEnter}
      onDragOver={readOnly ? undefined : handleDragOver}
      onDragLeave={readOnly ? undefined : handleDragLeave}
      onDrop={readOnly ? undefined : handleDrop}
    >
      <textarea
        ref={setRef}
        value={note}
        onChange={readOnly ? undefined : handleChange}
        onPaste={readOnly ? undefined : handlePaste}
        onKeyDown={onKeyDown}
        onClick={onTextareaClick}
        onFocus={() => setIsFocused(true)}
        onBlur={() => {
          // Delay so click on attach button registers before hiding
          setTimeout(() => setIsFocused(false), 150);
        }}
        readOnly={readOnly}
        placeholder={placeholder}
        className={textareaClassName ?? defaultClassName}
        style={textareaStyle ?? defaultStyle}
        rows={autoResize ? 1 : undefined}
      />

      {/* Hidden file input — always rendered for paste/drop + external trigger */}
      {!readOnly && (
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            const files = e.target.files;
            if (files) for (const f of files) doUpload(f);
            e.target.value = "";
          }}
        />
      )}

      {/* Image thumbnails + inline attach button */}
      {(images.length > 0 || showButton) && (
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "6px", alignItems: "center" }}>
          {images.map((img) => (
            <div
              key={img}
              style={{
                position: "relative", width: "56px", height: "56px",
                borderRadius: "6px", overflow: "hidden",
                border: "1px solid var(--color-border-subtle)",
                flexShrink: 0,
              }}
            >
              <img
                src={imageToUrl(img)}
                alt=""
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              />
              {!readOnly && (
                <button
                  onClick={(e) => { e.stopPropagation(); onRemoveImage(img); }}
                  style={{
                    position: "absolute", top: "2px", right: "2px",
                    width: "16px", height: "16px", borderRadius: "50%",
                    background: "rgba(0,0,0,0.6)", color: "white",
                    border: "none", cursor: "pointer", fontSize: "11px",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    lineHeight: 1, padding: 0,
                  }}
                  title="Remove image"
                >
                  &times;
                </button>
              )}
            </div>
          ))}
          {showButton && <AttachButton onClick={openFilePicker} />}
        </div>
      )}

      {isUploading && (
        <div style={{
          fontSize: "11px", color: "var(--color-text-tertiary)",
          fontFamily: "'Inter', sans-serif", marginTop: "4px",
        }}>
          Uploading...
        </div>
      )}

      {isDragging && (
        <div style={{
          position: "absolute", inset: 0, display: "flex",
          alignItems: "center", justifyContent: "center",
          background: "var(--color-highlight-bg)", opacity: 0.9,
          border: "2px dashed var(--color-highlight-border)",
          borderRadius: "6px", zIndex: 10, pointerEvents: "none",
          fontSize: "12px", fontFamily: "'Inter', sans-serif",
          color: "var(--color-text-secondary)",
        }}>
          Drop image
        </div>
      )}
    </div>
  );
}

/** Small attach-image button — reusable in editor and popover button bar */
export function AttachButton({ onClick, size = 16 }: { onClick: () => void; size?: number }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{
        width: `${size * 2}px`, height: `${size * 2}px`, borderRadius: "6px",
        border: "none",
        background: "transparent", cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "var(--color-text-tertiary)", flexShrink: 0,
        transition: "color 0.15s",
      }}
      title="Attach image"
      onMouseEnter={(e) => { e.currentTarget.style.color = "var(--color-text-secondary)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = "var(--color-text-tertiary)"; }}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <polyline points="21 15 16 10 5 21" />
      </svg>
    </button>
  );
}

/** Read-only image thumbnails for display in read-only annotations */
export function ImageThumbnails({ images }: { images: string[] }) {
  if (!images.length) return null;
  return (
    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "6px" }}>
      {images.map((img) => (
        <div
          key={img}
          style={{
            width: "56px", height: "56px", borderRadius: "6px",
            overflow: "hidden", border: "1px solid var(--color-border-subtle)",
            flexShrink: 0,
          }}
        >
          <img
            src={imageToUrl(img)}
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        </div>
      ))}
    </div>
  );
}
