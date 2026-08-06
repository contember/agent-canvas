import { test, expect } from "bun:test";
import { compilePlan } from "./compiler";

// Regression coverage for the error-reporting path. Bun surfaces JSX syntax
// errors through three shapes (Transpiler throw, build logs, AggregateError
// from Bun.build); all must reach the CLI as an actionable message carrying a
// position + code frame — never a bare "Parse error" / "Bundle failed".

test("syntax error reports line, column and a code frame", async () => {
  // A straight double-quote inside a double-quoted attribute terminates the
  // attribute early — the exact mistake that previously printed only
  // "Parse error" with no location.
  const result = await compilePlan(`<Section title="a "b" c">x</Section>`);

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error).toMatch(/\(line \d+, col \d+\)/);
  // Code frame: offending source line + caret.
  expect(result.error).toContain("^");
});

test("syntax error line maps back to the authored file (1-based, not offset by injected imports)", async () => {
  // Bad token on the authored 3rd line; the reported line must be small/positive,
  // not shifted by the prepended component-import preamble.
  const result = await compilePlan(`<Section title="ok">\n  <Item id="a" label="x">\n    <span a="1 "2"></span>\n  </Item>\n</Section>`);

  expect(result.ok).toBe(false);
  if (result.ok) return;
  const m = result.error.match(/\(line (\d+), col \d+\)/);
  expect(m).not.toBeNull();
  const line = Number(m![1]);
  expect(line).toBeGreaterThan(0);
  expect(line).toBeLessThan(10);
});

test("well-formed canvas compiles", async () => {
  const result = await compilePlan(`<Section title="Hello"><Item id="a" label="b">text</Item></Section>`);
  expect(result.ok).toBe(true);
});

test("runbook secret input compiles", async () => {
  const result = await compilePlan(`<SecretInput id="service-token" label="Service token" env="SERVICE_TOKEN" required />`);
  expect(result.ok).toBe(true);
});
