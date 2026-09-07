// Hosts own frame vocabulary and delivery policy; topics are opaque to the channel.

export type ChannelRole = "browser" | "wait";

/** The minimum a host socket must offer; `Bun.ServerWebSocket` satisfies it. */
export interface ChannelSocket {
  send(message: string): unknown;
  close(): void;
  ping(): unknown;
}

export interface RelayOptions {
  /**
   * Close every waiter the message was handed to and drop the topic's waiter
   * set. Defaults to the channel's `waiterPolicy`.
   */
  close?: boolean;
}

/** Channel operations bound to one topic. */
export interface TopicChannel {
  readonly topic: string;
  /** Send to every browser on the topic. */
  broadcast(message: unknown): void;
  /** Send to every waiter on the topic; `false` when there was none. */
  relayToWaiters(message: unknown, options?: RelayOptions): boolean;
  hasWaiter(): boolean;
  /** Announce current waiter presence to the topic's browsers. */
  broadcastPresence(): void;
}

export interface BrowserFrameHandler {
  /** The bound work when the frame is this handler's, `undefined` otherwise. */
  bind(frame: unknown, channel: TopicChannel): (() => void | Promise<void>) | undefined;
}

/**
 * Register one frame of a host's vocabulary. Matching is synchronous so the
 * socket's `message` handler stays synchronous; handling may be async.
 */
export function browserFrame<T>(
  match: (frame: unknown) => frame is T,
  handle: (frame: T, channel: TopicChannel) => void | Promise<void>,
): BrowserFrameHandler {
  return {
    bind: (frame, channel) => (match(frame) ? () => handle(frame, channel) : undefined),
  };
}

export interface NotificationChannelOptions<S extends ChannelSocket> {
  /** Which registry a socket belongs to. */
  roleOf(socket: S): ChannelRole;
  /** The socket's routing key — a canvas session id, a Figma file key, … */
  topicOf(socket: S): string;
  /** The host's browser-frame vocabulary, tried in order; first match wins. */
  frames?: readonly BrowserFrameHandler[];
  /** Builds the presence frame. Presence is not announced when omitted. */
  presenceFrame?(hasWaiter: boolean, topic: string): unknown;
  /** What a relay does to the waiters it reached. Default `"keep-open"`. */
  waiterPolicy?: "close-on-delivery" | "keep-open";
  /**
   * Runs after a waiter is registered and before presence is announced, so a
   * host that buffers events for an absent waiter can flush them here.
   */
  onWaiterOpen?(channel: TopicChannel): void;
  /** Frame handler failures. Dropped when omitted. */
  onError?(error: unknown): void;
  /** Liveness sweep period; `false` leaves the sweep to the host. */
  pingIntervalMs?: number | false;
}

export interface NotificationChannel<S extends ChannelSocket> {
  handlers: {
    open(socket: S): void;
    message(socket: S, message: string | Buffer): void;
    pong(socket: S): void;
    close(socket: S): void;
  };
  broadcast(topic: string, message: unknown): void;
  relayToWaiters(topic: string, message: unknown, options?: RelayOptions): boolean;
  hasWaiter(topic: string): boolean;
  broadcastPresence(topic: string): void;
  /** The topic-bound view handed to frame handlers. */
  topic(topic: string): TopicChannel;
  /** One liveness sweep — ping live waiters, evict the ones that never ponged. */
  pingWaiters(): void;
  /** Stop the liveness timer. */
  stop(): void;
}

const DEFAULT_PING_INTERVAL_MS = 5_000;

