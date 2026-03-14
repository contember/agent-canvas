/**
 * Export the rendered plan canvas to markdown.
 * Reads data-md attributes from known components, falls back to text extraction for unknown elements.
 */
export function exportCanvasToMarkdown(container: HTMLElement): string {
  const lines: string[] = [];
  walkChildren(container, lines, 0);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

const INLINE_TAGS = new Set(["CODE", "SPAN", "STRONG", "EM", "A", "B", "I", "U", "SMALL", "SUB", "SUP", "MARK", "ABBR"]);

function walkChildren(el: HTMLElement, lines: string[], depth: number) {
  // Detect if this element contains only inline content (text nodes + inline elements).
  // If so, concatenate into a single paragraph instead of splitting across lines.
  if (isInlineContainer(el)) {
    const text = extractInlineText(el);
    if (text) lines.push(text, "");
    return;
  }

  for (const child of el.childNodes) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      walkNode(child as HTMLElement, lines, depth);
    } else if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent?.trim();
      if (text) lines.push(text, "");
    }
  }
}

/** Check if an element contains only text nodes and inline elements (no block-level children) */
function isInlineContainer(el: HTMLElement): boolean {
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) continue;
    if (child.nodeType === Node.ELEMENT_NODE) {
      const childEl = child as HTMLElement;
      if (!INLINE_TAGS.has(childEl.tagName) || childEl.hasAttribute("data-md")) return false;
    }
  }
  return el.childNodes.length > 0;
}

/** Extract text from an inline container, wrapping <code> in backticks */
function extractInlineText(el: HTMLElement): string {
  let result = "";
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      result += child.textContent || "";
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const childEl = child as HTMLElement;
      if (childEl.tagName === "CODE") {
        result += "`" + (childEl.textContent || "") + "`";
      } else {
        result += childEl.textContent || "";
      }
    }
  }
  return result.trim();
}

function walkNode(el: HTMLElement, lines: string[], depth: number) {
  const md = el.getAttribute("data-md");

  if (md) {
    switch (md) {
      case "section": return handleSection(el, lines, depth);
      case "item": return handleItem(el, lines);
      case "codeblock": return handleCodeBlock(el, lines);
      case "callout": return handleCallout(el, lines);
      case "note": return handleNote(el, lines);
      case "table": return handleTable(el, lines);
      case "checklist": return handleChecklist(el, lines);
      case "diff": return handleDiff(el, lines);
      case "mermaid": return handleMermaid(el, lines);
      case "choice": return handleChoice(el, lines);
      case "multichoice": return handleMultiChoice(el, lines);
      case "choice-option":
      case "multichoice-option": return; // handled by parent
      case "userinput": return handleUserInput(el, lines);
      case "rangeinput": return handleRangeInput(el, lines);
      case "checklist-item": return; // handled by parent (checklist)
      case "filepreview": return handleFilePreview(el, lines);
      case "priority": return handlePriority(el, lines);
    }
  }

  // Skip interactive widgets (custom components with buttons/inputs/selects)
  if (el.querySelector("button, input, select, textarea")) return;

  // Unknown element — if it has text, extract it; if it has children, recurse
  if (el.children.length > 0) {
    walkChildren(el, lines, depth);
  } else {
    const text = el.textContent?.trim();
    if (text) lines.push(text, "");
  }
}

function handleSection(el: HTMLElement, lines: string[], depth: number) {
  const title = el.getAttribute("data-md-title") || "Untitled";
  const prefix = depth === 0 ? "##" : "###";
  lines.push(`${prefix} ${title}`, "");

  // Process section content (skip the heading div, process the content div)
  // Use :last-of-type instead of :last-child — portaled <button> elements from
  // BlockCommentButtons can be appended as the last child, breaking :last-child
  const contentDiv = el.querySelector(":scope > div:last-of-type");
  if (contentDiv) {
    walkChildren(contentDiv as HTMLElement, lines, depth + 1);
  }
}

function handleItem(el: HTMLElement, lines: string[]) {
  const label = el.getAttribute("data-md-label") || "";
  const status = el.getAttribute("data-md-status");
  const badge = el.getAttribute("data-md-badge");

  let prefix = "-";
  if (status === "done") prefix = "- [x]";
  else if (status) prefix = "- [ ]";

  let line = `${prefix} **${label}**`;
  if (badge) line += ` \`${badge}\``;
  lines.push(line);

  // Walk children content (description, nested CodeBlock, Callout, Priority, etc.)
  const childrenDiv = el.querySelector(".text-text-secondary");
  if (childrenDiv) {
    const childLines: string[] = [];
    walkChildren(childrenDiv as HTMLElement, childLines, 0);
    // Indent child content under the list item
    for (const cl of childLines) {
      lines.push(cl ? `  ${cl}` : "");
    }
  }
  lines.push("");
}

function handleCodeBlock(el: HTMLElement, lines: string[]) {
  const language = el.getAttribute("data-md-language") || "";
  const code = el.querySelector("code");
  const text = code?.textContent || "";
  lines.push(`\`\`\`${language}`, text, "```", "");
}

