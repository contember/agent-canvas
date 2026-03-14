import React, { useEffect, useRef, useState, useCallback } from "react";
import { useAnnotations, Annotation } from "#canvas/runtime";
import { AnnotationCreatePopover } from "../Popover";

interface MermaidProps {
  children?: React.ReactNode;
}

interface NodePopoverState {
  anchorEl: HTMLElement;
  snippet: string;
  prefix: string;
}

export function Mermaid({ children }: MermaidProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const source = typeof children === "string" ? children : String(children ?? "");
  const { annotations, addAnnotationWithId, activeAnnotationId, setActiveAnnotationId } = useAnnotations();
  const [nodePopover, setNodePopover] = useState<NodePopoverState | null>(null);

  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;

  const handleNodeClick = useCallback((anchorEl: HTMLElement, snippet: string, prefix: string) => {
    const diagramSnippet = `[Diagram ${prefix.toLowerCase()}] ${snippet}`;
    const existing = annotationsRef.current.find((a) => a.snippet === diagramSnippet);
    if (existing) {
      setActiveAnnotationId(existing.id);
    } else {
      setNodePopover({ anchorEl, snippet, prefix });
    }
  }, [setActiveAnnotationId]);

  const handleNodeClickRef = useRef(handleNodeClick);
  handleNodeClickRef.current = handleNodeClick;

  useEffect(() => {
    let cancelled = false;
    const render = async () => {
      try {
        const mermaid = (window as any).mermaid;
        if (!mermaid) { setError("Mermaid library not loaded"); return; }
        const theme = document.documentElement.dataset.theme === "light" ? "default" : "dark";
        mermaid.initialize({ startOnLoad: false, theme });
        const id = `mermaid-${Math.random().toString(36).slice(2)}`;
        const { svg } = await mermaid.render(id, source.trim());
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
          setupNodeAnnotations(containerRef.current, (el, snippet, prefix) => handleNodeClickRef.current(el, snippet, prefix));
          highlightAnnotatedNodes(containerRef.current, annotationsRef.current);
        }
        setError(null);
      } catch (e: any) {
        if (!cancelled) setError(e.message || "Invalid diagram");
      }
    };
    render();

    // Re-render on theme change
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.attributeName === "data-theme") render();
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    return () => { cancelled = true; observer.disconnect(); };
  }, [source]);

  // Update visual highlights when annotations change
  useEffect(() => {
    if (containerRef.current) {
      highlightAnnotatedNodes(containerRef.current, annotations, activeAnnotationId);
    }
  }, [annotations, activeAnnotationId]);

  if (error) {
    return (
      <div className="bg-accent-red-muted rounded-md p-4 mt-3 text-body text-accent-red">
        Mermaid error: {error}
        <pre className="mt-2 text-tiny text-text-tertiary whitespace-pre-wrap">{source}</pre>
      </div>
    );
  }

  const scrollContainer = containerRef.current?.closest("#plan-scroll-container") as HTMLElement | null;

  return (
    <>
      <div ref={containerRef} className="mt-3 flex justify-center overflow-x-auto mermaid-container" data-md="mermaid" data-md-source={source.trim()} />
      {nodePopover && (
        <AnnotationCreatePopover
          anchorEl={nodePopover.anchorEl}
          scrollContainer={scrollContainer}
          snippet={nodePopover.snippet}
          header={
            <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)", marginBottom: "8px", lineHeight: "1.4", display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--color-accent-amber)", flexShrink: 0 }} />
              {nodePopover.snippet}
            </div>
          }
          onAdd={(note) => {
            const id = `ann-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            addAnnotationWithId(id, `[Diagram ${nodePopover.prefix.toLowerCase()}] ${nodePopover.snippet}`, note);
            setNodePopover(null);
          }}
          onCancel={() => setNodePopover(null)}
        />
      )}
    </>
  );
}

function setupNodeAnnotations(
  container: HTMLElement,
  showPopover: (anchorEl: HTMLElement, snippet: string, prefix: string) => void,
) {
  const makeClickable = (el: SVGElement, getSnippet: () => string, prefix: string) => {
    el.style.cursor = "pointer";
    el.addEventListener("mouseenter", () => { el.style.filter = "brightness(1.2)"; });
    el.addEventListener("mouseleave", () => { el.style.filter = ""; });
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      showPopover(el as unknown as HTMLElement, getSnippet(), prefix);
    });
  };

  // Nodes
  for (const node of container.querySelectorAll(".node")) {
    makeClickable(node as SVGElement, () => {
      const labelEl = node.querySelector(".nodeLabel") || node.querySelector("foreignObject span") || node.querySelector("text");
      return labelEl?.textContent?.trim() || "Node";
    }, "Node");
  }

  // Edge paths (connections)
  for (const edge of container.querySelectorAll(".edgePath")) {
    const el = edge as SVGElement;
    // Widen hit area for thin lines
    const path = el.querySelector("path");
    if (path) {
      path.style.strokeWidth = Math.max(parseFloat(path.style.strokeWidth || "1"), 8) + "px";
      path.style.strokeOpacity = "0";
      const clone = path.cloneNode(true) as SVGPathElement;
      clone.style.strokeWidth = "";
      clone.style.strokeOpacity = "";
      el.insertBefore(clone, path);
    }
    // Find the label for this edge (sibling edgeLabel)
    const edgeId = el.id || "";
    makeClickable(el, () => {
      // Try to find matching edge label
      const labels = container.querySelectorAll(".edgeLabel");
      for (const label of labels) {
        if (label.id && edgeId && label.id.replace("label", "").includes(edgeId.replace("L-", "").replace("edge", ""))) {
          const text = label.textContent?.trim();
          if (text) return text;
        }
      }
      // Fallback: find nearest edge label by position
      return "Connection";
    }, "Edge");
  }

  // Edge labels
  for (const label of container.querySelectorAll(".edgeLabel")) {
    const text = label.textContent?.trim();
    if (!text) continue;
    makeClickable(label as SVGElement, () => text, "Edge");
  }

  // Sequence diagram: actors (participants)
  for (const actor of container.querySelectorAll(".actor")) {
    const textEl = actor.closest("g")?.querySelector("text") || actor.parentElement?.querySelector("text");
    if (!textEl) continue;
    // The actor rect and text are siblings in a <g> — make the whole <g> clickable
    const group = actor.closest("g") as SVGElement | null;
    if (!group || group.hasAttribute("data-clickable")) continue;
    group.setAttribute("data-clickable", "true");
    makeClickable(group, () => textEl.textContent?.trim() || "Participant", "Node");
  }

  // Sequence diagram: message labels
  for (const msgText of container.querySelectorAll(".messageText")) {
    const text = msgText.textContent?.trim();
    if (!text) continue;
    makeClickable(msgText as SVGElement, () => text, "Edge");
  }
}

function highlightAnnotatedNodes(container: HTMLElement, annotations: Annotation[], activeId?: string | null) {
  // Collect annotated diagram snippets
  const annotatedSnippets = new Map<string, string>();
  for (const ann of annotations) {
    const match = ann.snippet.match(/^\[Diagram (?:node|edge)\] (.+)$/);
    if (match) annotatedSnippets.set(match[1], ann.id);
  }

  // Reset all node outlines
  for (const el of container.querySelectorAll("[data-annotated]")) {
    (el as SVGElement).style.outline = "";
    (el as SVGElement).style.outlineOffset = "";
    (el as SVGElement).style.borderRadius = "";
    el.removeAttribute("data-annotated");
  }

  if (annotatedSnippets.size === 0) return;

  // Highlight nodes
  for (const node of container.querySelectorAll(".node")) {
    const labelEl = node.querySelector(".nodeLabel") || node.querySelector("foreignObject span") || node.querySelector("text");
    const text = labelEl?.textContent?.trim();
    if (!text || !annotatedSnippets.has(text)) continue;
    const annId = annotatedSnippets.get(text)!;
    const el = node as SVGElement;
    el.setAttribute("data-annotated", annId);
    const isActive = annId === activeId;
    el.style.outline = isActive
      ? "2px solid var(--color-highlight-border)"
      : "2px solid var(--color-highlight-annotation)";
    el.style.outlineOffset = "2px";
    el.style.borderRadius = "4px";
  }

  // Highlight edge labels
  for (const label of container.querySelectorAll(".edgeLabel")) {
    const text = label.textContent?.trim();
    if (!text || !annotatedSnippets.has(text)) continue;
    const annId = annotatedSnippets.get(text)!;
    const el = label as SVGElement;
    el.setAttribute("data-annotated", annId);
    const isActive = annId === activeId;
    el.style.outline = isActive
      ? "2px solid var(--color-highlight-border)"
      : "2px solid var(--color-highlight-annotation)";
    el.style.outlineOffset = "2px";
    el.style.borderRadius = "4px";
  }

  // Highlight sequence diagram actors
  for (const actor of container.querySelectorAll(".actor")) {
    const group = actor.closest("g") as SVGElement | null;
    if (!group) continue;
    const textEl = group.querySelector("text");
    const text = textEl?.textContent?.trim();
    if (!text || !annotatedSnippets.has(text)) continue;
    if (group.hasAttribute("data-annotated")) continue;
    const annId = annotatedSnippets.get(text)!;
    group.setAttribute("data-annotated", annId);
    const isActive = annId === activeId;
    const rect = group.querySelector("rect");
    if (rect) {
      rect.style.outline = isActive
        ? "2px solid var(--color-highlight-border)"
        : "2px solid var(--color-highlight-annotation)";
      rect.style.outlineOffset = "2px";
      rect.style.borderRadius = "4px";
    }
  }

  // Highlight sequence diagram message labels
  for (const msgText of container.querySelectorAll(".messageText")) {
    const text = msgText.textContent?.trim();
    if (!text || !annotatedSnippets.has(text)) continue;
    const annId = annotatedSnippets.get(text)!;
    const el = msgText as SVGElement;
    el.setAttribute("data-annotated", annId);
    const isActive = annId === activeId;
    el.style.outline = isActive
      ? "2px solid var(--color-highlight-border)"
      : "2px solid var(--color-highlight-annotation)";
    el.style.outlineOffset = "2px";
    el.style.borderRadius = "4px";
  }
}