function parseFrame(message: string | Buffer): unknown {
  const text = typeof message === "string" ? message : new TextDecoder().decode(message);
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function createNotificationChannel<S extends ChannelSocket>(
  options: NotificationChannelOptions<S>,
): NotificationChannel<S> {
  const { roleOf, topicOf } = options;
  const frames = options.frames ?? [];
  const closeOnDelivery = (options.waiterPolicy ?? "keep-open") === "close-on-delivery";
  const browserSockets = new Map<string, Set<S>>();
  const waitSockets = new Map<string, Set<S>>();
  const pongReceived = new WeakSet<S>();

  function registry(role: ChannelRole): Map<string, Set<S>> {
    return role === "browser" ? browserSockets : waitSockets;
  }

  function hasWaiter(topic: string): boolean {
    return (waitSockets.get(topic)?.size ?? 0) > 0;
  }

  function broadcast(topic: string, message: unknown): void {
    const sockets = browserSockets.get(topic);
    if (!sockets || sockets.size === 0) return;
    const payload = JSON.stringify(message);
    for (const socket of sockets) socket.send(payload);
  }

  function presencePayload(topic: string): string | undefined {
    if (!options.presenceFrame) return undefined;
    return JSON.stringify(options.presenceFrame(hasWaiter(topic), topic));
  }

  function broadcastPresence(topic: string): void {
    const payload = presencePayload(topic);
    if (payload === undefined) return;
    const sockets = browserSockets.get(topic);
    if (!sockets) return;
    for (const socket of sockets) socket.send(payload);
  }

  function relayToWaiters(topic: string, message: unknown, relay: RelayOptions = {}): boolean {
    const sockets = waitSockets.get(topic);
    if (!sockets || sockets.size === 0) return false;
    const close = relay.close ?? closeOnDelivery;
    if (close) waitSockets.delete(topic);
    const payload = JSON.stringify(message);
    for (const socket of sockets) {
      socket.send(payload);
      if (close) socket.close();
    }
    return true;
  }

  function topicChannel(topic: string): TopicChannel {
    return {
      topic,
      broadcast: (message) => broadcast(topic, message),
      relayToWaiters: (message, relay) => relayToWaiters(topic, message, relay),
      hasWaiter: () => hasWaiter(topic),
      broadcastPresence: () => broadcastPresence(topic),
    };
  }

  function reportError(error: unknown): void {
    options.onError?.(error);
  }

  function dropWaiter(topic: string, socket: S): void {
    const sockets = waitSockets.get(topic);
    if (sockets) {
      sockets.delete(socket);
      if (sockets.size === 0) waitSockets.delete(topic);
    }
    try { socket.close(); } catch {}
    broadcastPresence(topic);
  }

  // A dead socket never fires `close`, so presence would stay stuck on `true`
  // until the daemon restarts — sweep for the missing pong instead.
  function pingWaiters(): void {
    for (const [topic, sockets] of waitSockets) {
      for (const socket of sockets) {
        if (!pongReceived.has(socket)) {
          dropWaiter(topic, socket);
          continue;
        }
        pongReceived.delete(socket);
        try { socket.ping(); } catch { dropWaiter(topic, socket); }
      }
    }
  }

  const interval = options.pingIntervalMs === false
    ? undefined
    : setInterval(pingWaiters, options.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS);
  interval?.unref();

  const handlers = {
    open(socket: S): void {
      const topic = topicOf(socket);
      const role = roleOf(socket);
      const sockets = registry(role).get(topic) ?? new Set<S>();
      sockets.add(socket);
      registry(role).set(topic, sockets);

      if (role === "browser") {
        const payload = presencePayload(topic);
        if (payload !== undefined) socket.send(payload);
        return;
      }
      pongReceived.add(socket); // free pass on the first sweep
      options.onWaiterOpen?.(topicChannel(topic));
      broadcastPresence(topic);
    },

    message(socket: S, message: string | Buffer): void {
      if (roleOf(socket) !== "browser") return;
      const frame = parseFrame(message);
      if (frame === undefined) return;
      const channel = topicChannel(topicOf(socket));
      for (const handler of frames) {
        const run = handler.bind(frame, channel);
        if (!run) continue;
        try {
          const result = run();
          if (result instanceof Promise) result.catch(reportError);
        } catch (error) {
          reportError(error);
        }
        return;
      }
    },

    pong(socket: S): void {
      if (roleOf(socket) === "wait") pongReceived.add(socket);
    },

    close(socket: S): void {
      const topic = topicOf(socket);
      const role = roleOf(socket);
      const sockets = registry(role).get(topic);
      sockets?.delete(socket);
      if (sockets && sockets.size === 0) registry(role).delete(topic);
      if (role === "wait") broadcastPresence(topic);
    },
  };

  return {
    handlers,
    broadcast,
    relayToWaiters,
    hasWaiter,
    broadcastPresence,
    topic: topicChannel,
    pingWaiters,
    stop() {
      if (interval) clearInterval(interval);
    },
  };
}
