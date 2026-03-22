import { parseArgs } from "util";
import { existsSync, statSync } from "fs";
import { resolve, basename } from "path";
import { BASE_URL } from "../config.ts";
import { ensureDaemon } from "../daemon-lifecycle.ts";
import { getSessionId, openBrowser } from "../helpers.ts";

export async function handlePush(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    options: {
      session: { type: "string" },
      label: { type: "string" },
      response: { type: "string" },
    },
    allowPositionals: true,
  });

  const target = positionals[0];
  if (!target) {
    console.error("Error: No directory specified. Usage: agent-canvas push <directory>");
    process.exit(1);
  }

  const resolvedPath = resolve(target);
  if (!existsSync(resolvedPath)) {
    console.error(`Error: Path not found: ${resolvedPath}`);
    process.exit(1);
  }

  if (statSync(resolvedPath).isFile()) {
    console.error(`Error: Expected a directory, got a file: ${resolvedPath}`);
    console.error("Usage: agent-canvas push <directory>");
    process.exit(1);
  }

  const sessionId = getSessionId(values.session);
  const projectRoot = process.env.CANVAS_PROJECT_ROOT || process.cwd();
  const label = values.label;
  const autoLabel = !label ? basename(resolvedPath) : undefined;

  await ensureDaemon();

  const response = await fetch(`${BASE_URL}/api/session/${sessionId}/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      directory: resolvedPath,
      projectRoot,
      label: label || autoLabel,
      ...(values.response ? { response: values.response } : {}),
    }),
  });

  const result = await response.json() as any;

  if (!result.ok) {
    if (result.unconsumedFeedback) {
      console.error(`Error: ${result.error}`);
      console.log(result.unconsumedFeedback);
    } else {
      console.error(`Compilation error:\n${result.error}`);
      if (result.errors) {
        for (const [file, err] of Object.entries(result.errors)) {
          console.error(`  ${file}: ${err}`);
        }
      }
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
    canvasFiles: result.canvasFiles,
  }));
}
