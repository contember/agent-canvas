import type { Annotation, PlanResponse } from "./AnnotationProvider";
import { formatSnippetInContext } from "./annotationContext";

/**
 * Generate structured feedback from annotations and responses.
 * Uses XML-like tags for unambiguous parsing.
 */
export function generateMarkdown(
  annotations: Annotation[],
  generalNote: string,
  responses?: Map<string, PlanResponse>,
): string {
  const parts: string[] = [];
  const planAnns = annotations.filter((a) => !a.filePath);
  const fileAnns = annotations.filter((a) => a.filePath);
  const resps = responses ? Array.from(responses.values()).filter((r) => hasValue(r)) : [];

  parts.push("<feedback>");
  parts.push("");

  // Structured responses from interactive components
  if (resps.length > 0) {
    parts.push("## Responses");
    parts.push("");
    for (const r of resps) {
      parts.push(renderResponse(r));
    }
  }

  // Plan annotations grouped by hierarchy
  if (planAnns.length > 0) {
    const grouped = groupByHierarchy(planAnns);
    parts.push("## Plan annotations");
    parts.push("");
    parts.push(renderHierarchyGroup(grouped));
  }

  // File annotations grouped by path
  if (fileAnns.length > 0) {
    const groups: Record<string, Annotation[]> = {};
    for (const ann of fileAnns) {
      const key = ann.filePath!;
      if (!groups[key]) groups[key] = [];
      groups[key].push(ann);
    }
    parts.push("## File references");
    parts.push("");
    for (const [filePath, anns] of Object.entries(groups)) {
      parts.push(`### ${filePath}`);
      parts.push("");
      for (const ann of anns) {
        parts.push(renderAnnotation(ann));
      }
    }
  }

  if (generalNote.trim()) {
    parts.push("## General");
    parts.push("");
    parts.push(generalNote.trim());
    parts.push("");
  }

  parts.push("</feedback>");
  return parts.join("\n");
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

function renderResponse(r: PlanResponse): string {
  const lines: string[] = [];
  lines.push("<response>");
  lines.push(`<question>${r.label}</question>`);

  switch (r.type) {
    case "radio":
    case "select":
      lines.push(`<answer>${r.value}</answer>`);
      if (r.options) lines.push(`<options>${r.options.join(", ")}</options>`);
      break;
    case "checkbox":
      lines.push(`<answer>${(r.value as string[]).join(", ")}</answer>`);
      if (r.options) lines.push(`<options>${r.options.join(", ")}</options>`);
      break;
    case "text":
      lines.push(`<answer>${(r.value as string).trim()}</answer>`);
      break;
    case "range":
      lines.push(`<answer>${r.value}</answer>`);
      break;
  }

  if (r.note?.trim()) {
    lines.push(`<note>${r.note.trim()}</note>`);
  }
  lines.push("</response>");
  lines.push("");
  return lines.join("\n");
}

function renderAnnotation(ann: Annotation): string {
  const lines: string[] = [];
  lines.push("<annotation>");

  const fullContext = formatSnippetInContext(ann);
  if (fullContext !== ann.snippet.trim()) {
    lines.push(`<context>${fullContext}</context>`);
  }

  const selectedLines = ann.snippet.trim().split("\n");
  if (selectedLines.length === 1) {
    lines.push(`<selected>${selectedLines[0]}</selected>`);
  } else {
    lines.push("<selected>");
    for (const l of selectedLines) lines.push(l);
    lines.push("</selected>");
  }

  if (ann.note.trim()) {
    lines.push(`<comment>${ann.note.trim()}</comment>`);
  }

  lines.push("</annotation>");
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
