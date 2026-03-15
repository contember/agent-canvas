import type { ServerWebSocket } from "bun";
import type { SessionManager } from "./session";

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

  const handlers = {
    open(ws: ServerWebSocket<WSData>) {
      const { type, sessionId } = ws.data;
      const map = type === "browser" ? browserSockets : waitSockets;
      if (!map.has(sessionId)) map.set(sessionId, new Set());
      map.get(sessionId)!.add(ws);
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
    close(ws: ServerWebSocket<WSData>) {
      const { type, sessionId } = ws.data;
      const map = type === "browser" ? browserSockets : waitSockets;
      map.get(sessionId)?.delete(ws);
      if (map.get(sessionId)?.size === 0) map.delete(sessionId);
    },
  };

  return { handlers, broadcastPlanUpdate, broadcastRevisionUpdate };
}
