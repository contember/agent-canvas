import type { SessionManager, RemoteFeedbackEntry } from "./session";

export type WSData = { type: "browser" | "wait"; sessionId: string };

export interface CanvasSocket {
  data: WSData;
  send(message: string): unknown;
  close(): void;
  ping(): unknown;
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

export interface WebSocketManagerOptions {
  /**
   * Who marks feedback consumed once a waiting client has been handed it.
   *
   * `"on-delivery"` (default) clears it in the same step, so the same feedback
   * can never be delivered twice — right when the waiting client *is* the
   * consumer. `"external"` leaves it pending for a separate gate to claim
   * through the consume endpoint, for hosts where delivery and consumption are
   * different steps.
   */
  feedbackConsumption?: "on-delivery" | "external";
}

export function createWebSocketManager(
  sessionManager: SessionManager,
  options: WebSocketManagerOptions = {},
) {
  const consumeOnDelivery = (options.feedbackConsumption ?? "on-delivery") === "on-delivery";
  const browserSockets = new Map<string, Set<CanvasSocket>>();
  const waitSockets = new Map<string, Set<CanvasSocket>>();
  const pendingRenderErrors = new Map<string, CanvasRenderError>();

  function broadcastPlanUpdate(sessionId: string) {
    pendingRenderErrors.delete(sessionId);
    const sockets = browserSockets.get(sessionId);
    if (!sockets) return;
    const session = sessionManager.get(sessionId);
    if (!session) return;
    const payload = JSON.stringify({
      type: "plan-updated",
      currentRevision: session.currentRevision,
      revisions: session.revisions,
    });
    for (const ws of sockets) {
      ws.send(payload);
    }
  }

  function broadcastRevisionUpdate(sessionId: string) {
    const sockets = browserSockets.get(sessionId);
    if (!sockets) return;
    const session = sessionManager.get(sessionId);
    if (!session) return;
    const payload = JSON.stringify({
      type: "revision-updated",
      revisions: session.revisions,
    });
    for (const ws of sockets) {
      ws.send(payload);
    }
  }

  function broadcastRemoteFeedback(sessionId: string, revision: number, entries: RemoteFeedbackEntry[]) {
    const sockets = browserSockets.get(sessionId);
    if (!sockets || sockets.size === 0) return;
    const payload = JSON.stringify({
      type: "remote-feedback",
      revision,
      entries,
    });
    for (const ws of sockets) {
      ws.send(payload);
    }
  }

  function broadcastWatcherStatus(sessionId: string) {
    const sockets = browserSockets.get(sessionId);
    if (!sockets) return;
    const watching = (waitSockets.get(sessionId)?.size ?? 0) > 0;
    const payload = JSON.stringify({ type: "watcher-status", watching });
    for (const ws of sockets) {
      ws.send(payload);
    }
  }

  function deliverPendingRenderError(sessionId: string): boolean {
    const error = pendingRenderErrors.get(sessionId);
    const waiters = waitSockets.get(sessionId);
    if (!error || !waiters || waiters.size === 0) return false;

    pendingRenderErrors.delete(sessionId);
    waitSockets.delete(sessionId);
    const payload = JSON.stringify({ type: "render-error", error });
    for (const waiter of waiters) {
      waiter.send(payload);
      waiter.close();
    }
    broadcastWatcherStatus(sessionId);
    return true;
  }

  // Ping wait sockets periodically to detect dead connections.
  // We can't rely on ws.close() triggering the close handler for dead sockets,
  // so we manually remove dead sockets and broadcast status.
  const PING_INTERVAL = 5_000;
  const pongReceived = new WeakSet<CanvasSocket>();

  function removeWaitSocket(ws: CanvasSocket, sessionId: string) {
    const sockets = waitSockets.get(sessionId);
    if (sockets) {
      sockets.delete(ws);
      if (sockets.size === 0) waitSockets.delete(sessionId);
    }
    try { ws.close(); } catch {}
    broadcastWatcherStatus(sessionId);
  }

  setInterval(() => {
    for (const [sessionId, sockets] of waitSockets) {
      for (const ws of sockets) {
        if (!pongReceived.has(ws)) {
          // No pong since last ping — connection is dead
          removeWaitSocket(ws, sessionId);
          continue;
        }
        pongReceived.delete(ws);
        try { ws.ping(); } catch {
          removeWaitSocket(ws, sessionId);
        }
      }
    }
  }, PING_INTERVAL);

  const handlers = {
    open(ws: CanvasSocket) {
      const { type, sessionId } = ws.data;
      const map = type === "browser" ? browserSockets : waitSockets;
      if (!map.has(sessionId)) map.set(sessionId, new Set());
      map.get(sessionId)!.add(ws);
      if (type === "browser") {
        // Send current watcher status to newly connected browser
        const watching = (waitSockets.get(sessionId)?.size ?? 0) > 0;
        ws.send(JSON.stringify({ type: "watcher-status", watching }));
      } else {
        // CLI waiter connected — notify browsers
        pongReceived.add(ws); // Give it a free pass on first interval
        if (!deliverPendingRenderError(sessionId)) {
          broadcastWatcherStatus(sessionId);
        }
      }
    },
    message(ws: CanvasSocket, message: string | Buffer) {
      const { type, sessionId } = ws.data;
      if (type === "browser") {
        try {
          const data = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message));
          if (data.type === "submit") {
            const feedback = data.feedback as string;

            const session = sessionManager.get(sessionId);
            if (session) {
              sessionManager.saveFeedback(sessionId, session.currentRevision, feedback);
              broadcastRevisionUpdate(sessionId);

              const waiters = waitSockets.get(sessionId);
              if (waiters && waiters.size > 0) {
                if (consumeOnDelivery) {
                  sessionManager.consumeFeedback(sessionId, session.currentRevision);
                  broadcastRevisionUpdate(sessionId);
                }
                const payload = JSON.stringify({ type: "submit", feedback });
                for (const waiter of waiters) {
                  waiter.send(payload);
                  waiter.close();
                }
                waitSockets.delete(sessionId);
              }
            }
          }
          if (data.type === "render-error" && isCanvasRenderError(data.error)) {
            const session = sessionManager.get(sessionId);
            if (
              session
              && data.error.revision === session.currentRevision
              && session.canvasFiles.includes(data.error.filename)
            ) {
              pendingRenderErrors.set(sessionId, data.error);
              deliverPendingRenderError(sessionId);
            }
          }
        } catch {}
      }
    },
    pong(ws: CanvasSocket) {
      if (ws.data.type === "wait") {
        pongReceived.add(ws);
      }
    },
    close(ws: CanvasSocket) {
      const { type, sessionId } = ws.data;
      const map = type === "browser" ? browserSockets : waitSockets;
      map.get(sessionId)?.delete(ws);
      if (map.get(sessionId)?.size === 0) map.delete(sessionId);
      if (type === "wait") {
        // CLI waiter disconnected — notify browsers
        broadcastWatcherStatus(sessionId);
      }
    },
  };

  return { handlers, broadcastPlanUpdate, broadcastRevisionUpdate, broadcastWatcherStatus, broadcastRemoteFeedback };
}