function handleCallout(el: HTMLElement, lines: string[]) {
  const type = el.getAttribute("data-md-type") || "info";
  const labels: Record<string, string> = { info: "Info", warning: "Warning", danger: "Danger", tip: "Tip" };
  const content = extractText(el.querySelector(".text-text-secondary") as HTMLElement || el);
  lines.push(`> **${labels[type] || type}:** ${content}`, "");
}

function handleNote(el: HTMLElement, lines: string[]) {
  const text = el.textContent?.trim() || "";
  lines.push(`> *${text}*`, "");
}

function handleTable(el: HTMLElement, lines: string[]) {
  const table = el.querySelector("table");
  if (!table) return;

  const headers: string[] = [];
  for (const th of table.querySelectorAll("thead th")) {
    headers.push(th.textContent?.trim() || "");
  }
  if (headers.length === 0) return;

  lines.push(`| ${headers.join(" | ")} |`);
  lines.push(`| ${headers.map(() => "---").join(" | ")} |`);

  for (const tr of table.querySelectorAll("tbody tr")) {
    const cells: string[] = [];
    for (const td of tr.querySelectorAll("td")) {
      cells.push(td.textContent?.trim() || "");
    }
    lines.push(`| ${cells.join(" | ")} |`);
  }
  lines.push("");
}

function handleChecklist(el: HTMLElement, lines: string[]) {
  for (const li of el.querySelectorAll("li")) {
    const hasCheck = li.querySelector(".bg-accent-green") !== null;
    const label = li.textContent?.trim() || "";
    lines.push(`- [${hasCheck ? "x" : " "}] ${label}`);
  }
  lines.push("");
}

function handleDiff(el: HTMLElement, lines: string[]) {
  const language = el.getAttribute("data-md-language") || "";
  lines.push(`\`\`\`diff${language ? ` (${language})` : ""}`);
  for (const row of el.querySelectorAll("[class*='flex']")) {
    const prefix = row.querySelector(".text-accent-red") ? "-" :
                   row.querySelector(".text-accent-green") ? "+" : " ";
    const code = row.querySelector("code");
    if (code) lines.push(`${prefix} ${code.textContent}`);
  }
  lines.push("```", "");
}

function handleMermaid(el: HTMLElement, lines: string[]) {
  const source = el.getAttribute("data-md-source") || "";
  if (source) {
    lines.push("```mermaid", source, "```", "");
  }
}

function handleChoice(el: HTMLElement, lines: string[]) {
  const label = el.getAttribute("data-md-label") || "";
  lines.push(`**${label}:**`);
  for (const opt of el.querySelectorAll("[data-md='choice-option']")) {
    const optLabel = opt.getAttribute("data-md-label") || opt.textContent?.trim() || "";
    const selected = opt.querySelector(".bg-accent-amber") !== null;
    lines.push(`- ${selected ? "(x)" : "( )"} ${optLabel}`);
  }
  lines.push("");
}

function handleMultiChoice(el: HTMLElement, lines: string[]) {
  const label = el.getAttribute("data-md-label") || "";
  lines.push(`**${label}:**`);
  for (const opt of el.querySelectorAll("[data-md='multichoice-option']")) {
    const optLabel = opt.getAttribute("data-md-label") || opt.textContent?.trim() || "";
    const checked = opt.querySelector(".bg-accent-amber") !== null;
    lines.push(`- [${checked ? "x" : " "}] ${optLabel}`);
  }
  lines.push("");
}

function handleUserInput(el: HTMLElement, lines: string[]) {
  const label = el.getAttribute("data-md-label") || "";
  const textarea = el.querySelector("textarea") as HTMLTextAreaElement | null;
  const value = textarea?.value?.trim() || "";
  lines.push(`**${label}:** ${value || "_empty_"}`, "");
}

function handleRangeInput(el: HTMLElement, lines: string[]) {
  const label = el.getAttribute("data-md-label") || "";
  const input = el.querySelector("input[type='range']") as HTMLInputElement | null;
  const display = el.querySelector(".font-mono");
  const value = display?.textContent?.trim() || input?.value || "—";
  lines.push(`**${label}:** ${value}`, "");
}

function handleFilePreview(el: HTMLElement, lines: string[]) {
  const path = el.getAttribute("data-md-path") || "";
  const linesAttr = el.getAttribute("data-md-lines") || "";
  const code = el.querySelector("code");
  const text = code?.textContent || "";
  const ext = path.split(".").pop() || "";
  const langMap: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    py: "python", rs: "rust", go: "go", rb: "ruby", java: "java",
    json: "json", yaml: "yaml", yml: "yaml", md: "markdown",
    css: "css", html: "html", sh: "bash", bash: "bash",
  };
  const lang = langMap[ext] || "";
  const header = linesAttr ? `${path} (L${linesAttr})` : path;
  lines.push(header, "", `\`\`\`${lang}`, text, "```", "");
}

function handlePriority(_el: HTMLElement, _lines: string[]) {
  // Priority is rendered inline within Task items — the Task handler already
  // captures it as part of child content. Skip standalone rendering to avoid
  // duplicating the bare level text (e.g. "high").
}

function extractText(el: HTMLElement): string {
  return el?.textContent?.trim() || "";
}
