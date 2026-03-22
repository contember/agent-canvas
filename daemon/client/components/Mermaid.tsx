import React, { useEffect, useRef, useState, useCallback } from "react";
import ReactDOM from "react-dom";
import { useAnnotations, useCanvasFile, Annotation } from "#canvas/runtime";
import { AnnotationCreatePopover } from "../Popover";

interface MermaidProps {
  children?: React.ReactNode;
}

interface NodePopoverState {
  anchorEl: HTMLElement;
  snippet: string;
  prefix: string;
}

const ZOOM_STEP = 0.2;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;

function ZoomToolbar({ zoom, onZoomIn, onZoomOut, onZoomReset, onFullscreen }: {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onFullscreen?: () => void;
}) {
  const btnClass = "flex items-center justify-center w-7 h-7 rounded hover:bg-bg-elevated text-text-secondary hover:text-text-primary transition-colors";
  return (
    <div className="flex items-center gap-0.5 bg-bg-surface border border-border-subtle rounded-md px-1 py-0.5" style={{ fontSize: "12px" }}>
      <button className={btnClass} onClick={onZoomOut} title="Zoom out" disabled={zoom <= ZOOM_MIN}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
      <button className="px-1.5 h-7 rounded hover:bg-bg-elevated text-text-tertiary hover:text-text-primary transition-colors tabular-nums" onClick={onZoomReset} title="Reset zoom">
        {Math.round(zoom * 100)}%
      </button>
      <button className={btnClass} onClick={onZoomIn} title="Zoom in" disabled={zoom >= ZOOM_MAX}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
      {onFullscreen && (
        <>
          <div className="w-px h-4 bg-border-subtle mx-0.5" />
          <button className={btnClass} onClick={onFullscreen} title="Fullscreen">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
          </button>
        </>
      )}
    </div>
  );
}

function useZoom(initialZoom = 1) {
  const [zoom, setZoom] = useState(initialZoom);
  const zoomIn = useCallback(() => setZoom(z => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2))), []);
  const zoomOut = useCallback(() => setZoom(z => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2))), []);
  const zoomReset = useCallback(() => setZoom(1), []);
  return { zoom, zoomIn, zoomOut, zoomReset, setZoom };
}

function MermaidFullscreenModal({ svgHtml, source, onClose }: {
  svgHtml: string;
  source: string;
  onClose: () => void;
}) {
  const modalContentRef = useRef<HTMLDivElement>(null);
  const { zoom, zoomIn, zoomOut, zoomReset, setZoom } = useZoom(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragging = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    setZoom(z => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, +(z + delta).toFixed(2))));
  }, [setZoom]);

  // Pan via mouse drag
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    dragging.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
    e.preventDefault();
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging.current) return;
    setPan({
      x: dragging.current.panX + (e.clientX - dragging.current.startX),
      y: dragging.current.panY + (e.clientY - dragging.current.startY),
    });
  }, []);

  const handleMouseUp = useCallback(() => {
    dragging.current = null;
  }, []);

  const handleResetView = useCallback(() => {
    zoomReset();
    setPan({ x: 0, y: 0 });
  }, [zoomReset]);

  return ReactDOM.createPortal(
    <div
      style={{ position: "fixed", inset: 0, zIndex: 9999, background: "var(--color-bg-base)", display: "flex", flexDirection: "column" }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border-subtle" style={{ flexShrink: 0, background: "var(--color-bg-surface)" }}>
        <span className="text-body text-text-secondary" style={{ fontSize: "13px" }}>Mermaid Diagram</span>
        <div className="flex items-center gap-2">
          <ZoomToolbar zoom={zoom} onZoomIn={zoomIn} onZoomOut={zoomOut} onZoomReset={handleResetView} />
          <button
            className="flex items-center justify-center w-8 h-8 rounded hover:bg-bg-elevated text-text-secondary hover:text-text-primary transition-colors"
            onClick={onClose}
            title="Close (Esc)"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
      {/* Diagram area */}
      <div
        style={{ flex: 1, overflow: "hidden", cursor: dragging.current ? "grabbing" : "grab" }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
      >
        <div
          ref={modalContentRef}
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "center center",
            transition: dragging.current ? "none" : "transform 0.1s ease-out",
          }}
          dangerouslySetInnerHTML={{ __html: svgHtml }}
        />
      </div>
    </div>,
    document.body,
  );
}

