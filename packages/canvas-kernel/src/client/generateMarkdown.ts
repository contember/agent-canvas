import type { Annotation, PlanResponse, FeedbackEntry } from "./AnnotationProvider";
import { formatSnippetInContext } from "./annotationContext";
import { describeSnippet } from "./annotationDom";
import { RESPONSE_ANNOTATION_PATH } from "./utils";

/**
 * Drop answers whose question is not in this revision's canvas. A draft carried
 * forward by carryUnsubmittedDraft() can hold an answer to a question the new
 * revision removed; submitting that would report an answer the author was never
 * asked for.
 *
 * `seenResponseIds` must be the sticky set of controls that have mounted at any
 * point in this draft, never the currently-mounted ones — see canPruneResponses.
 */
export function pruneStaleResponses(
  responses: Map<string, PlanResponse>,
  seenResponseIds: ReadonlySet<string>,
): Map<string, PlanResponse> {
  const out = new Map<string, PlanResponse>();
  for (const [id, r] of responses) {
    if (seenResponseIds.has(id)) out.set(id, r);
  }
  return out;
}

/**
 * Whether the set of seen response ids is complete enough to prune against.
 *
 * An id is only evidence of absence once every canvas that could host it has
 * rendered. Until then "not seen" means "not looked at yet" — the host opens
 * multi-canvas sessions on the overview, where no canvas is mounted at all, so
 * pruning early would throw away every answer the author gave.
 */
export function canPruneResponses(
  canvasFiles: readonly string[] | undefined,
  renderedCanvases: ReadonlySet<string>,
): boolean {
  if (!canvasFiles || canvasFiles.length === 0) return false;
  return canvasFiles.every((filename) => renderedCanvases.has(filename));
}

/**
 * Generate human-readable markdown feedback from annotations and responses.
 */
export function generateMarkdown(
  annotations: Annotation[],
  generalNote: string,
  responses?: Map<string, PlanResponse>,
  feedbackEntries?: Map<string, FeedbackEntry>,
  includedRemoteIds?: Set<string>,
): string {
  const parts: string[] = [];
  const included = annotations.filter((a) =>
    a.source !== "remote" || (includedRemoteIds && includedRemoteIds.has(a.id))
  );
  const responseAnns = included.filter((a) => a.filePath === RESPONSE_ANNOTATION_PATH);
  const canvasAnns = included.filter((a) => !a.filePath);
  const fileAnns = included.filter((a) => a.filePath && a.filePath !== RESPONSE_ANNOTATION_PATH);
  const resps = responses ? Array.from(responses.values()).filter((r) => hasValue(r)) : [];
  const fbEntries = feedbackEntries
    ? Array.from(feedbackEntries.values()).filter((e) => e.markdown.trim())
    : [];

  // Responses section
  const hasResponseSection = resps.length > 0 || fbEntries.length > 0;
  if (hasResponseSection) {
    parts.push("## Responses");
    parts.push("");
    for (const r of resps) {
      parts.push(renderResponse(r));
    }
    for (const entry of fbEntries) {
      parts.push(entry.markdown.trim());
      parts.push("");
    }
  }

  // Response annotations (on agent response banner)
  if (responseAnns.length > 0) {
    parts.push("## Annotations on agent response");
    parts.push("");
    for (const ann of responseAnns) {
      parts.push(renderAnnotation(ann));
    }
  }

  // Canvas annotations grouped by canvas file, then hierarchy
  if (canvasAnns.length > 0) {
    parts.push("## Canvas annotations");
    parts.push("");

    // Group by canvasFile
    const byCanvas = new Map<string, Annotation[]>();
    for (const ann of canvasAnns) {
      const key = ann.canvasFile || "";
      if (!byCanvas.has(key)) byCanvas.set(key, []);
      byCanvas.get(key)!.push(ann);
    }

    const canvasKeys = [...byCanvas.keys()].sort();
    const multipleCanvases = canvasKeys.length > 1 || (canvasKeys.length === 1 && canvasKeys[0] !== "");

    for (const canvasKey of canvasKeys) {
      const anns = byCanvas.get(canvasKey)!;
      if (multipleCanvases && canvasKey) {
        parts.push(`### ${canvasKey.replace(/\.jsx$/, "")}`);
        parts.push("");
      }
      const grouped = groupByHierarchy(anns);
      parts.push(renderHierarchyGroup(grouped));
    }
  }

  // File annotations grouped by path
  if (fileAnns.length > 0) {
    const groups: Record<string, Annotation[]> = {};
    for (const ann of fileAnns) {
      const key = ann.filePath!;
      if (!groups[key]) groups[key] = [];
      groups[key].push(ann);
    }
    parts.push("## File annotations");
    parts.push("");
    for (const [filePath, anns] of Object.entries(groups)) {
      parts.push(`### ${filePath}`);
      parts.push("");
      for (const ann of anns) {
        parts.push(renderAnnotation(ann));
      }
    }
  }

  // General notes
  if (generalNote.trim()) {
    parts.push("## General notes");
    parts.push("");
    parts.push(generalNote.trim());
    parts.push("");
  }

  return parts.join("\n").trim() + "\n";
}

