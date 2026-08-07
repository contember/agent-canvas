import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { BASE_URL, WS_URL, TIMEOUT_MS } from "./config.ts";

export function getSessionId(session?: string): string {
  if (session) return session;
  return process.env.CANVAS_SESSION_ID || (() => {
    const id = randomUUID();
    console.error(`Warning: CANVAS_SESSION_ID not set, using generated ID: ${id}`);
    return id;
  })();
}

export async function consumeFeedback(sessionId: string): Promise<string | null> {
  const res = await fetch(`${BASE_URL}/api/session/${sessionId}/feedback/consume`, { method: "POST" });
  const data = await res.json() as any;
  if (data.found) return data.feedback;
  return null;
}

export function openBrowser(url: string) {
  const candidates = process.platform === "darwin"
    ? ["open"]
    : ["xdg-open", "wslview", "sensible-browser"];

  for (const cmd of candidates) {
    const which = Bun.spawnSync(["which", cmd]);
    if (which.exitCode === 0) {
      spawn(cmd, [url], { detached: true, stdio: "ignore" }).unref();
      return;
    }
  }
  console.error(`Open this URL in your browser: ${url}`);
}

interface FeedbackSocket {
  close(): void;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
}

interface FeedbackWaitOptions {
  createSocket?: (url: string) => FeedbackSocket;
  timeoutMs?: number;
  reconnectAttempts?: number;
  reconnectDelayMs?: number;
}

interface CanvasRenderError {
  revision: number;
  filename: string;
  message: string;
  stack?: string;
  componentStack?: string;
}

function isCanvasRenderError(value: unknown): value is CanvasRenderError {
  return typeof value === "object" && value !== null
    && "revision" in value && Number.isInteger(value.revision)
    && "filename" in value && typeof value.filename === "string"
    && "message" in value && typeof value.message === "string"
    && (!("stack" in value) || value.stack === undefined || typeof value.stack === "string")
    && (!("componentStack" in value) || value.componentStack === undefined || typeof value.componentStack === "string");
}

function formatCanvasRenderError(error: CanvasRenderError): string {
  const details = [`Canvas render failed in ${error.filename} (revision ${error.revision}):`, error.message];
  if (error.componentStack?.trim()) details.push(`Component stack:${error.componentStack}`);
  if (error.stack?.trim()) details.push(`Browser stack:\n${error.stack}`);
  return details.join("\n");
}

class FeedbackWaitError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
  }
}

function waitForFeedbackConnection(
  sessionId: string,
  timeoutMs: number,
  createSocket: (url: string) => FeedbackSocket,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const ws = createSocket(`${WS_URL}/ws/wait/${sessionId}`);
    let settled = false;

    const finish = (result: string | FeedbackWaitError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      ws.close();
      if (result instanceof FeedbackWaitError) reject(result);
      else resolve(result);
    };

    const timeout = setTimeout(() => {
      finish(new FeedbackWaitError("Timeout waiting for feedback.", false));
    }, timeoutMs);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(typeof event.data === "string" ? event.data : "");
        if (data.type === "submit") {
          finish(data.feedback);
        }
        if (data.type === "render-error" && isCanvasRenderError(data.error)) {
          finish(new FeedbackWaitError(formatCanvasRenderError(data.error), false));
        }
      } catch {}
    };

    ws.onerror = () => {
      finish(new FeedbackWaitError("WebSocket connection failed.", true));
    };

    ws.onclose = () => {
      finish(new FeedbackWaitError("WebSocket closed before feedback was submitted.", true));
    };
  });
}

export async function waitForFeedback(sessionId: string, options: FeedbackWaitOptions = {}): Promise<string> {
  const createSocket = options.createSocket ?? ((url: string) => new WebSocket(url));
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const reconnectAttempts = options.reconnectAttempts ?? 3;
  const reconnectDelayMs = options.reconnectDelayMs ?? 1_000;
  const deadline = Date.now() + timeoutMs;

  for (let attempt = 0; ; attempt++) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new FeedbackWaitError("Timeout waiting for feedback.", false);

    try {
      return await waitForFeedbackConnection(sessionId, remainingMs, createSocket);
    } catch (error) {
      if (!(error instanceof FeedbackWaitError) || !error.retryable || attempt >= reconnectAttempts) {
        throw error;
      }
      await Bun.sleep(Math.min(reconnectDelayMs, Math.max(0, deadline - Date.now())));
    }
  }
}

export async function readLine(): Promise<string> {
  const buf: number[] = [];
  for await (const chunk of Bun.stdin.stream()) {
    for (const byte of chunk) {
      if (byte === 10) return Buffer.from(buf).toString("utf-8");
      buf.push(byte);
    }
  }
  return Buffer.from(buf).toString("utf-8");
}
