import React, { useEffect, useState, useContext, useCallback, useRef, useMemo } from "react";
import { SessionContext } from "#canvas/runtime";
import { useAnnotations } from "./AnnotationProvider";
import { wrapRangeWithMark, updateAllMarkStates, renameMarkId, unwrapMarks, restoreMarks } from "./highlightRange";
import { AnnotationCreatePopover, AnnotationEditPopover } from "./Popover";
import { LANG_MAP } from "../langMap";

interface FileViewerProps {
  path: string;
}

export function FileViewer({ path }: FileViewerProps) {
  const sessionId = useContext(SessionContext);
  const { annotations, addAnnotationWithId, removeAnnotation, updateAnnotation, activeAnnotationId, setActiveAnnotationId } = useAnnotations();
  const [content, setContent] = useState<string | null>(null);
  const [language, setLanguage] = useState("text");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const contentRef = useRef<HTMLPreElement>(null);

  const [pendingMarkId, setPendingMarkId] = useState<string | null>(null);
  const pendingSnippetRef = useRef("");

  // Popover state
  const [editPopover, setEditPopover] = useState<{ anchorEl: HTMLElement; annId: string } | null>(null);
  const [createPopover, setCreatePopover] = useState<{ anchorEl: HTMLElement; tempId: string; snippet: string } | null>(null);

  const fileAnns = annotations.filter((a) => a.filePath === path);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/file?session=${sessionId}&path=${encodeURIComponent(path)}`)
      .then((r) => r.json())
      .then((data: any) => {
        if (data.error) { setError(data.error); setLoading(false); }
        else { setContent(data.content); setLanguage(data.language || "text"); setLoading(false); }
      })
      .catch(() => { setError("Failed to fetch file"); setLoading(false); });
  }, [sessionId, path]);

  // Restore persisted annotation marks after file content renders
  useEffect(() => {
    if (!content || !contentRef.current) return;
    const timer = setTimeout(() => {
      if (contentRef.current) {
        restoreMarks(contentRef.current, fileAnns);
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [content, path]);

  // Update mark active states
  useEffect(() => { updateAllMarkStates(activeAnnotationId); }, [activeAnnotationId]);

  // Click handler for marks
  useEffect(() => {
    const container = contentRef.current;
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
    const handleMouseOver = (e: MouseEvent) => {
      const mark = (e.target as HTMLElement).closest("[data-annotation-id]") as HTMLElement | null;
      if (mark) setActiveAnnotationId(mark.getAttribute("data-annotation-id")!);
    };
    const handleMouseOut = (e: MouseEvent) => {
      const mark = (e.target as HTMLElement).closest("[data-annotation-id]");
      const related = (e.relatedTarget as HTMLElement | null)?.closest?.("[data-annotation-id]");
      if (mark && !related && !document.getElementById("ann-inline-popover")) setActiveAnnotationId(null);
    };
    container.addEventListener("click", handleClick);
    container.addEventListener("mouseover", handleMouseOver);
    container.addEventListener("mouseout", handleMouseOut);
    return () => {
      container.removeEventListener("click", handleClick);
      container.removeEventListener("mouseover", handleMouseOver);
      container.removeEventListener("mouseout", handleMouseOut);
    };
  }, [content, annotations, activeAnnotationId]);

  useEffect(() => {
    const handler = () => handleMouseUp();
    document.addEventListener("mouseup", handler);
    return () => document.removeEventListener("mouseup", handler);
  }, []);

  // Use refs so the document-level mouseup always has current values
  const pathRef = useRef(path);
  pathRef.current = path;
  const addAnnotationRef = useRef(addAnnotationWithId);
  addAnnotationRef.current = addAnnotationWithId;

  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
    if (!contentRef.current) return;
    const range = sel.getRangeAt(0);
    if (!contentRef.current.contains(range.startContainer)) return;
    if ((range.startContainer.parentElement as HTMLElement)?.closest?.("[data-annotation-id]")) return;
    const snippet = sel.toString().trim();
    if (snippet.length < 2) return;
    const tempId = `__pending_${Date.now()}`;
    const cloned = range.cloneRange();
    try { wrapRangeWithMark(cloned, tempId); } catch {}
    sel.removeAllRanges();

    const marks = document.querySelectorAll(`[data-annotation-id="${tempId}"]`);
    const lastMark = marks[marks.length - 1] as HTMLElement | undefined;
    if (!lastMark) return;

    pendingSnippetRef.current = snippet;
    setPendingMarkId(tempId);
    setCreatePopover({ anchorEl: lastMark, tempId, snippet });
  }, []);

  // Highlight content
  const highlightedLines = useMemo(() => {
    if (!content) return null;
    const hljs = (window as any).hljs;
    if (!hljs) return null;
    const ext = path.split(".").pop() || "";
    const lang = LANG_MAP[ext];
    try {
      const result = lang ? hljs.highlight(content, { language: lang }) : hljs.highlightAuto(content);
      return result.value.split("\n");
    } catch { return null; }
  }, [content, path]);

  if (loading) return <div className="flex items-center justify-center h-64 text-text-tertiary font-body text-[13px]">Loading {path}...</div>;
  if (error) return <div className="p-8 text-accent-red font-body text-[13px]">{error}</div>;
  if (!content) return null;

  const lines = content.split("\n");

  const addWholeFileWithPopup = () => {
    const preview = content!.split("\n").slice(0, 3).join("\n") + (lines.length > 3 ? "\n..." : "");
    const id = `ann-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    addAnnotationWithId(id, preview, "", path);
    // Focus the new annotation's note in sidebar by activating it
    setActiveAnnotationId(id);
  };

  const scrollContainer = contentRef.current?.closest("#plan-scroll-container") as HTMLElement | null;

  return (
    <div>
      {/* Code */}
      <pre ref={contentRef} className="text-code font-mono text-text-code bg-bg-base select-text cursor-text py-3 hljs">
        {lines.map((line, i) => (
          <div key={i} className="flex hover:bg-bg-elevated-half px-5">
            <span className="text-text-tertiary opacity-40 select-none w-10 text-right pr-4 shrink-0 py-px text-[12px]">{i + 1}</span>
            {highlightedLines ? (
              <code className="py-px" dangerouslySetInnerHTML={{ __html: highlightedLines[i] || " " }} />
            ) : (
              <code className="py-px">{line || " "}</code>
            )}
          </div>
        ))}
      </pre>

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
          onAdd={(note) => {
            const id = `ann-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            renameMarkId(createPopover.tempId, id);
            addAnnotationWithId(id, createPopover.snippet, note, path);
            setPendingMarkId(null);
            setCreatePopover(null);
          }}
          onCancel={() => {
            unwrapMarks(createPopover.tempId);
            setPendingMarkId(null);
            setCreatePopover(null);
          }}
        />
      )}
    </div>
  );
}

