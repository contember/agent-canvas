import React, { useEffect, useRef, useState } from "react";
import { useAnnotations } from "@planner/runtime";
import { getPopoverPosition } from "../popoverPosition";

interface MermaidProps {
  children?: React.ReactNode;
}

export function Mermaid({ children }: MermaidProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const source = typeof children === "string" ? children : String(children ?? "");
  const { addAnnotationWithId } = useAnnotations();

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
          setupNodeAnnotations(containerRef.current, addAnnotationWithId);
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

  return <div ref={containerRef} className="mt-3 flex justify-center overflow-x-auto mermaid-container" data-md="mermaid" data-md-source={source.trim()} />;
}

function setupNodeAnnotations(
  container: HTMLElement,
  addAnnotationWithId: (id: string, snippet: string, note: string, filePath?: string) => void,
) {
  const makeClickable = (el: SVGElement, getSnippet: () => string, prefix: string) => {
    el.style.cursor = "pointer";
    el.addEventListener("mouseenter", () => { el.style.filter = "brightness(1.2)"; });
    el.addEventListener("mouseleave", () => { el.style.filter = ""; });
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      showNodePopover(el as unknown as HTMLElement, getSnippet(), prefix, container, addAnnotationWithId);
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

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function showNodePopover(
  anchor: HTMLElement,
  snippet: string,
  prefix: string,
  mermaidContainer: HTMLElement,
  addAnnotationWithId: (id: string, snippet: string, note: string, filePath?: string) => void,
) {
  const existing = document.getElementById("mermaid-annotation-popover");
  if (existing) existing.remove();

  const scrollContainer = mermaidContainer.closest("#plan-scroll-container") as HTMLElement | null;
  const { style: posStyle, parent } = getPopoverPosition(anchor, scrollContainer);

  const popover = document.createElement("div");
  popover.id = "mermaid-annotation-popover";
  Object.assign(popover.style, {
    ...posStyle, zIndex: "50",
    width: "280px", background: "var(--color-bg-elevated)",
    border: "1px solid var(--color-border-hover)",
    borderRadius: "8px", boxShadow: "0 4px 12px var(--color-shadow)",
    padding: "12px", fontFamily: "'Inter', sans-serif",
  });

  popover.innerHTML = `
    <div style="font-size:12px;color:var(--color-text-tertiary);margin-bottom:8px;line-height:1.4;display:flex;align-items:center;gap:6px;">
      <span style="width:8px;height:8px;border-radius:50%;background:var(--color-accent-amber);flex-shrink:0;"></span>
      ${escapeHtml(snippet)}
    </div>
    <textarea id="mermaid-ann-note" style="width:100%;min-height:60px;background:transparent;border:none;color:var(--color-text-primary);font-family:'Inter',sans-serif;font-size:13px;line-height:1.5;resize:vertical;outline:none;" placeholder="Add your note about this node..."></textarea>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px;">
      <button id="mermaid-ann-cancel" style="font-size:12px;color:var(--color-text-tertiary);background:none;border:none;cursor:pointer;padding:4px 12px;font-family:'Inter',sans-serif;">Cancel</button>
      <button id="mermaid-ann-add" style="font-size:12px;font-weight:500;padding:4px 12px;border-radius:6px;background:var(--color-highlight-bg);color:var(--color-text-primary);border:1px solid var(--color-highlight-border);cursor:pointer;font-family:'Inter',sans-serif;">Add</button>
    </div>
  `;
  parent.appendChild(popover);
  (document.getElementById("mermaid-ann-note") as HTMLTextAreaElement).focus();

  const cleanup = () => popover.remove();
  const submit = () => {
    const note = (document.getElementById("mermaid-ann-note") as HTMLTextAreaElement).value.trim();
    if (note) {
      const id = `ann-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      addAnnotationWithId(id, `[Diagram ${prefix.toLowerCase()}] ${snippet}`, note);
    }
    cleanup();
  };

  document.getElementById("mermaid-ann-cancel")!.onclick = cleanup;
  document.getElementById("mermaid-ann-add")!.onclick = submit;
  (document.getElementById("mermaid-ann-note") as HTMLTextAreaElement).addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit();
    if (e.key === "Escape") cleanup();
  });
  setTimeout(() => {
    const handler = (e: MouseEvent) => {
      if (!popover.contains(e.target as Node)) { cleanup(); document.removeEventListener("mousedown", handler); }
    };
    document.addEventListener("mousedown", handler);
  }, 0);
}