export function Mermaid({ children }: MermaidProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [showFullscreen, setShowFullscreen] = useState(false);
  const [svgHtml, setSvgHtml] = useState("");
  const source = typeof children === "string" ? children : String(children ?? "");
  const { annotations, addAnnotationWithId, activeAnnotationId, setActiveAnnotationId } = useAnnotations();
  const canvasFile = useCanvasFile();
  const [nodePopover, setNodePopover] = useState<NodePopoverState | null>(null);
  const { zoom, zoomIn, zoomOut, zoomReset, setZoom } = useZoom(1);

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
          setSvgHtml(svg);
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

  // Wheel zoom on inline diagram
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    setZoom(z => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, +(z + delta).toFixed(2))));
  }, [setZoom]);

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
      <div className="mt-3 mermaid-container" data-md="mermaid" data-md-source={source.trim()}>
        {/* Zoom toolbar */}
        <div className="flex justify-end mb-1">
          <ZoomToolbar
            zoom={zoom}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
            onZoomReset={zoomReset}
            onFullscreen={() => setShowFullscreen(true)}
          />
        </div>
        {/* Zoomable diagram */}
        <div style={{ overflow: "auto", maxHeight: "70vh" }} onWheel={handleWheel}>
          <div
            ref={containerRef}
            className="flex justify-center"
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: "top center",
              transition: "transform 0.1s ease-out",
              minHeight: zoom < 1 ? undefined : undefined,
            }}
          />
        </div>
      </div>
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
          onAdd={(note, images) => {
            const id = `ann-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            addAnnotationWithId(id, `[Diagram ${nodePopover.prefix.toLowerCase()}] ${nodePopover.snippet}`, note, undefined, undefined, images, canvasFile || undefined);
            setNodePopover(null);
          }}
          onCancel={() => setNodePopover(null)}
        />
      )}
      {showFullscreen && svgHtml && (
        <MermaidFullscreenModal
          svgHtml={svgHtml}
          source={source}
          onClose={() => setShowFullscreen(false)}
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

  // ER diagram: entities
  for (const entity of container.querySelectorAll(".entityBox")) {
    const group = entity.closest("g") as SVGElement | null;
    if (!group || group.hasAttribute("data-clickable")) continue;
    const labelEl = group.querySelector(".entityLabel");
    if (!labelEl) continue;
    group.setAttribute("data-clickable", "true");
    makeClickable(group, () => labelEl.textContent?.trim() || "Entity", "Node");
  }

  // ER diagram: relationship labels
  for (const label of container.querySelectorAll(".relationshipLabel")) {
    const text = label.textContent?.trim();
    if (!text) continue;
    const group = label.closest("g") as SVGElement | null;
    const target = group || label as SVGElement;
    if (target.hasAttribute("data-clickable")) continue;
    target.setAttribute("data-clickable", "true");
    makeClickable(target, () => text, "Edge");
  }

  // Class diagram: class groups
  for (const classGroup of container.querySelectorAll(".classGroup")) {
    const el = classGroup as SVGElement;
    if (el.hasAttribute("data-clickable")) continue;
    const labelEl = el.querySelector(".classTitle, .classTitleText, text");
    if (!labelEl) continue;
    el.setAttribute("data-clickable", "true");
    makeClickable(el, () => labelEl.textContent?.trim() || "Class", "Node");
  }

  // State diagram: states
  for (const state of container.querySelectorAll(".statediagram-state")) {
    const el = state as SVGElement;
    if (el.hasAttribute("data-clickable")) continue;
    const labelEl = el.querySelector(".state-title, text");
    if (!labelEl) continue;
    el.setAttribute("data-clickable", "true");
    makeClickable(el, () => labelEl.textContent?.trim() || "State", "Node");
  }

  // Mindmap: nodes
  for (const node of container.querySelectorAll(".mindmap-node")) {
    const el = node as SVGElement;
    if (el.hasAttribute("data-clickable")) continue;
    const labelEl = el.querySelector(".mindmap-node-label, text");
    if (!labelEl) continue;
    el.setAttribute("data-clickable", "true");
    makeClickable(el, () => labelEl.textContent?.trim() || "Node", "Node");
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

  // Helper for group-based highlights (ER entities, class groups, states, mindmap nodes)
  const highlightGroups = (
    selector: string,
    labelSelector: string,
    findGroup: (el: Element) => SVGElement | null,
  ) => {
    for (const el of container.querySelectorAll(selector)) {
      const group = findGroup(el);
      if (!group || group.hasAttribute("data-annotated")) continue;
      const labelEl = group.querySelector(labelSelector);
      const text = labelEl?.textContent?.trim();
      if (!text || !annotatedSnippets.has(text)) continue;
      const annId = annotatedSnippets.get(text)!;
      group.setAttribute("data-annotated", annId);
      const isActive = annId === activeId;
      const target = group.querySelector("rect, circle, ellipse, polygon") as SVGElement || group;
      target.style.outline = isActive
        ? "2px solid var(--color-highlight-border)"
        : "2px solid var(--color-highlight-annotation)";
      target.style.outlineOffset = "2px";
      target.style.borderRadius = "4px";
    }
  };

  // ER diagram: entities
  highlightGroups(".entityBox", ".entityLabel", (el) => el.closest("g") as SVGElement | null);

  // ER diagram: relationship labels
  for (const label of container.querySelectorAll(".relationshipLabel")) {
    const group = label.closest("g") as SVGElement | null;
    const target = group || label as SVGElement;
    if (target.hasAttribute("data-annotated")) continue;
    const text = label.textContent?.trim();
    if (!text || !annotatedSnippets.has(text)) continue;
    const annId = annotatedSnippets.get(text)!;
    target.setAttribute("data-annotated", annId);
    const isActive = annId === activeId;
    (target as SVGElement).style.outline = isActive
      ? "2px solid var(--color-highlight-border)"
      : "2px solid var(--color-highlight-annotation)";
    (target as SVGElement).style.outlineOffset = "2px";
    (target as SVGElement).style.borderRadius = "4px";
  }

  // Class diagram
  highlightGroups(".classGroup", ".classTitle, .classTitleText, text", (el) => el as SVGElement);

  // State diagram
  highlightGroups(".statediagram-state", ".state-title, text", (el) => el as SVGElement);

  // Mindmap
  highlightGroups(".mindmap-node", ".mindmap-node-label, text", (el) => el as SVGElement);
}
