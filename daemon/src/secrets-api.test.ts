import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createApiHandlers } from "./handlers/api";
import { SessionManager } from "@fabrika/canvas-kernel/server";
import { dispatch, type Route } from "@fabrika/daemon-kit";

const testDirectories: string[] = [];

function setup(): { routes: Route[]; sessionId: string } {
  const directory = mkdtempSync(join(tmpdir(), "agent-canvas-secret-api-"));
  testDirectories.push(directory);
  const sessionManager = new SessionManager(directory);
  const sessionId = "runbook";
  sessionManager.upsert(sessionId, new Map([["runbook.jsx", "<Section title=\"Runbook\" />"]]), process.cwd());
  const routes = createApiHandlers({
    sessionManager,
    broadcastPlanUpdate: () => {},
    broadcastRevisionUpdate: () => {},
    port: 19400,
    version: "test",
    cliAuthToken: "test-cli-capability",
  });
  return { routes, sessionId };
}

async function call(routes: Route[], method: string, path: string, body?: unknown): Promise<Response> {
  const url = new URL(`http://localhost:19400${path}`);
  const request = new Request(url, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const response = dispatch(routes, request, url);
  if (!response) throw new Error(`No route for ${method} ${path}`);
  return response;
}

afterEach(() => {
  for (const directory of testDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("local secret API", () => {
  test("stores readiness metadata separately from the resolved value", async () => {
    const { routes, sessionId } = setup();
    const base = `/api/session/${sessionId}/secrets/service-token`;

    const stored = await call(routes, "POST", `${base}/value`, { value: "test-secret-value" });
    expect(stored.status).toBe(200);
    expect(stored.headers.get("Cache-Control")).toBe("no-store");

    const status = await call(routes, "GET", `${base}/status`);
    const statusText = await status.text();
    expect(statusText).toContain('"ready":true');
    expect(statusText).not.toContain("test-secret-value");

    const resolveUrl = new URL(`http://localhost:19400/api/session/${sessionId}/secrets/resolve`);
    const resolveRequest = new Request(resolveUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Agent-Canvas-CLI-Token": "test-cli-capability",
      },
      body: JSON.stringify({ fields: ["service-token"] }),
    });
    const resolveResponse = dispatch(routes, resolveRequest, resolveUrl);
    if (!resolveResponse) throw new Error("No secret resolve route");
    const resolved = await resolveResponse;
    expect(await resolved.json()).toEqual({
      values: [{ id: "service-token", value: "test-secret-value" }],
    });
  });

  test("returns missing field IDs without partial secret values", async () => {
    const { routes, sessionId } = setup();
    await call(routes, "POST", `/api/session/${sessionId}/secrets/ready-token/value`, { value: "available" });

    const url = new URL(`http://localhost:19400/api/session/${sessionId}/secrets/resolve`);
    const request = new Request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Agent-Canvas-CLI-Token": "test-cli-capability",
      },
      body: JSON.stringify({ fields: ["ready-token", "missing-token"] }),
    });
    const routed = dispatch(routes, request, url);
    if (!routed) throw new Error("No secret resolve route");
    const response = await routed;

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Required secrets are not ready",
      missing: ["missing-token"],
    });
  });

  test("clears a stored value without returning it", async () => {
    const { routes, sessionId } = setup();
    const base = `/api/session/${sessionId}/secrets/service-token`;
    await call(routes, "POST", `${base}/value`, { value: "test-secret-value" });

    const cleared = await call(routes, "DELETE", `${base}/value`);
    expect(await cleared.json()).toEqual({ ok: true, ready: false });
    expect(await (await call(routes, "GET", `${base}/status`)).json()).toEqual({ ready: false });
  });

  test("does not expose resolved values to same-origin browser code", async () => {
    const { routes, sessionId } = setup();
    await call(routes, "POST", `/api/session/${sessionId}/secrets/service-token/value`, { value: "test-secret-value" });

    const response = await call(routes, "POST", `/api/session/${sessionId}/secrets/resolve`, {
      fields: ["service-token"],
    });

    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("test-secret-value");
  });
});
