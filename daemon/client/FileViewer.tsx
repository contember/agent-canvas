import React, { useEffect, useState, useContext, useCallback, useRef, useMemo } from "react";
import { SessionContext } from "#canvas/runtime";
import type { AnnotationContext } from "#canvas/runtime";
import { useAnnotations } from "./AnnotationProvider";
import { wrapRangeWithMark } from "./highlightRange";
import { LANG_MAP } from "../langMap";
import { generateAnnotationId } from "./utils";
import { useTextAnnotation } from "./useTextAnnotation";
import { FS_AVAILABLE } from "./clientApi";

/** Walk up from a node to find the parent line div with data-line-num */
function findLineDiv(node: Node): HTMLElement | null {
  let el: HTMLElement | null = node instanceof HTMLElement ? node : node.parentElement;
  while (el) {
    if (el.hasAttribute("data-line-num")) return el;
    el = el.parentElement;
  }
  return null;
}

/** Build AnnotationContext from a text selection Range inside file content */
function buildFileContext(range: Range): AnnotationContext {
  const snippet = range.toString().trim();
  const startLineDiv = findLineDiv(range.startContainer);
  const endLineDiv = findLineDiv(range.endContainer);
  const lineStart = startLineDiv ? parseInt(startLineDiv.getAttribute("data-line-num")!, 10) : undefined;
  const lineEnd = endLineDiv ? parseInt(endLineDiv.getAttribute("data-line-num")!, 10) : undefined;

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

  return { before, after, hierarchy: [], lineStart, lineEnd };
}

interface FileViewerProps {
  path: string;
}

export function FileViewer({ path }: FileViewerProps) {
  if (!FS_AVAILABLE) {
    return (
      <div className="max-w-[720px] mx-auto px-6 pt-12 pb-32">
        <div className="p-4 rounded-lg border border-border-subtle bg-bg-surface">
          <div className="text-[11px] uppercase tracking-widest text-text-tertiary font-body mb-2">
            File not available
          </div>
          <p className="text-[13px] text-text-secondary font-body leading-relaxed">
            Opening <code className="px-1 py-0.5 rounded bg-bg-elevated text-text-primary text-[11px]">{path}</code> requires
            filesystem access, which isn't available in shared view. If the
            canvas author wanted this file visible, they should embed it as
            a <code className="px-1 py-0.5 rounded bg-bg-elevated text-text-primary text-[11px]">&lt;FilePreview&gt;</code> in the canvas.
          </p>
        </div>
      </div>
    );
  }
  const sessionId = useContext(SessionContext);
  const { annotations, addAnnotationWithId, activeAnnotationId, setActiveAnnotationId } = useAnnotations();
  const [content, setContent] = useState<string | null>(null);
  const [language, setLanguage] = useState("text");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const contentRef = useRef<HTMLPreElement>(null);

  // Line gutter selection state
  const [lineSelectStart, setLineSelectStart] = useState<number | null>(null);
  const [lineSelectEnd, setLineSelectEnd] = useState<number | null>(null);
  const lineSelectStartRef = useRef<number | null>(null);
  const lineSelectEndRef = useRef<number | null>(null);
  const linesRef = useRef<string[]>([]);

  const fileAnns = annotations.filter((a) => a.filePath === path);

  const scrollContainer = contentRef.current?.closest("#plan-scroll-container") as HTMLElement | null;

  const { popovers, openCreatePopover } = useTextAnnotation({
    containerRef: contentRef,
    restoreKey: `${content}:${path}`,
    restoreAnnotations: fileAnns,
    extractContext: buildFileContext,
    filePath: path,
    scrollContainer,
  });

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
          openCreatePopover(anchorEl, tempId, snippet, ctx);
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

      {popovers}
    </div>
  );
}
