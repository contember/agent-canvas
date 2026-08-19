/**
 * The kernel ships from this repo on the same release train as the package that
 * depends on it, so three numbers must agree: the two manifest versions and the
 * range between them. Guarding it here is not pedantry — the pin started life as
 * `workspace:*`, which npm publishes verbatim, and a tarball carrying that is
 * uninstallable for everyone.
 */

import { readFileSync } from "fs";
import { join } from "path";

const KERNEL = "@fabrika/canvas-kernel";
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
const kernelPath = join(REPO_ROOT, "packages", "canvas-kernel", "package.json");

const root = readManifest(rootPath);
const kernel = readManifest(kernelPath);

const rootVersion = versionOf(root, rootPath);
const kernelVersion = versionOf(kernel, kernelPath);

const dependencies = root.dependencies;
if (!isRecord(dependencies)) throw new Error(`${rootPath}: "dependencies" is missing`);
const pin = dependencies[KERNEL];

const problems: string[] = [];

if (rootVersion !== kernelVersion) {
  problems.push(
    `Version lockstep broken: agent-canvas is ${rootVersion}, ${KERNEL} is ${kernelVersion}. ` +
      "Bump both to the same number.",
  );
}

if (pin === undefined) {
  problems.push(`agent-canvas no longer depends on ${KERNEL} — was that deliberate?`);
} else if (pin !== rootVersion) {
  problems.push(
    `agent-canvas pins ${KERNEL} at "${String(pin)}", but the release is ${rootVersion}. ` +
      "The pin must be the exact version — a range (or \"workspace:*\") ships a tarball that " +
      "resolves to the wrong kernel, or to none at all.",
  );
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`error: ${problem}`);
  process.exit(1);
}

console.log(`Release versions agree: ${rootVersion}, pinned exactly.`);
