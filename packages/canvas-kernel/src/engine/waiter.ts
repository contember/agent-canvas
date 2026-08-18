/**
 * The CLI half of the notification channel: connect to a daemon's wait socket
 * and block until the host says the wait is over.
 *
 * What settles the wait is a host predicate, so one helper covers "feedback
 * arrived", "screens confirmed" and "a run was requested". The socket factory
 * is injectable, which is what makes the retry and settle logic testable
 * without a live daemon.
 */

/** The slice of `WebSocket` a waiter uses; a real `WebSocket` satisfies it. */
export interface WaiterSocket {
  close(): void;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
}

/** What a frame means to the waiter; `undefined` means "not mine, keep waiting". */
export type WaitVerdict<T> =
  | { type: "settle"; value: T }
  | { type: "fail"; error: Error }
  /** Wake the probe — the frame announces state the waiter has to read back. */
  | { type: "recheck" };

export interface WaitMessages {
  /** Deadline passed. Default: "Timed out waiting." */
  timeout?: string;
  /** Socket closed before the wait settled. Default: "Connection closed before the wait settled." */
  closed?: string;
  /** Socket could not be opened, or errored. Default: "WebSocket connection failed." */
  connectionFailed?: string;
}

export interface WaitOptions<T> {
  /** The daemon's wait socket, e.g. `ws://localhost:19400/ws/wait/<topic>`. */
  url: string;
  /** Reads a frame; returns how it settles the wait, if at all. */
  onFrame(frame: unknown): WaitVerdict<T> | undefined;
  /**
   * Fast path against server state. Runs before connecting, again once the
   * socket opens — closing the race where the event lands between the two —
   * and whenever a frame asks for a recheck. A probe that rejects is dropped:
   * the socket, not the probe, is what the wait ultimately hangs on.
   */
  probe?(): Promise<{ value: T } | undefined>;
  createSocket?(url: string): WaiterSocket;
  /** Deadline for the whole wait, spanning reconnects. */
  timeoutMs: number;
  reconnect?: {
    /** Reconnects after a dropped connection. Default 0. */
    attempts?: number;
    /** Delay before a reconnect, capped by the remaining deadline. Default 1000. */
    delayMs?: number;
  };
  messages?: WaitMessages;
}

/** Why the wait ended without an answer; hosts map these onto their own errors. */
export type WaitFailure = "timeout" | "closed" | "connection-failed";

export class WaitError extends Error {
  constructor(
    message: string,
    readonly reason: WaitFailure,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WaitError";
  }
}

const DEFAULT_MESSAGES: Required<WaitMessages> = {
  timeout: "Timed out waiting.",
  closed: "Connection closed before the wait settled.",
  connectionFailed: "WebSocket connection failed.",
};

function parseFrame(data: unknown): unknown {
  if (typeof data !== "string") return undefined;
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}

function connectAndWait<T>(
  options: WaitOptions<T>,
  createSocket: (url: string) => WaiterSocket,
  messages: Required<WaitMessages>,
  remainingMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let socket: WaiterSocket;
    try {
      socket = createSocket(options.url);
    } catch (error) {
      reject(new WaitError(messages.connectionFailed, "connection-failed", true, { cause: error }));
      return;
    }

    let settled = false;
    // The value is wrapped so a settling `T` of any shape stays distinguishable.
    const finish = (outcome: { value: T } | Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      if (outcome instanceof Error) reject(outcome);
      else resolve(outcome.value);
    };

    const timer = setTimeout(() => finish(new WaitError(messages.timeout, "timeout", false)), remainingMs);

    const runProbe = () => {
      if (!options.probe) return;
      options.probe().then((result) => {
        if (result) finish(result);
      }).catch(() => {});
    };

    socket.onopen = () => runProbe();

    socket.onmessage = (event) => {
      const frame = parseFrame(event.data);
      if (frame === undefined) return;
      const verdict = options.onFrame(frame);
      if (!verdict) return;
      if (verdict.type === "settle") finish({ value: verdict.value });
      else if (verdict.type === "fail") finish(verdict.error);
      else runProbe();
    };

    socket.onerror = () => finish(new WaitError(messages.connectionFailed, "connection-failed", true));
    socket.onclose = () => finish(new WaitError(messages.closed, "closed", true));
  });
}

export async function waitForEvent<T>(options: WaitOptions<T>): Promise<T> {
  const createSocket = options.createSocket ?? ((url: string) => new WebSocket(url));
  const messages = { ...DEFAULT_MESSAGES, ...options.messages };
  const attempts = options.reconnect?.attempts ?? 0;
  const delayMs = options.reconnect?.delayMs ?? 1_000;
  const deadline = Date.now() + options.timeoutMs;

  const known = await options.probe?.().catch(() => undefined);
  if (known) return known.value;

  for (let attempt = 0; ; attempt++) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new WaitError(messages.timeout, "timeout", false);

    try {
      return await connectAndWait(options, createSocket, messages, remainingMs);
    } catch (error) {
      if (!(error instanceof WaitError) || !error.retryable || attempt >= attempts) throw error;
      await Bun.sleep(Math.min(delayMs, Math.max(0, deadline - Date.now())));
    }
  }
}
