import type { AnnotationContext } from "./runtime";
import { formatSnippetInContext } from "./annotationContext";
import { describeSnippet } from "./annotationDom";

/**
 * What rendering one annotation reads off it. Every `Annotation` satisfies this,
 * and so can a record that is not one: how a single annotation reads as markdown
 * is the half of feedback that belongs to no particular document format.
 */
export interface RenderableAnnotation {
  snippet: string;
  note: string;
  /** Set when the annotation points into a file. With `context.lineStart` it
   *  switches the quote to numbered source lines. */
  filePath?: string;
  context?: AnnotationContext;
  images?: string[];
}

/**
 * One annotation as markdown: what was annotated, quoted, then the note and any
 * attachments under it. Ends on a blank line so entries stack.
 *
 * The caller owns everything around it — headings, grouping, ordering.
 */
export function renderAnnotation(ann: RenderableAnnotation): string {
  const lines: string[] = [];
  const snippet = ann.snippet.trim();
  const ctx = ann.context;
  // A snippet that does not read as text — a drawn region — says what it points
  // at in words instead, since quoting its encoding tells an agent nothing.
  const described = describeSnippet(snippet);

  if (described !== snippet) {
    lines.push(`> ${described}`);
  } else if (ann.filePath && ctx && ctx.lineStart != null) {
    // File annotation with line numbers
    const lineStart = ctx.lineStart;
    const lineEnd = ctx.lineEnd ?? lineStart;
    const snippetLines = snippet.split("\n");
    const isShort = snippet.length < 30 && lineStart === lineEnd;

    if (isShort && (ctx.before || ctx.after)) {
      // Short snippet on single line — show full line context
      const expanded = formatSnippetInContext(ann);
      lines.push(`> L${lineStart}: ${expanded}`);
    } else if (snippetLines.length <= 6) {
      for (let i = 0; i < snippetLines.length; i++) {
        lines.push(`> ${lineStart + i} | ${snippetLines[i]}`);
      }
    } else {
      for (let i = 0; i < 3; i++) {
        lines.push(`> ${lineStart + i} | ${snippetLines[i]}`);
      }
      lines.push(`> ... (${snippetLines.length} lines)`);
      for (let i = snippetLines.length - 3; i < snippetLines.length; i++) {
        lines.push(`> ${lineStart + i} | ${snippetLines[i]}`);
      }
    }
  } else {
    // Plan annotations or file annotations without line info
    const context = formatSnippetInContext(ann);
    if (snippet.split("\n").length <= 3) {
      lines.push(`> ${context.split("\n").join("\n> ")}`);
    } else {
      const snippetLines = snippet.split("\n");
      lines.push(`> ${snippetLines[0]}`);
      lines.push(`> ... (${snippetLines.length} lines)`);
      lines.push(`> ${snippetLines[snippetLines.length - 1]}`);
    }
  }

  // Comment
  if (ann.note.trim()) {
    lines.push("");
    lines.push(ann.note.trim());
  }

  // Attached images
  if (ann.images?.length) {
    lines.push("");
    for (const img of ann.images) {
      lines.push(`![screenshot](${img})`);
    }
  }

  lines.push("");
  return lines.join("\n");
}
