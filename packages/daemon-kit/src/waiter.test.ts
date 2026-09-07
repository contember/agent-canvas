import { describe, expect, test } from "bun:test";
import { waitForEvent, WaitError, type WaiterSocket, type WaitVerdict } from "./waiter";

class FakeSocket implements WaiterSocket {
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  closed = false;

  close(): void {
    this.closed = true;
  }

  open(): void {
    this.onopen?.(new Event("open"));
  }

  deliver(frame: unknown): void {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(frame) }));
  }

  drop(): void {
    this.onclose?.(new CloseEvent("close"));
  }

  fail(): void {
    this.onerror?.(new Event("error"));
  }
}

/** Settles on `{ type: "done", value }`, fails on `{ type: "broken" }`, rechecks on `{ type: "run" }`. */
function readFrame(frame: unknown): WaitVerdict<string> | undefined {
  if (typeof frame !== "object" || frame === null || !("type" in frame)) return undefined;
  if (frame.type === "done" && "value" in frame && typeof frame.value === "string") {
    return { type: "settle", value: frame.value };
  }
  if (frame.type === "broken") return { type: "fail", error: new Error("the canvas is broken") };
  if (frame.type === "run") return { type: "recheck" };
  return undefined;
}

describe("settling", () => {
  test("a settling frame resolves and closes the socket", async () => {
    const sockets: FakeSocket[] = [];
    const result = await waitForEvent<string>({
      url: "ws://localhost/ws/wait/topic",
      onFrame: readFrame,
      timeoutMs: 1_000,
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        queueMicrotask(() => socket.deliver({ type: "done", value: "answered" }));
        return socket;
      },
    });

    expect(result).toBe("answered");
    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.closed).toBe(true);
  });

  test("frames the host does not claim are ignored", async () => {
    const result = await waitForEvent<string>({
      url: "ws://localhost/ws/wait/topic",
      onFrame: readFrame,
      timeoutMs: 1_000,
      createSocket: () => {
        const socket = new FakeSocket();
        queueMicrotask(() => {
          socket.onmessage?.(new MessageEvent("message", { data: "not json" }));
          socket.deliver({ type: "other" });
          socket.deliver({ type: "done", value: "answered" });
        });
        return socket;
      },
    });

    expect(result).toBe("answered");
  });

  test("a failing frame rejects without reconnecting", async () => {
    const sockets: FakeSocket[] = [];
    const result = waitForEvent<string>({
      url: "ws://localhost/ws/wait/topic",
      onFrame: readFrame,
      timeoutMs: 1_000,
      reconnect: { attempts: 3, delayMs: 0 },
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        queueMicrotask(() => socket.deliver({ type: "broken" }));
        return socket;
      },
    });

    await expect(result).rejects.toThrow("the canvas is broken");
    expect(sockets).toHaveLength(1);
  });
});

describe("reconnect", () => {
  test("reconnects after a dropped connection", async () => {
    const sockets: FakeSocket[] = [];
    const result = waitForEvent<string>({
      url: "ws://localhost/ws/wait/topic",
      onFrame: readFrame,
      timeoutMs: 1_000,
      reconnect: { attempts: 1, delayMs: 0 },
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        queueMicrotask(() => {
          if (sockets.length === 1) socket.drop();
          else socket.deliver({ type: "done", value: "second try" });
        });
        return socket;
      },
    });

    await expect(result).resolves.toBe("second try");
    expect(sockets).toHaveLength(2);
  });

  test("gives up after the configured attempts", async () => {
    const sockets: FakeSocket[] = [];
    const result = waitForEvent<string>({
      url: "ws://localhost/ws/wait/topic",
      onFrame: readFrame,
      timeoutMs: 1_000,
      reconnect: { attempts: 2, delayMs: 0 },
      messages: { closed: "socket closed early" },
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        queueMicrotask(() => socket.drop());
        return socket;
      },
    });

    await expect(result).rejects.toThrow("socket closed early");
    expect(sockets).toHaveLength(3);
  });

  test("a socket that cannot be created is retried", async () => {
    let attempts = 0;
    const result = await waitForEvent<string>({
      url: "ws://localhost/ws/wait/topic",
      onFrame: readFrame,
      timeoutMs: 1_000,
      reconnect: { attempts: 1, delayMs: 0 },
      createSocket: () => {
        attempts++;
        if (attempts === 1) throw new Error("connection refused");
        const socket = new FakeSocket();
        queueMicrotask(() => socket.deliver({ type: "done", value: "late" }));
        return socket;
      },
    });

    expect(result).toBe("late");
    expect(attempts).toBe(2);
  });

  test("the deadline spans reconnects", async () => {
    const result = waitForEvent<string>({
      url: "ws://localhost/ws/wait/topic",
      onFrame: readFrame,
      timeoutMs: 20,
      reconnect: { attempts: 50, delayMs: 5 },
      messages: { timeout: "waited long enough" },
      createSocket: () => {
        const socket = new FakeSocket();
        queueMicrotask(() => socket.drop());
        return socket;
      },
    });

    await expect(result).rejects.toThrow("waited long enough");
  });

  test("a timeout is not retryable", async () => {
    const result = waitForEvent<string>({
      url: "ws://localhost/ws/wait/topic",
      onFrame: readFrame,
      timeoutMs: 5,
      reconnect: { attempts: 3, delayMs: 0 },
      createSocket: () => new FakeSocket(),
    });

    await expect(result).rejects.toBeInstanceOf(WaitError);
    await result.catch((error: unknown) => {
      expect(error instanceof WaitError && error.retryable).toBe(false);
      expect(error instanceof WaitError && error.reason).toBe("timeout");
    });
  });
});

