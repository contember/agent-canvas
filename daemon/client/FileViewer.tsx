import React, { useEffect, useState, useContext, useCallback, useRef, useMemo } from "react";
import { SessionContext } from "@planner/runtime";
import { useAnnotations } from "./AnnotationProvider";
import { wrapRangeWithMark, updateAllMarkStates } from "./highlightRange";

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

  const [showPopover, setShowPopover] = useState(false);
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 });
  const [selectedSnippet, setSelectedSnippet] = useState("");
  const [savedRange, setSavedRange] = useState<Range | null>(null);
  const [noteText, setNoteText] = useState("");
  const noteRef = useRef<HTMLTextAreaElement>(null);

  const fileAnns = annotations.filter((a) => a.filePath === path);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/file?session=${sessionId}&path=${encodeURIComponent(path)}`)
      .then((r) => r.json())
      .then((data: any) => {
        if (data.error) setError(data.error);
        else { setContent(data.content); setLanguage(data.language || "text"); }
      })
      .catch(() => setError("Failed to fetch file"))
      .finally(() => setLoading(false));
  }, [sessionId, path]);

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
        showEditPopover(mark, annId);
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
  }, [annotations, activeAnnotationId]);

  const showEditPopover = (anchor: HTMLElement, annId: string) => {
    const ann = annotations.find((a) => a.id === annId);
    if (!ann) return;
    document.getElementById("ann-inline-popover")?.remove();
    const rect = anchor.getBoundingClientRect();
    const pop = document.createElement("div");
    pop.id = "ann-inline-popover";
    Object.assign(pop.style, {
      position: "fixed", zIndex: "60",
      top: `${rect.bottom + 6}px`, left: `${Math.min(rect.left, window.innerWidth - 300)}px`,
      width: "280px", background: "var(--color-bg-elevated)",
      border: "1px solid var(--color-border-hover)", borderRadius: "8px",
      boxShadow: "0 4px 12px var(--color-shadow)", padding: "10px 12px",
      fontFamily: "'Inter', sans-serif",
    });
    const esc = (s: string) => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    pop.innerHTML = `
      <textarea id="ann-pop-textarea" style="width:100%;background:transparent;border:none;color:var(--color-text-primary);font-family:'Inter',sans-serif;font-size:13px;line-height:1.5;resize:none;outline:none;overflow:hidden;">${esc(ann.note)}</textarea>
      <div style="display:flex;justify-content:flex-end;margin-top:6px;">
        <button id="ann-pop-delete" style="font-size:11px;color:var(--color-text-tertiary);background:none;border:none;cursor:pointer;padding:2px 0;font-family:'Inter',sans-serif;">Delete</button>
      </div>
    `;
    document.body.appendChild(pop);
    const textarea = pop.querySelector("textarea")!;
    textarea.style.height = "auto"; textarea.style.height = textarea.scrollHeight + "px";
    textarea.focus(); textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    textarea.addEventListener("input", () => {
      textarea.style.height = "auto"; textarea.style.height = textarea.scrollHeight + "px";
      updateAnnotation(annId, textarea.value);
    });
    const del = document.getElementById("ann-pop-delete")!;
    del.onclick = () => { pop.remove(); removeAnnotation(annId); setActiveAnnotationId(null); };
    del.addEventListener("mouseenter", () => { del.style.color = "var(--color-accent-red)"; });
    del.addEventListener("mouseleave", () => { del.style.color = "var(--color-text-tertiary)"; });
    textarea.addEventListener("keydown", (e) => { if (e.key === "Escape") pop.remove(); });
    setTimeout(() => {
      const h = (e: MouseEvent) => {
        if (!pop.contains(e.target as Node) && !(e.target as HTMLElement).closest("[data-annotation-id]")) {
          updateAnnotation(annId, textarea.value);
          pop.remove(); document.removeEventListener("mousedown", h);
        }
      };
      document.addEventListener("mousedown", h);
    }, 0);
  };

  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
    if (!contentRef.current) return;
    const range = sel.getRangeAt(0);
    if (!contentRef.current.contains(range.commonAncestorContainer)) return;
    if ((range.startContainer.parentElement as HTMLElement)?.closest?.("[data-annotation-id]")) return;
    const snippet = sel.toString().trim();
    if (snippet.length < 2) return;
    const rect = range.getBoundingClientRect();
    setSelectedSnippet(snippet);
    setSavedRange(range.cloneRange());
    setPopoverPos({ top: rect.bottom + 8, left: Math.min(rect.left, window.innerWidth - 300) });
    setNoteText("");
    setShowPopover(true);
    setTimeout(() => noteRef.current?.focus(), 0);
  }, []);

  const submitAnnotation = () => {
    const note = noteText.trim();
    if (note && savedRange) {
      const id = `ann-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      try { wrapRangeWithMark(savedRange, id); } catch {}
      addAnnotationWithId(id, selectedSnippet, note, path);
    }
    setShowPopover(false);
    setSavedRange(null);
    window.getSelection()?.removeAllRanges();
  };

  // Highlight content
  const highlightedLines = useMemo(() => {
    if (!content) return null;
    const hljs = (window as any).hljs;
    if (!hljs) return null;
    const ext = path.split(".").pop() || "";
    const langMap: Record<string, string> = {
      ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
      py: "python", rs: "rust", go: "go", rb: "ruby", java: "java",
      json: "json", yaml: "yaml", yml: "yaml", md: "markdown",
      css: "css", html: "html", sh: "bash", bash: "bash", toml: "toml",
      sql: "sql", xml: "xml", c: "c", cpp: "cpp", h: "c",
    };
    const lang = langMap[ext];
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

  return (
    <div className="h-full flex flex-col">
      {/* Info bar */}
      <div className="flex items-center justify-between px-5 py-2.5 border-b border-border-subtle bg-bg-surface flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-text-tertiary font-body">{lines.length} lines</span>
          {fileAnns.length > 0 && <span className="text-[12px] text-accent-amber font-body">{fileAnns.length} annotation{fileAnns.length !== 1 ? "s" : ""}</span>}
        </div>
        <button
          onClick={addWholeFileWithPopup}
          className="flex items-center gap-1.5 text-[12px] font-medium font-body text-text-secondary hover:text-text-primary px-3 py-1.5 rounded-md bg-bg-input hover:bg-border-medium border border-border-subtle hover:border-border-hover transition-all"
        >
          <span className="text-[14px] leading-none">+</span>
          Add to context
        </button>
      </div>

      {/* Code */}
      <pre ref={contentRef} onMouseUp={handleMouseUp} className="flex-1 overflow-auto text-code font-mono text-text-code bg-bg-base select-text cursor-text py-3 hljs">
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

      {/* New annotation popover */}
      {showPopover && (
        <div className="fixed z-50 rounded-lg shadow-md p-3 w-72 bg-bg-elevated border border-border-hover" style={{ top: popoverPos.top, left: popoverPos.left }}>
          <div className="text-[11px] text-text-tertiary italic line-clamp-2 mb-2 font-body">
            "{selectedSnippet.length > 100 ? selectedSnippet.slice(0, 100) + "..." : selectedSnippet}"
          </div>
          <textarea
            ref={noteRef} value={noteText} onChange={(e) => setNoteText(e.target.value)}
            className="w-full bg-transparent border-none text-[13px] font-body text-text-primary resize-vertical focus:outline-none min-h-[60px]"
            placeholder="Add your note..."
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submitAnnotation();
              if (e.key === "Escape") { setShowPopover(false); window.getSelection()?.removeAllRanges(); }
            }}
          />
          <div className="flex justify-end gap-2 mt-2">
            <button onClick={() => { setShowPopover(false); window.getSelection()?.removeAllRanges(); }} className="text-[11px] text-text-tertiary font-body px-3 py-1">Cancel</button>
            <button onClick={submitAnnotation} className="text-[11px] font-medium font-body px-3 py-1 rounded-md bg-highlight-bg text-text-primary border border-highlight-border">Add</button>
          </div>
        </div>
      )}
    </div>
  );
}
