import { parseArgs } from "util";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { BASE_URL } from "../config.ts";
import { ensureDaemon } from "../daemon-lifecycle.ts";
import { getSessionId, openBrowser } from "../helpers.ts";

export async function handlePush(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    options: {
      session: { type: "string" },
      label: { type: "string" },
    },
    allowPositionals: true,
  });

  const filePath = positionals[0];
  if (!filePath) {
    console.error("Error: No file specified. Usage: agent-canvas push <file.jsx>");
    process.exit(1);
  }

  const resolvedPath = resolve(filePath);
  if (!existsSync(resolvedPath)) {
    console.error(`Error: File not found: ${resolvedPath}`);
    process.exit(1);
  }
  const jsx = readFileSync(resolvedPath, "utf-8");

  const sessionId = getSessionId(values.session);
  const projectRoot = process.env.CANVAS_PROJECT_ROOT || process.cwd();
  const label = values.label;
  const autoLabel = !label ? resolvedPath.split("/").pop()?.replace(/\.jsx$/, "") : undefined;

  await ensureDaemon();

  const response = await fetch(`${BASE_URL}/api/session/${sessionId}/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsx, projectRoot, label: label || autoLabel, sourceFile: resolvedPath.split("/").pop() }),
  });

  const result = await response.json() as any;

  if (!result.ok) {
    if (result.unconsumedFeedback) {
      console.error(`Error: ${result.error}`);
      console.log(result.unconsumedFeedback);
    } else {
      console.error(`Compilation error:\n${result.error}`);
    }
    process.exit(1);
  }

  if (result.isNew) {
    openBrowser(result.browserUrl);
  }

  console.log(JSON.stringify({
    ok: true,
    browserUrl: result.browserUrl,
    revision: result.revision,
    sessionId,
  }));
}
