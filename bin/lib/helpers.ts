import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { waitForEvent, type WaiterSocket, type WaitVerdict } from "@fabrika/canvas-kernel/server";
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

interface FeedbackWaitOptions {
  createSocket?: (url: string) => WaiterSocket;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

/** A canvas that failed to render is the answer — retrying the socket cannot fix it. */
function readFeedbackFrame(frame: unknown): WaitVerdict<string> | undefined {
  if (!isRecord(frame)) return undefined;
  if (frame.type === "submit" && typeof frame.feedback === "string") {
    return { type: "settle", value: frame.feedback };
  }
  if (frame.type === "render-error" && isCanvasRenderError(frame.error)) {
    return { type: "fail", error: new Error(formatCanvasRenderError(frame.error)) };
  }
  return undefined;
}

export function waitForFeedback(sessionId: string, options: FeedbackWaitOptions = {}): Promise<string> {
  return waitForEvent<string>({
    url: `${WS_URL}/ws/wait/${sessionId}`,
    onFrame: readFeedbackFrame,
    ...(options.createSocket ? { createSocket: options.createSocket } : {}),
    timeoutMs: options.timeoutMs ?? TIMEOUT_MS,
    reconnect: {
      attempts: options.reconnectAttempts ?? 3,
      delayMs: options.reconnectDelayMs ?? 1_000,
    },
    messages: {
      timeout: "Timeout waiting for feedback.",
      closed: "WebSocket closed before feedback was submitted.",
      connectionFailed: "WebSocket connection failed.",
    },
  });
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
