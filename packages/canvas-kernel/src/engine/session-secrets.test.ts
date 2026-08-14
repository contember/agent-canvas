import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SessionManager } from "./session";

const testDirectories: string[] = [];

function createManager(): SessionManager {
  const directory = mkdtempSync(join(tmpdir(), "agent-canvas-secrets-"));
  testDirectories.push(directory);
  return new SessionManager(directory);
}

function createSession(manager: SessionManager, id = "runbook"): void {
  manager.upsert(id, new Map([["runbook.jsx", "<Section title=\"Runbook\" />"]]), process.cwd());
}

function readTextFiles(directory: string): string {
  const parts: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      parts.push(readTextFiles(path));
    } else {
      parts.push(readFileSync(path, "utf-8"));
    }
  }
  return parts.join("\n");
}

afterEach(() => {
  for (const directory of testDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("session secret vault", () => {
  test("resolves a deposited secret without persisting it", () => {
    const manager = createManager();
    createSession(manager);

    expect(manager.setSecret("runbook", "service-token", "test-secret-value")).toBe(true);
    expect(manager.hasSecret("runbook", "service-token")).toBe(true);
    expect(manager.resolveSecrets("runbook", ["service-token"])).toEqual({
      ok: true,
      values: new Map([["service-token", "test-secret-value"]]),
    });
    expect(readTextFiles(testDirectories[0])).not.toContain("test-secret-value");
  });

  test("reports every missing field without returning partial values", () => {
    const manager = createManager();
    createSession(manager);
    manager.setSecret("runbook", "ready-token", "available");

    expect(manager.resolveSecrets("runbook", ["ready-token", "missing-token"])).toEqual({
      ok: false,
      missing: ["missing-token"],
    });
  });

  test("clears secrets when a new revision is pushed", () => {
    const manager = createManager();
    createSession(manager);
    manager.setSecret("runbook", "service-token", "test-secret-value");

    manager.upsert("runbook", new Map([["runbook.jsx", "<Section title=\"Updated\" />"]]), process.cwd());

    expect(manager.hasSecret("runbook", "service-token")).toBe(false);
  });

  test("clears one field without affecting the rest", () => {
    const manager = createManager();
    createSession(manager);
    manager.setSecret("runbook", "first-token", "first");
    manager.setSecret("runbook", "second-token", "second");

    expect(manager.clearSecret("runbook", "first-token")).toBe(true);
    expect(manager.hasSecret("runbook", "first-token")).toBe(false);
    expect(manager.hasSecret("runbook", "second-token")).toBe(true);
  });
});
