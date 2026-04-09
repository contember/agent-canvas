import type { ServerWebSocket } from "bun";
import type { SessionManager, RemoteFeedbackEntry } from "./session";

export type WSData = { type: "browser" | "wait"; sessionId: string };

export function createWebSocketManager(sessionManager: SessionManager) {
  const browserSockets = new Map<string, Set<ServerWebSocket<WSData>>>();
  const waitSockets = new Map<string, Set<ServerWebSocket<WSData>>>();

  function broadcastPlanUpdate(sessionId: string) {
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

  // Ping wait sockets periodically to detect dead connections.
  // We can't rely on ws.close() triggering the close handler for dead sockets,
  // so we manually remove dead sockets and broadcast status.
  const PING_INTERVAL = 5_000;
  const pongReceived = new WeakSet<ServerWebSocket<WSData>>();

  function removeWaitSocket(ws: ServerWebSocket<WSData>, sessionId: string) {
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
    open(ws: ServerWebSocket<WSData>) {
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
        broadcastWatcherStatus(sessionId);
      }
    },
    message(ws: ServerWebSocket<WSData>, message: string | Buffer) {
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
                sessionManager.consumeFeedback(sessionId, session.currentRevision);
                broadcastRevisionUpdate(sessionId);
                const payload = JSON.stringify({ type: "submit", feedback });
                for (const waiter of waiters) {
                  waiter.send(payload);
                  waiter.close();
                }
                waitSockets.delete(sessionId);
              }
            }
          }
        } catch {}
      }
    },
    pong(ws: ServerWebSocket<WSData>) {
      if (ws.data.type === "wait") {
        pongReceived.add(ws);
      }
    },
    close(ws: ServerWebSocket<WSData>) {
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