export function hasValue(r: PlanResponse): boolean {
  if (r.note?.trim()) return true;
  if (r.value === null || r.value === undefined) return false;
  if (r.type === "text" && !(r.value as string).trim()) return false;
  if (r.type === "checkbox" && (r.value as string[]).length === 0) return false;
  return true;
}

export function getMissingRequired(responses: Map<string, PlanResponse>): PlanResponse[] {
  const missing: PlanResponse[] = [];
  for (const r of responses.values()) {
    if (!r.required) continue;
    if (r.value === null || r.value === undefined) { missing.push(r); continue; }
    if (r.type === "text" && !(r.value as string).trim()) { missing.push(r); continue; }
    if (r.type === "checkbox" && (r.value as string[]).length === 0) { missing.push(r); continue; }
  }
  return missing;
}

export function getMissingRequiredFeedback(entries: Map<string, FeedbackEntry>): FeedbackEntry[] {
  const missing: FeedbackEntry[] = [];
  for (const entry of entries.values()) {
    if (entry.required && !entry.markdown.trim()) {
      missing.push(entry);
    }
  }
  return missing;
}

/** Returns list of missing required field labels, or empty if all valid */
export function getMissingRequiredLabels(responses: Map<string, PlanResponse>, feedbackEntries: Map<string, FeedbackEntry>): string[] {
  const missingResponses = getMissingRequired(responses);
  const missingFeedback = getMissingRequiredFeedback(feedbackEntries);
  return [
    ...missingResponses.map((r) => r.label),
    ...missingFeedback.map((e) => e.label || e.id),
  ];
}

function renderResponse(r: PlanResponse): string {
  const lines: string[] = [];
  lines.push(`**${r.label}**`);

  switch (r.type) {
    case "radio":
    case "select":
      lines.push(`Answer: ${r.value}`);
      break;
    case "checkbox":
      for (const v of r.value as string[]) {
        lines.push(`- [x] ${v}`);
      }
      break;
    case "text":
      lines.push("");
      lines.push((r.value as string).trim());
      break;
    case "range":
      lines.push(`Answer: ${r.value}`);
      break;
  }

  if (r.note?.trim()) {
    lines.push("");
    lines.push(`Note: ${r.note.trim()}`);
  }

  lines.push("");
  return lines.join("\n");
}

function renderAnnotation(ann: Annotation): string {
  const lines: string[] = [];
  const snippet = ann.snippet.trim();
  const ctx = ann.context;
  const hasLineInfo = ctx?.lineStart != null;
  // A snippet that does not read as text — a drawn region — says what it points
  // at in words instead, since quoting its encoding tells an agent nothing.
  const described = describeSnippet(snippet);

  if (described !== snippet) {
    lines.push(`> ${described}`);
  } else if (ann.filePath && hasLineInfo) {
    // File annotation with line numbers
    const lineStart = ctx!.lineStart!;
    const lineEnd = ctx!.lineEnd ?? lineStart;
    const snippetLines = snippet.split("\n");
    const isShort = snippet.length < 30 && lineStart === lineEnd;

    if (isShort && (ctx!.before || ctx!.after)) {
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

interface HierarchyNode {
  label: string;
  annotations: Annotation[];
  children: Map<string, HierarchyNode>;
}

function groupByHierarchy(annotations: Annotation[]): HierarchyNode {
  const root: HierarchyNode = { label: "", annotations: [], children: new Map() };
  for (const ann of annotations) {
    const path = ann.context?.hierarchy || [];
    let current = root;
    for (const segment of path) {
      if (!current.children.has(segment)) {
        current.children.set(segment, { label: segment, annotations: [], children: new Map() });
      }
      current = current.children.get(segment)!;
    }
    current.annotations.push(ann);
  }
  return root;
}

function renderHierarchyGroup(node: HierarchyNode, depth: number = 0): string {
  const parts: string[] = [];
  for (const ann of node.annotations) {
    parts.push(renderAnnotation(ann));
  }
  for (const [, child] of node.children) {
    const prefix = depth === 0 ? "###" : "####";
    parts.push(`${prefix} ${child.label}`);
    parts.push("");
    parts.push(renderHierarchyGroup(child, depth + 1));
  }
  return parts.join("\n");
}
