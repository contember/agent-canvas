import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SessionManager } from "./session";
import { createWebSocketManager, type CanvasSocket, type WSData } from "./websocket";

const testDirectories: string[] = [];

afterEach(() => {
  for (const directory of testDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

class FakeSocket implements CanvasSocket {
  readonly sent: string[] = [];
  closed = false;

  constructor(readonly data: WSData) {}

  send(message: string) {
    this.sent.push(message);
  }

  close() {
    this.closed = true;
  }

  ping() {}
}

function createSessionManager(): SessionManager {
  const directory = mkdtempSync(join(tmpdir(), "agent-canvas-websocket-test-"));
  testDirectories.push(directory);
  const manager = new SessionManager(directory);
  manager.upsert(
    "session",
    new Map([["architecture.jsx", "<Section title=\"Architecture\" />"]]),
    directory,
  );
  return manager;
}

describe("canvas render errors", () => {
  test("delivers an error that arrived before the CLI watcher connected", () => {
    const sessionManager = createSessionManager();
    const websocket = createWebSocketManager(sessionManager);
    const browser = new FakeSocket({ type: "browser", sessionId: "session" });
    websocket.handlers.open(browser);

    websocket.handlers.message(browser, JSON.stringify({
      type: "render-error",
      error: {
        revision: 1,
        filename: "architecture.jsx",
        message: "Cannot read properties of undefined (reading 'map')",
      },
    }));

    const watcher = new FakeSocket({ type: "wait", sessionId: "session" });
    websocket.handlers.open(watcher);

    expect(watcher.sent).toHaveLength(1);
    expect(JSON.parse(watcher.sent[0])).toEqual({
      type: "render-error",
      error: {
        revision: 1,
        filename: "architecture.jsx",
        message: "Cannot read properties of undefined (reading 'map')",
      },
    });
    expect(watcher.closed).toBe(true);
    expect(sessionManager.get("session")?.revisions[0].hasFeedback).toBe(false);
  });

  test("drops a pending error when a new revision is pushed", () => {
    const sessionManager = createSessionManager();
    const websocket = createWebSocketManager(sessionManager);
    const browser = new FakeSocket({ type: "browser", sessionId: "session" });
    websocket.handlers.open(browser);
    websocket.handlers.message(browser, JSON.stringify({
      type: "render-error",
      error: { revision: 1, filename: "architecture.jsx", message: "Broken revision" },
    }));

    sessionManager.upsert(
      "session",
      new Map([["architecture.jsx", "<Section title=\"Fixed\" />"]]),
      "/project",
    );
    websocket.broadcastPlanUpdate("session");

    const watcher = new FakeSocket({ type: "wait", sessionId: "session" });
    websocket.handlers.open(watcher);
    expect(watcher.sent).toEqual([]);
    expect(watcher.closed).toBe(false);
  });
});
