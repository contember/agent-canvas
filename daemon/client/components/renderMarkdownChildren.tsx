import React from "react";
import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: false });

function renderTextAsMarkdown(text: string, key: string): React.ReactNode {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const html = marked.parse(trimmed, { async: false }) as string;
  return (
    <div
      key={key}
      className="prose-canvas"
      data-md="markdown"
      data-md-source={trimmed}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/**
 * Auto-render markdown for string children, passing JSX children through.
 * Consecutive string runs are grouped into a single markdown block so multi-paragraph
 * prose between JSX elements renders correctly.
 */
export function renderMarkdownChildren(children: React.ReactNode): React.ReactNode {
  const kids = React.Children.toArray(children);
  if (kids.length === 0) return null;

  const result: React.ReactNode[] = [];
  let buffer = "";
  let bufferIdx = 0;

  const flush = () => {
    if (buffer) {
      const node = renderTextAsMarkdown(buffer, `md-${bufferIdx++}`);
      if (node) result.push(node);
      buffer = "";
    }
  };

  for (const child of kids) {
    if (typeof child === "string" || typeof child === "number") {
      buffer += String(child);
    } else {
      flush();
      result.push(child);
    }
  }
  flush();
  return result;
}
