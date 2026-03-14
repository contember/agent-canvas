import React, { useEffect, useRef, useState, useCallback } from "react";
import { useAnnotations } from "#canvas/runtime";
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
  const { addAnnotationWithId } = useAnnotations();
  const [nodePopover, setNodePopover] = useState<NodePopoverState | null>(null);

  const showPopoverRef = useRef((anchorEl: HTMLElement, snippet: string, prefix: string) => {
    setNodePopover({ anchorEl, snippet, prefix });
  });

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
          setupNodeAnnotations(containerRef.current, showPopoverRef.current);
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
  }, [source, addAnnotationWithId]);

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
}
