import { parseArgs } from "util";
import { existsSync, mkdirSync, cpSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { PACKAGE_ROOT } from "../config.ts";
import { readLine } from "../helpers.ts";

export async function handleInstall(args: string[]) {
  const { positionals } = parseArgs({
    args,
    allowPositionals: true,
  });

  let mode = positionals[0] as "local" | "global" | undefined;

  if (!mode) {
    process.stdout.write("Install canvas skill for Claude Code.\n\n");
    process.stdout.write("  local  — install to .claude/ in current project\n");
    process.stdout.write("  global — install to ~/.claude/ for all projects\n\n");
    process.stdout.write("Choose [local/global]: ");

    const input = await readLine();
    mode = input.trim().toLowerCase() as "local" | "global";
  }

  if (mode !== "local" && mode !== "global") {
    console.error("Error: specify 'local' or 'global'");
    process.exit(1);
  }

  const targetBase = mode === "global"
    ? join(homedir(), ".claude")
    : join(process.cwd(), ".claude");

  const skillTarget = join(targetBase, "skills", "canvas");
  mkdirSync(skillTarget, { recursive: true });

  cpSync(join(PACKAGE_ROOT, "skills", "canvas", "SKILL.md"), join(skillTarget, "SKILL.md"));

  // Clean up files from older versions
  for (const old of ["components.md", "flows.md"]) {
    const p = join(skillTarget, old);
    if (existsSync(p)) unlinkSync(p);
  }

  console.log(`  Skill installed to ${skillTarget}`);
  console.log(`\nInstalled! The /canvas command is now available in Claude Code.`);
}
