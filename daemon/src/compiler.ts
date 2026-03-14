import { mkdirSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";

type CompileResult =
  | { ok: true; js: string }
  | { ok: false; error: string };

const TEMP_DIR = join(homedir(), ".planner", "tmp");
mkdirSync(TEMP_DIR, { recursive: true });

export async function compilePlan(jsx: string): Promise<CompileResult> {
  const wrapped = `
import React from 'react';
import * as C from '@planner/components';
const { Section, Task, FilePreview, CodeBlock, Callout,
        Mermaid, Table, Priority, Checklist, Note, Diff,
        Choice, MultiChoice, UserInput, RangeInput } = C;
export default function Plan() {
  return (<>${jsx}</>);
}
`;

  const tmpFile = join(TEMP_DIR, `plan-${randomUUID()}.jsx`);

  try {
    writeFileSync(tmpFile, wrapped);

    const result = await Bun.build({
      entrypoints: [tmpFile],
      format: "esm",
      external: ["react", "react-dom", "@planner/components", "@planner/runtime"],
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
