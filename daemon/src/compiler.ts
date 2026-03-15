import { writeFileSync, unlinkSync, readFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { COMPILE_TEMP_DIR } from "./paths";

type CompileResult =
  | { ok: true; js: string }
  | { ok: false; error: string };

const COMPONENT_IMPORTS = `import React from 'react';
import * as C from '#canvas/components';
const { Section, Item, Task, FilePreview, CodeBlock, Callout,
        Mermaid, Table, Priority, Checklist, Note, Diff,
        Choice, MultiChoice, UserInput, RangeInput, ImageView,
        Markdown, useFeedback, useAnnotations } = C;
`;

export async function compilePlan(jsx: string, projectRoot?: string): Promise<CompileResult> {
  // Resolve file contents at compile time
  if (projectRoot) {
    jsx = resolveFilePreviews(jsx, projectRoot);
    jsx = resolveMarkdownFiles(jsx, projectRoot);
  }

  const hasDefaultExport = /export\s+default\b/.test(jsx);

  const source = hasDefaultExport
    ? `${COMPONENT_IMPORTS}\n${jsx}`
    : `${COMPONENT_IMPORTS}\nexport default function Plan() {\n  return (<>${jsx}</>);\n}\n`;

  const tmpFile = join(COMPILE_TEMP_DIR, `plan-${randomUUID()}.jsx`);

  try {
    writeFileSync(tmpFile, source);

    const result = await Bun.build({
      entrypoints: [tmpFile],
      format: "esm",
      external: ["react", "react-dom", "#canvas/components", "#canvas/runtime"],
    });

    if (!result.success) {
      const errors = result.logs
        .filter((l) => l.level === "error")
        .map((l) => l.message)
        .join("\n");
      return { ok: false, error: errors || "Compilation failed" };
    }

    const js = await result.outputs[0].text();
    return { ok: true, js };
  } catch (e: any) {
    return { ok: false, error: e.message };
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

/**
 * Find <Markdown file="..." /> tags and inject __content with the file contents
 * resolved at compile time.
 */
function resolveMarkdownFiles(jsx: string, projectRoot: string): string {
  return jsx.replace(
    /<Markdown\b([^>]*?)\/>/g,
    (match, attrs: string) => {
      const fileMatch = attrs.match(/file=["']([^"']+)["']/);
      if (!fileMatch) return match;

      const filePath = fileMatch[1];
      const absPath = join(projectRoot, filePath);

      try {
        const content = readFileSync(absPath, "utf-8");
        const escaped = JSON.stringify(content);
        return `<Markdown${attrs} __content={${escaped}} />`;
      } catch {
        return match;
      }
    }
  );
}

/**
 * Find <FilePreview path="..." /> tags and inject __content with the file contents
 * resolved at compile time so the browser doesn't need to fetch.
 */
function resolveFilePreviews(jsx: string, projectRoot: string): string {
  // Match <FilePreview ... /> (self-closing)
  return jsx.replace(
    /<FilePreview\b([^>]*?)\/>/g,
    (match, attrs: string) => {
      const pathMatch = attrs.match(/path=["']([^"']+)["']/);
      if (!pathMatch) return match;

      const filePath = pathMatch[1];
      const absPath = join(projectRoot, filePath);

      try {
        let content = readFileSync(absPath, "utf-8");

        // Apply lines filter if present
        const linesMatch = attrs.match(/lines=\{?\[(\d+)\s*,\s*(\d+)\]\}?/);
        if (linesMatch) {
          const start = parseInt(linesMatch[1], 10);
          const end = parseInt(linesMatch[2], 10);
          content = content.split("\n").slice(start - 1, end).join("\n");
        }

        // Escape for embedding in JSX string
        const escaped = JSON.stringify(content);
        return `<FilePreview${attrs} __content={${escaped}} />`;
      } catch {
        return match;
      }
    }
  );
}
