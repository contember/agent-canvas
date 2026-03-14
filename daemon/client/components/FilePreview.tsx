import React, { useEffect, useState, useContext, useRef } from "react";
import { SessionContext } from "#canvas/runtime";

interface FilePreviewProps {
  path: string;
  lines?: [number, number];
}

export function FilePreview({ path, lines }: FilePreviewProps) {
  const sessionId = useContext(SessionContext);
  const [content, setContent] = useState<string | null>(null);
  const [language, setLanguage] = useState("text");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const codeRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/file?session=${sessionId}&path=${encodeURIComponent(path)}`)
      .then((r) => r.json())
      .then((data: any) => {
        if (data.error) {
          setError(data.error);
        } else {
          let text = data.content;
          if (lines) {
            const allLines = text.split("\n");
            text = allLines.slice(lines[0] - 1, lines[1]).join("\n");
          }
          setContent(text);
          setLanguage(data.language || "text");
        }
      })
      .catch(() => setError("Failed to fetch file"))
      .finally(() => setLoading(false));
  }, [sessionId, path, lines?.[0], lines?.[1]]);

  // Highlight after content loads
  useEffect(() => {
    const el = codeRef.current;
    const hljs = (window as any).hljs;
    if (!el || !hljs || !content) return;
    el.removeAttribute("data-highlighted");
    el.className = language ? `language-${language}` : "";
    el.textContent = content;
    hljs.highlightElement(el);
  }, [content, language]);

  if (loading) {
    return <div className="text-text-tertiary text-body mt-3 bg-bg-code rounded-md p-4">Loading {path}...</div>;
  }

  if (error) {
    return <div className="text-accent-red text-body mt-3 bg-accent-red-muted rounded-md p-4">{path}: {error}</div>;
  }

  return (
    <div className="mt-3 bg-bg-code rounded-md overflow-hidden">
      <div className="px-4 py-2 flex items-center justify-between">
        <span className="font-mono text-meta text-text-tertiary">{path}</span>
        {lines && <span className="font-mono text-meta text-text-tertiary opacity-60">L{lines[0]}–{lines[1]}</span>}
      </div>
      <pre className="px-4 pb-3 overflow-x-auto text-code font-mono !bg-transparent" style={{ background: "transparent" }}>
        <code ref={codeRef} className={language ? `language-${language}` : ""}>{content}</code>
      </pre>
    </div>
  );
}
