import React, { useMemo } from "react";
import { marked } from "marked";

interface MarkdownProps {
  /** Inline markdown source (via children) */
  children?: React.ReactNode;
  /** File path (resolved at compile time) */
  file?: string;
  /** Injected by compiler when file prop is used */
  __content?: string;
}

// Configure marked for safe rendering
marked.setOptions({
  gfm: true,
  breaks: false,
});

export function Markdown({ children, file, __content }: MarkdownProps) {
  const source = __content ?? (typeof children === "string" ? children : String(children ?? ""));

  const html = useMemo(() => {
    if (!source) return "";
    return marked.parse(source, { async: false }) as string;
  }, [source]);

  if (!source) {
    return (
      <div className="text-text-tertiary text-tiny mt-3">
        {file ? `Could not load: ${file}` : "No markdown content"}
      </div>
    );
  }

  return (
    <div
      className="mt-3 prose-canvas"
      data-md="markdown"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
