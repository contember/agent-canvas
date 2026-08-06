import { describe, expect, test } from "bun:test";
import { waitForFeedback } from "./helpers";

class FakeSocket {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  close(): void {}
}

describe("waitForFeedback", () => {
  test("reconnects after an unexpected close", async () => {
    const sockets: FakeSocket[] = [];
    const result = waitForFeedback("session", {
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        queueMicrotask(() => {
          if (sockets.length === 1) socket.onclose?.(new CloseEvent("close"));
          else socket.onmessage?.(new MessageEvent("message", { data: JSON.stringify({ type: "submit", feedback: "Done" }) }));
        });
        return socket;
      },
      timeoutMs: 1_000,
      reconnectAttempts: 1,
      reconnectDelayMs: 0,
    });

    await expect(result).resolves.toBe("Done");
    expect(sockets).toHaveLength(2);
  });

  test("rejects when the connection keeps closing", async () => {
    const result = waitForFeedback("session", {
      createSocket: () => {
        const socket = new FakeSocket();
        queueMicrotask(() => socket.onclose?.(new CloseEvent("close")));
        return socket;
      },
      timeoutMs: 1_000,
      reconnectAttempts: 2,
      reconnectDelayMs: 0,
    });

    await expect(result).rejects.toThrow("WebSocket closed before feedback was submitted.");
  });
});
