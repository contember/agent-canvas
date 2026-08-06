import { describe, expect, test } from "bun:test";
import { parseSecretAssignments, spawnWithSecretEnvironment } from "./exec";

describe("secret-aware exec", () => {
  test("parses explicit environment mappings", () => {
    expect(parseSecretAssignments(["SERVICE_TOKEN=service-token", "API_KEY=api.key"])).toEqual([
      { envName: "SERVICE_TOKEN", fieldId: "service-token" },
      { envName: "API_KEY", fieldId: "api.key" },
    ]);
  });

  test("rejects invalid and duplicate environment names", () => {
    expect(() => parseSecretAssignments(["bad-name=token"])).toThrow("Invalid environment variable name");
    expect(() => parseSecretAssignments(["TOKEN=first", "TOKEN=second"])).toThrow("Duplicate environment variable mapping");
  });

  test("injects the secret into the child environment", async () => {
    const assignments = parseSecretAssignments(["RUNBOOK_TEST_TOKEN=service-token"]);
    const exitCode = await spawnWithSecretEnvironment(
      [process.execPath, "-e", "process.exit(process.env.RUNBOOK_TEST_TOKEN === 'test-value' ? 0 : 1)"],
      assignments,
      new Map([["service-token", "test-value"]]),
    );

    expect(exitCode).toBe(0);
  });
});
