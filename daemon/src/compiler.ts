import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { COMPILE_TEMP_DIR } from "./paths";

type CompileResult =
  | { ok: true; js: string }
  | { ok: false; error: string };

const COMPONENT_IMPORTS = `import React from 'react';
import * as C from '#canvas/components';
import { useFeedback } from '#canvas/runtime';
const { Section, Item, Task, FilePreview, CodeBlock, Callout,
        Mermaid, Table, Priority, Checklist, Note, Diff,
        Choice, MultiChoice, UserInput, RangeInput } = C;
`;

export async function compilePlan(jsx: string): Promise<CompileResult> {
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
