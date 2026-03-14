import React, { useEffect, useState, useContext, useCallback, useRef, useMemo } from "react";
import { SessionContext } from "#canvas/runtime";
import { useAnnotations } from "./AnnotationProvider";
import { wrapRangeWithMark, updateAllMarkStates, renameMarkId, unwrapMarks } from "./highlightRange";
import { getPopoverPosition } from "./popoverPosition";

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
    const scrollContainer = contentRef.current?.closest("#plan-scroll-container") as HTMLElement | null;
    const { style: posStyle, parent } = getPopoverPosition(anchor, scrollContainer);
    const pop = document.createElement("div");
    pop.id = "ann-inline-popover";
    Object.assign(pop.style, {
      ...posStyle, zIndex: "60",
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
    parent.appendChild(pop);
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

    const currentPath = pathRef.current;
    pendingSnippetRef.current = snippet;
    setPendingMarkId(tempId);

    const scrollContainer = contentRef.current.closest("#plan-scroll-container") as HTMLElement | null;
    showFileAnnotationPopover(lastMark, tempId, snippet, scrollContainer, (note) => {
      const id = `ann-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      renameMarkId(tempId, id);
      addAnnotationRef.current(id, snippet, note, currentPath);
      setPendingMarkId(null);
    }, () => {
      unwrapMarks(tempId);
      setPendingMarkId(null);
    });
  }, []);

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

    </div>
  );
}

function showFileAnnotationPopover(
  anchor: HTMLElement,
  tempId: string,
  snippet: string,
  scrollContainer: HTMLElement | null,
  onSubmit: (note: string) => void,
  onCancel: () => void,
) {
  const existing = document.getElementById("annotation-popover");
  if (existing) existing.remove();

  const { style: posStyle, parent } = getPopoverPosition(anchor, scrollContainer);
  const popover = document.createElement("div");
  popover.id = "annotation-popover";
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  Object.assign(popover.style, {
    ...posStyle, zIndex: "50",
    width: "280px", background: "var(--color-bg-elevated)",
    border: "1px solid var(--color-border-hover)",
    borderRadius: "8px", boxShadow: "0 4px 12px var(--color-shadow)",
    padding: "12px", fontFamily: "'Inter', sans-serif",
  });
  const truncated = snippet.length > 100 ? snippet.slice(0, 100) + "..." : snippet;
  popover.innerHTML = `
    <div style="font-size:11px;color:var(--color-text-tertiary);font-style:italic;margin-bottom:8px;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">"${esc(truncated)}"</div>
    <textarea id="annotation-note" style="width:100%;min-height:60px;background:transparent;border:none;color:var(--color-text-primary);font-family:'Inter',sans-serif;font-size:13px;line-height:1.5;resize:vertical;outline:none;" placeholder="Add your note..."></textarea>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px;">
      <button id="annotation-cancel" style="font-size:11px;color:var(--color-text-tertiary);background:none;border:none;cursor:pointer;padding:4px 12px;font-family:'Inter',sans-serif;">Cancel</button>
      <button id="annotation-add" style="font-size:11px;font-weight:500;padding:4px 12px;border-radius:6px;background:var(--color-highlight-bg);color:var(--color-text-primary);border:1px solid var(--color-highlight-border);cursor:pointer;font-family:'Inter',sans-serif;">Add</button>
    </div>
  `;
  parent.appendChild(popover);
  (document.getElementById("annotation-note") as HTMLTextAreaElement).focus();

  const cleanup = (cancelled: boolean) => {
    popover.remove();
    window.getSelection()?.removeAllRanges();
    if (cancelled) onCancel();
  };
  const submit = () => {
    const note = (document.getElementById("annotation-note") as HTMLTextAreaElement).value.trim();
    if (note) { onSubmit(note); popover.remove(); }
    else cleanup(true);
  };
  document.getElementById("annotation-cancel")!.onclick = () => cleanup(true);
  document.getElementById("annotation-add")!.onclick = submit;
  (document.getElementById("annotation-note") as HTMLTextAreaElement).addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit();
    if (e.key === "Escape") cleanup(true);
  });
  setTimeout(() => {
    const handler = (e: MouseEvent) => {
      if (!popover.contains(e.target as Node)) { cleanup(true); document.removeEventListener("mousedown", handler); }
    };
    document.addEventListener("mousedown", handler);
  }, 0);
}
