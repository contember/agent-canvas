import { writeFileSync, mkdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { SessionManager } from "./session";
import { createWebSocketManager, type WSData } from "./websocket";
import { dispatch } from "./router";
import { jsonResponse, corsHeaders } from "./handlers/utils";
import { createApiHandlers } from "./handlers/api";
import { createFileHandlers } from "./handlers/files";
import { createStaticHandlers } from "./handlers/static";
import { createUploadHandlers } from "./handlers/uploads";

const PORT = parseInt(process.env.CANVAS_PORT || "19400", 10);
const VERSION = JSON.parse(readFileSync(join(dirname(import.meta.dir), "..", "package.json"), "utf-8")).version as string;

// Write PID file so CLI can find and stop us
const pidDir = join(tmpdir(), "agent-canvas");
mkdirSync(pidDir, { recursive: true });
writeFileSync(join(pidDir, "daemon.pid"), String(process.pid));

const sessionManager = new SessionManager();
const wsManager = createWebSocketManager(sessionManager);

const routes = [
  ...createApiHandlers({ sessionManager, broadcastPlanUpdate: wsManager.broadcastPlanUpdate, broadcastRevisionUpdate: wsManager.broadcastRevisionUpdate, port: PORT, version: VERSION }),
  ...createFileHandlers(sessionManager),
  ...createUploadHandlers(sessionManager),
  ...createStaticHandlers(),
];

const server = Bun.serve<WSData>({
  port: PORT,
  hostname: "localhost",
  fetch(req, server) {
    const url = new URL(req.url);

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(PORT) });
    }

    // WebSocket upgrade: /ws/session/:id
    const wsBrowserMatch = url.pathname.match(/^\/ws\/session\/([^/]+)$/);
    if (wsBrowserMatch) {
      const upgraded = server.upgrade(req, { data: { type: "browser", sessionId: wsBrowserMatch[1] } });
      if (!upgraded) return new Response("WebSocket upgrade failed", { status: 400 });
      return undefined as any;
    }

    // WebSocket upgrade: /ws/wait/:id
    const wsWaitMatch = url.pathname.match(/^\/ws\/wait\/([^/]+)$/);
    if (wsWaitMatch) {
      const upgraded = server.upgrade(req, { data: { type: "wait", sessionId: wsWaitMatch[1] } });
      if (!upgraded) return new Response("WebSocket upgrade failed", { status: 400 });
      return undefined as any;
    }

    // Route dispatch
    const response = dispatch(routes, req, url);
    if (response) return response;

    // Root redirect
    if (url.pathname === "/" && req.method === "GET") {
      const sessions = sessionManager.list();
      if (sessions.length > 0) {
        const latest = sessions.sort((a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        )[0];
        return Response.redirect(`/s/${latest.id}`, 302);
      }
      return jsonResponse({ message: "No active sessions", sessions: [] });
    }

    return jsonResponse({ error: "Not found" }, 404);
  },

  websocket: wsManager.handlers,
});

export { sessionManager, server };
export const broadcastPlanUpdate = wsManager.broadcastPlanUpdate;

setInterval(() => sessionManager.cleanupStale(), 60 * 60 * 1000);

console.log(`Planner daemon listening on http://localhost:${PORT}`);
