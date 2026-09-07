// Exact internal pins keep separately published source packages compatible.

import { readFileSync } from "fs";
import { join } from "path";

const packages = ["daemon-kit", "annotations", "canvas-kernel"];
const REPO_ROOT = join(import.meta.dir, "..");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readManifest(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
  if (!isRecord(parsed)) throw new Error(`${path}: not a JSON object`);
  return parsed;
}

function versionOf(manifest: Record<string, unknown>, path: string): string {
  const version = manifest.version;
  if (typeof version !== "string") throw new Error(`${path}: "version" is missing or not a string`);
  return version;
}

const rootPath = join(REPO_ROOT, "package.json");
const root = readManifest(rootPath);
const rootVersion = versionOf(root, rootPath);
const problems: string[] = [];

function checkPins(manifest: Record<string, unknown>, name: string, expected: string[]) {
  const dependencies = manifest.dependencies;
  for (const dependency of expected) {
    const pin = isRecord(dependencies) ? dependencies[dependency] : undefined;
    if (pin !== rootVersion) {
      problems.push(`${name} must pin ${dependency} at ${rootVersion}, got ${String(pin)}.`);
    }
  }
}

checkPins(root, "agent-canvas", packages.map((name) => `@fabrika/${name}`));
for (const name of packages) {
  const path = join(REPO_ROOT, "packages", name, "package.json");
  const manifest = readManifest(path);
  const version = versionOf(manifest, path);
  if (version !== rootVersion) {
    problems.push(`Version lockstep broken: agent-canvas is ${rootVersion}, @fabrika/${name} is ${version}.`);
  }
  if (name === "canvas-kernel") {
    checkPins(manifest, "@fabrika/canvas-kernel", ["@fabrika/annotations", "@fabrika/daemon-kit"]);
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`error: ${problem}`);
  process.exit(1);
}

console.log(`Release versions agree: ${rootVersion}, pinned exactly.`);
