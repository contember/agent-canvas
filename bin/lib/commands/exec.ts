import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { parseArgs } from "util";
import { BASE_URL, CLI_AUTH_FILE } from "../config.ts";
import { ensureDaemon } from "../daemon-lifecycle.ts";
import { getSessionId } from "../helpers.ts";

const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const FIELD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export interface SecretAssignment {
  envName: string;
  fieldId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseSecretAssignments(rawAssignments: string[]): SecretAssignment[] {
  if (rawAssignments.length === 0) {
    throw new Error("At least one --secret ENV_NAME=field-id mapping is required");
  }

  const assignments: SecretAssignment[] = [];
  const environmentNames = new Set<string>();
  for (const raw of rawAssignments) {
    const separator = raw.indexOf("=");
    const envName = separator === -1 ? "" : raw.slice(0, separator);
    const fieldId = separator === -1 ? "" : raw.slice(separator + 1);
    if (!ENV_NAME_RE.test(envName)) {
      throw new Error(`Invalid environment variable name in --secret mapping: ${raw}`);
    }
    if (!FIELD_ID_RE.test(fieldId)) {
      throw new Error(`Invalid secret field ID in --secret mapping: ${raw}`);
    }
    if (environmentNames.has(envName)) {
      throw new Error(`Duplicate environment variable mapping: ${envName}`);
    }
    environmentNames.add(envName);
    assignments.push({ envName, fieldId });
  }
  return assignments;
}

async function resolveSecretValues(sessionId: string, fieldIds: string[]): Promise<Map<string, string>> {
  if (!existsSync(CLI_AUTH_FILE)) throw new Error("Canvas daemon CLI capability is unavailable");
  const cliAuthToken = readFileSync(CLI_AUTH_FILE, "utf-8").trim();
  const response = await fetch(`${BASE_URL}/api/session/${encodeURIComponent(sessionId)}/secrets/resolve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Agent-Canvas-CLI-Token": cliAuthToken,
    },
    body: JSON.stringify({ fields: fieldIds }),
  });
  const raw: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = isRecord(raw) && typeof raw.error === "string"
      ? raw.error
      : `Secret API request failed with status ${response.status}`;
    const missing = isRecord(raw) && Array.isArray(raw.missing)
      ? raw.missing.filter((field): field is string => typeof field === "string")
      : [];
    throw new Error(missing.length > 0 ? `${message}: ${missing.join(", ")}` : message);
  }
  if (!isRecord(raw) || !Array.isArray(raw.values)) {
    throw new Error("Secret API returned an invalid response");
  }

  const values = new Map<string, string>();
  for (const entry of raw.values) {
    if (!isRecord(entry) || typeof entry.id !== "string" || typeof entry.value !== "string") {
      throw new Error("Secret API returned an invalid value entry");
    }
    values.set(entry.id, entry.value);
  }
  return values;
}

function executableExists(command: string): boolean {
  if (command.includes("/")) return existsSync(resolve(command));
  return Bun.spawnSync(["which", command], { stdout: "ignore", stderr: "ignore" }).exitCode === 0;
}

export async function spawnWithSecretEnvironment(
  commandArgs: string[],
  assignments: SecretAssignment[],
  values: Map<string, string>,
): Promise<number> {
  const command = commandArgs[0];
  if (!command) throw new Error("No command specified after --");
  if (!executableExists(command)) throw new Error(`Executable not found: ${command}`);

  const environment = { ...process.env };
  for (const assignment of assignments) {
    const value = values.get(assignment.fieldId);
    if (value === undefined) throw new Error(`Secret is not ready: ${assignment.fieldId}`);
    environment[assignment.envName] = value;
  }

  const child = Bun.spawn(commandArgs, {
    env: environment,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return child.exited;
}

export async function handleExec(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      session: { type: "string" },
      secret: { type: "string", multiple: true },
    },
    allowPositionals: true,
  });

  const assignments = parseSecretAssignments(values.secret ?? []);
  if (positionals.length === 0) throw new Error("No command specified. Put the command after --");

  const sessionId = getSessionId(values.session);
  await ensureDaemon();
  const secretValues = await resolveSecretValues(sessionId, assignments.map((assignment) => assignment.fieldId));
  const exitCode = await spawnWithSecretEnvironment(positionals, assignments, secretValues);
  process.exit(exitCode);
}