describe("connection failures", () => {
  test("a socket that could not be created is told apart from one that errored", async () => {
    const failed = waitForEvent<string>({
      url: "ws://localhost/ws/wait/topic",
      onFrame: readFrame,
      timeoutMs: 1_000,
      messages: { socketCreateFailed: "Could not open the wait socket" },
      createSocket: () => { throw new Error("connection refused"); },
    });

    await expect(failed).rejects.toThrow("Could not open the wait socket: connection refused");
    await failed.catch((error: unknown) => {
      expect(error instanceof WaitError && error.reason).toBe("socket-create-failed");
      expect(error instanceof WaitError && error.retryable).toBe(true);
    });

    const errored = waitForEvent<string>({
      url: "ws://localhost/ws/wait/topic",
      onFrame: readFrame,
      timeoutMs: 1_000,
      messages: { connectionFailed: "the wait socket failed" },
      createSocket: () => {
        const socket = new FakeSocket();
        queueMicrotask(() => socket.fail());
        return socket;
      },
    });

    await expect(errored).rejects.toThrow("the wait socket failed");
    await errored.catch((error: unknown) => {
      expect(error instanceof WaitError && error.reason).toBe("connection-failed");
    });
  });
});

describe("probe", () => {
  test("state that is already settled needs no socket", async () => {
    let created = 0;
    const result = await waitForEvent<string>({
      url: "ws://localhost/ws/wait/topic",
      onFrame: readFrame,
      timeoutMs: 1_000,
      probe: async () => ({ value: "already there" }),
      createSocket: () => {
        created++;
        return new FakeSocket();
      },
    });

    expect(result).toBe("already there");
    expect(created).toBe(0);
  });

  test("the re-read on open closes the subscribe race", async () => {
    let probes = 0;
    const result = await waitForEvent<string>({
      url: "ws://localhost/ws/wait/topic",
      onFrame: readFrame,
      timeoutMs: 1_000,
      // Nothing yet when the wait starts; landed by the time the socket is up.
      probe: async () => (++probes === 1 ? undefined : { value: "landed in the gap" }),
      createSocket: () => {
        const socket = new FakeSocket();
        queueMicrotask(() => socket.open());
        return socket;
      },
    });

    expect(result).toBe("landed in the gap");
    expect(probes).toBe(2);
  });

  test("a recheck frame re-reads instead of settling", async () => {
    let probes = 0;
    const result = await waitForEvent<string>({
      url: "ws://localhost/ws/wait/topic",
      onFrame: readFrame,
      timeoutMs: 1_000,
      probe: async () => (probes++ < 2 ? undefined : { value: "claimed" }),
      createSocket: () => {
        const socket = new FakeSocket();
        queueMicrotask(() => {
          socket.open();
          socket.deliver({ type: "run" });
        });
        return socket;
      },
    });

    expect(result).toBe("claimed");
  });

  test("alreadyProbed starts at the socket but keeps the re-read on open", async () => {
    const probed: string[] = [];
    const result = await waitForEvent<string>({
      url: "ws://localhost/ws/wait/topic",
      onFrame: readFrame,
      timeoutMs: 1_000,
      // The caller made this read itself before calling, so only the on-open one is left.
      alreadyProbed: true,
      probe: async () => {
        probed.push("read");
        return { value: "read on open" };
      },
      createSocket: () => {
        const socket = new FakeSocket();
        queueMicrotask(() => socket.open());
        return socket;
      },
    });

    expect(result).toBe("read on open");
    expect(probed).toHaveLength(1);
  });

  test("alreadyProbed still rechecks on a waking frame", async () => {
    let probes = 0;
    const result = await waitForEvent<string>({
      url: "ws://localhost/ws/wait/topic",
      onFrame: readFrame,
      timeoutMs: 1_000,
      alreadyProbed: true,
      probe: async () => (++probes < 2 ? undefined : { value: "claimed" }),
      createSocket: () => {
        const socket = new FakeSocket();
        queueMicrotask(() => {
          socket.open();
          socket.deliver({ type: "run" });
        });
        return socket;
      },
    });

    expect(result).toBe("claimed");
    expect(probes).toBe(2);
  });

  test("a failing probe does not settle the wait", async () => {
    const result = await waitForEvent<string>({
      url: "ws://localhost/ws/wait/topic",
      onFrame: readFrame,
      timeoutMs: 1_000,
      probe: async () => { throw new Error("daemon unreachable"); },
      createSocket: () => {
        const socket = new FakeSocket();
        queueMicrotask(() => {
          socket.open();
          socket.deliver({ type: "done", value: "from the socket" });
        });
        return socket;
      },
    });

    expect(result).toBe("from the socket");
  });
});
