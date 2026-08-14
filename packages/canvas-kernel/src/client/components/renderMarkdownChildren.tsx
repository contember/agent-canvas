import React from "react";
import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: false });

/** Host tags that flow inline and must not break a prose run into separate blocks. */
const INLINE_TAGS = new Set([
  "a", "abbr", "b", "br", "code", "del", "em", "i", "kbd", "mark",
  "q", "s", "small", "span", "strong", "sub", "sup", "time", "u",
]);

/** Custom components that render inline (e.g. <Priority>). */
const INLINE_COMPONENTS = new Set(["Priority"]);

function isInlineNode(node: React.ReactNode): boolean {
  if (typeof node === "string" || typeof node === "number") return true;
  if (!React.isValidElement(node)) return false;
  // Read `type` structurally: preact/compat's isValidElement is not a type
  // guard, so the narrowing React's typings give here does not survive there.
  if (typeof node !== "object" || node === null || !("type" in node)) return false;
  const type: unknown = node.type;
  if (typeof type === "string") return INLINE_TAGS.has(type);
  if (typeof type === "function") {
    const name = "displayName" in type && typeof type.displayName === "string" ? type.displayName : type.name;
    return name ? INLINE_COMPONENTS.has(name) : false;
  }
  return false;
}

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
 * Render a run of inline content (text + inline JSX like <code>/<strong>) as a single
 * flowing paragraph. Text segments are parsed as inline markdown; JSX passes through.
 * No `data-md` attribute so the markdown exporter treats it as an inline container.
 */
function renderInlineRun(run: React.ReactNode[], key: string): React.ReactNode {
  return (
    <div key={key} className="prose-canvas">
      {run.map((node, i) => {
        if (typeof node === "string" || typeof node === "number") {
          const html = marked.parseInline(String(node), { async: false }) as string;
          return <span key={i} dangerouslySetInnerHTML={{ __html: html }} />;
        }
        return node;
      })}
    </div>
  );
}

/**
 * Auto-render markdown for string children, passing JSX children through.
 * Block-level JSX (Callout, Diff, etc.) breaks the prose into separate markdown blocks,
 * while inline JSX (code, strong, links) stays within the surrounding paragraph so text
 * keeps flowing instead of stacking one fragment per line.
 */
export function renderMarkdownChildren(children: React.ReactNode): React.ReactNode {
  const kids = React.Children.toArray(children);
  if (kids.length === 0) return null;

  const result: React.ReactNode[] = [];
  let segment: React.ReactNode[] = [];
  let segIdx = 0;

  const flush = () => {
    if (segment.length === 0) return;
    const hasInlineJsx = segment.some((n) => typeof n !== "string" && typeof n !== "number");
    if (hasInlineJsx) {
      result.push(renderInlineRun(segment, `md-${segIdx++}`));
    } else {
      const node = renderTextAsMarkdown(segment.join(""), `md-${segIdx++}`);
      if (node) result.push(node);
    }
    segment = [];
  };

  for (const child of kids) {
    if (isInlineNode(child)) {
      segment.push(child);
    } else {
      flush();
      result.push(child);
    }
  }
  flush();
  return result;
}
