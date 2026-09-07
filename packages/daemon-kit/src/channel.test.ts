import { describe, expect, test } from "bun:test";
import {
  browserFrame,
  createNotificationChannel,
  type ChannelRole,
  type NotificationChannelOptions,
  type TopicChannel,
} from "./channel";

interface FakeData {
  role: ChannelRole;
  topic: string;
}

class FakeSocket {
  readonly sent: string[] = [];
  closed = false;
  pings = 0;

  constructor(readonly data: FakeData) {}

  send(message: string) {
    this.sent.push(message);
  }

  close() {
    this.closed = true;
  }

  ping() {
    this.pings++;
  }

  frames(): unknown[] {
    return this.sent.map((message) => JSON.parse(message));
  }
}

function browser(topic: string) {
  return new FakeSocket({ role: "browser", topic });
}

function waiter(topic: string) {
  return new FakeSocket({ role: "wait", topic });
}

type Overrides = Omit<NotificationChannelOptions<FakeSocket>, "roleOf" | "topicOf">;

function createChannel(overrides: Overrides = {}) {
  return createNotificationChannel<FakeSocket>({
    roleOf: (socket) => socket.data.role,
    topicOf: (socket) => socket.data.topic,
    pingIntervalMs: false, // sweeps are driven by the test
    ...overrides,
  });
}

interface PingFrame {
  type: "ping";
  note: string;
}

function isPingFrame(value: unknown): value is PingFrame {
  return typeof value === "object" && value !== null
    && "type" in value && value.type === "ping"
    && "note" in value && typeof value.note === "string";
}

describe("registry", () => {
  test("a broadcast reaches only the browsers on that topic", () => {
    const channel = createChannel();
    const first = browser("a");
    const second = browser("a");
    const other = browser("b");
    const listener = waiter("a");
    for (const socket of [first, second, other, listener]) channel.handlers.open(socket);

    channel.broadcast("a", { type: "hello" });

    expect(first.frames()).toEqual([{ type: "hello" }]);
    expect(second.frames()).toEqual([{ type: "hello" }]);
    expect(other.frames()).toEqual([]);
    expect(listener.frames()).toEqual([]);
  });

  test("a closed socket is deregistered", () => {
    const channel = createChannel();
    const socket = browser("a");
    channel.handlers.open(socket);
    channel.handlers.close(socket);

    channel.broadcast("a", { type: "hello" });
    expect(socket.frames()).toEqual([]);
  });
});

describe("waiter policy", () => {
  test("keep-open leaves waiters registered for the next relay", () => {
    const channel = createChannel();
    const listener = waiter("a");
    channel.handlers.open(listener);

    expect(channel.relayToWaiters("a", { type: "run" })).toBe(true);
    expect(channel.relayToWaiters("a", { type: "run" })).toBe(true);
    expect(listener.frames()).toEqual([{ type: "run" }, { type: "run" }]);
    expect(listener.closed).toBe(false);
  });

  test("close-on-delivery closes and drops the waiters it reached", () => {
    const channel = createChannel({ waiterPolicy: "close-on-delivery" });
    const listener = waiter("a");
    channel.handlers.open(listener);

    expect(channel.relayToWaiters("a", { type: "submit" })).toBe(true);
    expect(listener.closed).toBe(true);
    expect(channel.hasWaiter("a")).toBe(false);
    expect(channel.relayToWaiters("a", { type: "submit" })).toBe(false);
  });

  test("a per-relay override beats the channel policy", () => {
    const channel = createChannel({ waiterPolicy: "close-on-delivery" });
    const listener = waiter("a");
    channel.handlers.open(listener);

    channel.relayToWaiters("a", { type: "feedback" }, { close: false });
    expect(listener.closed).toBe(false);
    expect(channel.hasWaiter("a")).toBe(true);
  });

  test("a relay with no waiter reports it", () => {
    const channel = createChannel();
    expect(channel.relayToWaiters("a", { type: "run" })).toBe(false);
  });
});

describe("presence", () => {
  const presence: Overrides = { presenceFrame: (hasWaiter) => ({ type: "presence", hasWaiter }) };

  test("a joining browser is told the current presence", () => {
    const channel = createChannel(presence);
    channel.handlers.open(waiter("a"));

    const observer = browser("a");
    channel.handlers.open(observer);
    expect(observer.frames()).toEqual([{ type: "presence", hasWaiter: true }]);
  });

  test("browsers are told when a waiter arrives and leaves", () => {
    const channel = createChannel(presence);
    const observer = browser("a");
    channel.handlers.open(observer);

    const listener = waiter("a");
    channel.handlers.open(listener);
    channel.handlers.close(listener);

    expect(observer.frames()).toEqual([
      { type: "presence", hasWaiter: false },
      { type: "presence", hasWaiter: true },
      { type: "presence", hasWaiter: false },
    ]);
  });

  test("nothing is announced without a presence frame", () => {
    const channel = createChannel();
    const observer = browser("a");
    channel.handlers.open(observer);
    channel.handlers.open(waiter("a"));
    expect(observer.frames()).toEqual([]);
  });

  test("onWaiterOpen runs before presence, so a flush is announced as it left", () => {
    const seen: boolean[] = [];
    const channel = createChannel({
      ...presence,
      waiterPolicy: "close-on-delivery",
      onWaiterOpen: (topic: TopicChannel) => {
        seen.push(topic.hasWaiter());
        topic.relayToWaiters({ type: "held" });
      },
    });
    const observer = browser("a");
    channel.handlers.open(observer);
    observer.sent.length = 0;

    const listener = waiter("a");
    channel.handlers.open(listener);

    expect(seen).toEqual([true]);
    expect(listener.frames()).toEqual([{ type: "held" }]);
    expect(observer.frames()).toEqual([{ type: "presence", hasWaiter: false }]);
  });
});

