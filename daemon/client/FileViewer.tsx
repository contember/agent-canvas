import React, { useEffect, useState, useContext, useCallback, useRef, useMemo } from "react";
import { SessionContext } from "#canvas/runtime";
import type { AnnotationContext } from "#canvas/runtime";
import { useAnnotations } from "./AnnotationProvider";
import { wrapRangeWithMark, updateAllMarkStates, renameMarkId, unwrapMarks, restoreMarks } from "./highlightRange";
import { AnnotationCreatePopover, AnnotationEditPopover } from "./Popover";
import { LANG_MAP } from "../langMap";
import { generateAnnotationId } from "./utils";

/** Walk up from a node to find the parent line div with data-line-num */
function findLineDiv(node: Node): HTMLElement | null {
  let el: HTMLElement | null = node instanceof HTMLElement ? node : node.parentElement;
  while (el) {
    if (el.hasAttribute("data-line-num")) return el;
    el = el.parentElement;
  }
  return null;
}

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

  // Line gutter selection state
  const [lineSelectStart, setLineSelectStart] = useState<number | null>(null);
  const [lineSelectEnd, setLineSelectEnd] = useState<number | null>(null);
  const lineSelectStartRef = useRef<number | null>(null);
  const lineSelectEndRef = useRef<number | null>(null);
  const linesRef = useRef<string[]>([]);

  // Popover state
  const [editPopover, setEditPopover] = useState<{ anchorEl: HTMLElement; annId: string } | null>(null);
  const [createPopover, setCreatePopover] = useState<{ anchorEl: HTMLElement; tempId: string; snippet: string; ctx?: AnnotationContext } | null>(null);

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
  const prevActiveRef = useRef<string | null>(null);
  useEffect(() => {
    updateAllMarkStates(activeAnnotationId, prevActiveRef.current);
    prevActiveRef.current = activeAnnotationId;
  }, [activeAnnotationId]);

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

    // Compute line numbers from DOM
    const startLineDiv = findLineDiv(range.startContainer);
    const endLineDiv = findLineDiv(range.endContainer);
    const lineStart = startLineDiv ? parseInt(startLineDiv.getAttribute("data-line-num")!, 10) : undefined;
    const lineEnd = endLineDiv ? parseInt(endLineDiv.getAttribute("data-line-num")!, 10) : undefined;

    // Compute before/after context for short snippets on a single line
    let before = "";
    let after = "";
    if (snippet.length < 30 && startLineDiv && startLineDiv === endLineDiv) {
      const code = startLineDiv.querySelector("code");
      if (code) {
        const lineText = code.textContent || "";
        const idx = lineText.indexOf(snippet);
        if (idx >= 0) {
          before = lineText.slice(0, idx).trimStart();
          after = lineText.slice(idx + snippet.length).trimEnd();
        }
      }
    }

    const ctx: AnnotationContext = { before, after, hierarchy: [], lineStart, lineEnd };

    const tempId = `__pending_${Date.now()}`;
    const cloned = range.cloneRange();
    try { wrapRangeWithMark(cloned, tempId); } catch {}
    sel.removeAllRanges();

    const marks = document.querySelectorAll(`[data-annotation-id="${tempId}"]`);
    const lastMark = marks[marks.length - 1] as HTMLElement | undefined;
    if (!lastMark) return;

    pendingSnippetRef.current = snippet;
    setPendingMarkId(tempId);
    setCreatePopover({ anchorEl: lastMark, tempId, snippet, ctx });
  }, []);

  // Line gutter: mousedown starts line selection
  const handleGutterMouseDown = useCallback((e: React.MouseEvent, lineNum: number) => {
    e.preventDefault(); // Prevent text selection
    lineSelectStartRef.current = lineNum;
    lineSelectEndRef.current = lineNum;
    setLineSelectStart(lineNum);
    setLineSelectEnd(lineNum);
  }, []);

  // Line gutter: mousemove + mouseup for drag selection
  useEffect(() => {
    const handleMouseMoveForLines = (e: MouseEvent) => {
      if (lineSelectStartRef.current === null) return;
      const lineDiv = (e.target as HTMLElement).closest("[data-line-num]") as HTMLElement;
      if (lineDiv) {
        const num = parseInt(lineDiv.getAttribute("data-line-num")!, 10);
        lineSelectEndRef.current = num;
        setLineSelectEnd(num);
      }
    };

    const handleMouseUpForLines = () => {
      const start = lineSelectStartRef.current;
      if (start === null) return;
      lineSelectStartRef.current = null;
      const end = lineSelectEndRef.current ?? start;
      const startLine = Math.min(start, end);
      const endLine = Math.max(start, end);
      const currentLines = linesRef.current;
      const snippet = currentLines.slice(startLine - 1, endLine).join("\n");
      if (!snippet.trim()) {
        setLineSelectStart(null);
        setLineSelectEnd(null);
        return;
      }

      const tempId = `__pending_${Date.now()}`;
      const ctx: AnnotationContext = { before: "", after: "", hierarchy: [], lineStart: startLine, lineEnd: endLine };

      // Wrap code content of selected lines with marks
      if (contentRef.current) {
        const lineDivs = contentRef.current.querySelectorAll("[data-line-num]");
        const firstDiv = lineDivs[startLine - 1] as HTMLElement;
        const lastDiv = lineDivs[endLine - 1] as HTMLElement;
        if (firstDiv && lastDiv) {
          const firstCode = firstDiv.querySelector("code");
          const lastCode = lastDiv.querySelector("code");
          if (firstCode && lastCode) {
            try {
              const range = document.createRange();
              range.setStartBefore(firstCode.firstChild || firstCode);
              range.setEndAfter(lastCode.lastChild || lastCode);
              wrapRangeWithMark(range, tempId);
            } catch {}
          }
        }
        const anchorEl = lineDivs[endLine - 1] as HTMLElement;
        if (anchorEl) {
          pendingSnippetRef.current = snippet;
          setPendingMarkId(tempId);
          setCreatePopover({ anchorEl, tempId, snippet, ctx });
        }
      }
      setLineSelectStart(null);
      setLineSelectEnd(null);
    };

    document.addEventListener("mousemove", handleMouseMoveForLines);
    document.addEventListener("mouseup", handleMouseUpForLines);
    return () => {
      document.removeEventListener("mousemove", handleMouseMoveForLines);
      document.removeEventListener("mouseup", handleMouseUpForLines);
    };
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
  linesRef.current = lines;

  // Computed selected line range for highlighting during drag
  const selectedLineRange = useMemo(() => {
    if (lineSelectStart === null) return null;
    const end = lineSelectEnd ?? lineSelectStart;
    return { start: Math.min(lineSelectStart, end), end: Math.max(lineSelectStart, end) };
  }, [lineSelectStart, lineSelectEnd]);

  const addWholeFileWithPopup = () => {
    const preview = content!.split("\n").slice(0, 3).join("\n") + (lines.length > 3 ? "\n..." : "");
    const id = generateAnnotationId();
    addAnnotationWithId(id, preview, "", path);
    // Focus the new annotation's note in sidebar by activating it
    setActiveAnnotationId(id);
  };

  const scrollContainer = contentRef.current?.closest("#plan-scroll-container") as HTMLElement | null;

  return (
    <div>
      {/* Code */}
      <pre ref={contentRef} className="text-code font-mono text-text-code bg-bg-base select-text cursor-text py-3 hljs">
        {lines.map((line, i) => {
          const lineNum = i + 1;
          const isSelected = selectedLineRange && lineNum >= selectedLineRange.start && lineNum <= selectedLineRange.end;
          return (
            <div key={i} data-line-num={lineNum} className={`flex px-5 ${isSelected ? "bg-accent-blue/10" : "hover:bg-bg-elevated-half"}`}>
              <span
                className="text-text-tertiary select-none w-10 text-right pr-4 shrink-0 py-px text-[12px] cursor-pointer opacity-40 hover:opacity-100 hover:text-accent-blue"
                onMouseDown={(e) => handleGutterMouseDown(e, lineNum)}
              >{lineNum}</span>
              {highlightedLines ? (
                <code className="py-px" dangerouslySetInnerHTML={{ __html: highlightedLines[i] || " " }} />
              ) : (
                <code className="py-px">{line || " "}</code>
              )}
            </div>
          );
        })}
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
            const id = generateAnnotationId();
            renameMarkId(createPopover.tempId, id);
            addAnnotationWithId(id, createPopover.snippet, note, path, createPopover.ctx);
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

