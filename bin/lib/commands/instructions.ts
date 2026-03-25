import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { PACKAGE_ROOT } from "../config.ts";

const INSTRUCTIONS_DIR = join(PACKAGE_ROOT, "bin", "lib", "instructions");

export async function handleInstructions(args: string[]) {
  const topic = args[0];

  if (!topic) {
    // Base instructions — overview
    const overview = readFileSync(join(INSTRUCTIONS_DIR, "overview.md"), "utf-8");
    process.stdout.write(overview);
    return;
  }

  if (topic === "--list") {
    printAvailableTopics(process.stdout);
    return;
  }

  // Try exact match: topic.md
  const file = join(INSTRUCTIONS_DIR, `${topic}.md`);
  if (existsSync(file)) {
    const content = readFileSync(file, "utf-8");
    process.stdout.write(content);
    return;
  }

  // Not found
  console.error(`Unknown topic: ${topic}\n`);
  printAvailableTopics(process.stderr);
  process.exit(1);
}

function printAvailableTopics(out: NodeJS.WriteStream) {
  const files = readdirSync(INSTRUCTIONS_DIR)
    .filter(f => f.endsWith(".md") && f !== "overview.md")
    .map(f => f.replace(".md", ""))
    .sort();

  const components = files.filter(f => f.startsWith("component-"));
  const flows = files.filter(f => f.startsWith("flow-"));
  const other = files.filter(f => !f.startsWith("component-") && !f.startsWith("flow-"));

  const lines: string[] = ["## Available Detail Topics", ""];

  if (components.length) {
    lines.push("### Components");
    for (const c of components) lines.push(`- \`${c}\``);
    lines.push("");
  }
  if (flows.length) {
    lines.push("### Flows");
    for (const f of flows) lines.push(`- \`${f}\``);
    lines.push("");
  }
  if (other.length) {
    lines.push("### Other");
    for (const o of other) lines.push(`- \`${o}\``);
    lines.push("");
  }

  lines.push("Usage: `bunx agent-canvas instructions <topic>`");
  out.write(lines.join("\n") + "\n");
}