describe("browser frames", () => {
  test("a matching frame runs its handler with the topic channel", () => {
    const handled: string[] = [];
    const channel = createChannel({
      frames: [browserFrame(isPingFrame, (frame, topic) => {
        handled.push(`${topic.topic}:${frame.note}`);
        topic.broadcast({ type: "pong" });
      })],
    });
    const sender = browser("a");
    channel.handlers.open(sender);

    channel.handlers.message(sender, JSON.stringify({ type: "ping", note: "hi" }));

    expect(handled).toEqual(["a:hi"]);
    expect(sender.frames()).toEqual([{ type: "pong" }]);
  });

  test("frames are read from a Buffer too", () => {
    const handled: string[] = [];
    const channel = createChannel({
      frames: [browserFrame(isPingFrame, (frame) => { handled.push(frame.note); })],
    });
    const sender = browser("a");
    channel.handlers.open(sender);

    channel.handlers.message(sender, Buffer.from(JSON.stringify({ type: "ping", note: "buffered" })));
    expect(handled).toEqual(["buffered"]);
  });

  test("malformed and unknown frames are ignored", () => {
    const handled: string[] = [];
    const channel = createChannel({
      frames: [browserFrame(isPingFrame, (frame) => { handled.push(frame.note); })],
    });
    const sender = browser("a");
    channel.handlers.open(sender);

    channel.handlers.message(sender, "not json");
    channel.handlers.message(sender, JSON.stringify({ type: "ping" }));
    channel.handlers.message(sender, JSON.stringify({ type: "other", note: "x" }));
    expect(handled).toEqual([]);
  });

  test("only the first matching handler runs", () => {
    const handled: string[] = [];
    const channel = createChannel({
      frames: [
        browserFrame(isPingFrame, () => { handled.push("first"); }),
        browserFrame(isPingFrame, () => { handled.push("second"); }),
      ],
    });
    const sender = browser("a");
    channel.handlers.open(sender);

    channel.handlers.message(sender, JSON.stringify({ type: "ping", note: "hi" }));
    expect(handled).toEqual(["first"]);
  });

  test("a waiter cannot drive the host's vocabulary", () => {
    const handled: string[] = [];
    const channel = createChannel({
      frames: [browserFrame(isPingFrame, (frame) => { handled.push(frame.note); })],
    });
    const listener = waiter("a");
    channel.handlers.open(listener);

    channel.handlers.message(listener, JSON.stringify({ type: "ping", note: "hi" }));
    expect(handled).toEqual([]);
  });

  test("a rejected async handler reaches onError", async () => {
    const errors: unknown[] = [];
    const channel = createChannel({
      frames: [browserFrame(isPingFrame, async () => { throw new Error("boom"); })],
      onError: (error) => { errors.push(error); },
    });
    const sender = browser("a");
    channel.handlers.open(sender);

    channel.handlers.message(sender, JSON.stringify({ type: "ping", note: "hi" }));
    await Bun.sleep(0);
    expect(errors.map((error) => (error instanceof Error ? error.message : error))).toEqual(["boom"]);
  });

  test("a throwing handler reaches onError", () => {
    const errors: unknown[] = [];
    const channel = createChannel({
      frames: [browserFrame(isPingFrame, () => { throw new Error("sync boom"); })],
      onError: (error) => { errors.push(error); },
    });
    const sender = browser("a");
    channel.handlers.open(sender);

    channel.handlers.message(sender, JSON.stringify({ type: "ping", note: "hi" }));
    expect(errors.map((error) => (error instanceof Error ? error.message : error))).toEqual(["sync boom"]);
  });
});

describe("liveness", () => {
  test("a waiter that never pongs is evicted and announced", () => {
    const channel = createChannel({ presenceFrame: (hasWaiter) => ({ type: "presence", hasWaiter }) });
    const observer = browser("a");
    const listener = waiter("a");
    channel.handlers.open(observer);
    channel.handlers.open(listener);
    observer.sent.length = 0;

    channel.pingWaiters(); // first sweep: the free pass is spent
    expect(listener.pings).toBe(1);
    expect(channel.hasWaiter("a")).toBe(true);

    channel.pingWaiters(); // second sweep: no pong came back
    expect(listener.closed).toBe(true);
    expect(channel.hasWaiter("a")).toBe(false);
    expect(observer.frames()).toEqual([{ type: "presence", hasWaiter: false }]);
  });

  test("a waiter that pongs survives every sweep", () => {
    const channel = createChannel();
    const listener = waiter("a");
    channel.handlers.open(listener);

    for (let sweep = 0; sweep < 3; sweep++) {
      channel.pingWaiters();
      channel.handlers.pong(listener);
    }

    expect(listener.closed).toBe(false);
    expect(listener.pings).toBe(3);
    expect(channel.hasWaiter("a")).toBe(true);
  });

  test("browsers are never pinged", () => {
    const channel = createChannel();
    const observer = browser("a");
    channel.handlers.open(observer);

    channel.pingWaiters();
    channel.pingWaiters();
    expect(observer.pings).toBe(0);
    expect(observer.closed).toBe(false);
  });
});
