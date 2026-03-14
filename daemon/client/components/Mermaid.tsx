import React, { useEffect, useRef, useState } from "react";

interface MermaidProps {
  children?: React.ReactNode;
}

export function Mermaid({ children }: MermaidProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const source = typeof children === "string" ? children : String(children ?? "");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (window as any).mermaid;
        if (!mermaid) { setError("Mermaid not loaded"); return; }
        const id = `mermaid-${Math.random().toString(36).slice(2)}`;
        const { svg } = await mermaid.render(id, source.trim());
        if (!cancelled && containerRef.current) containerRef.current.innerHTML = svg;
      } catch (e: any) {
        if (!cancelled) setError(e.message || "Invalid diagram");
      }
    })();
    return () => { cancelled = true; };
  }, [source]);

  if (error) {
    return (
      <div className="bg-accent-red-muted rounded-md p-4 mt-3 text-body text-accent-red">
        Mermaid error: {error}
        <pre className="mt-2 text-tiny text-text-tertiary">{source}</pre>
      </div>
    );
  }

  return <div ref={containerRef} className="mt-3 flex justify-center" />;
}
