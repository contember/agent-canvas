import { SessionManager } from "./session";
import { compilePlan } from "./compiler";
import { watchSession } from "./watcher";

const PORT = parseInt(process.env.PLANNER_PORT || "19400", 10);
const sessionManager = new SessionManager();

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function corsHeaders(headers: Record<string, string> = {}): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "http://localhost:" + PORT,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    ...headers,
  };
}

// WebSocket connections
const browserSockets = new Map<string, Set<ServerWebSocket<{ type: string; sessionId: string }>>>();
const waitSockets = new Map<string, Set<ServerWebSocket<{ type: string; sessionId: string }>>>();

type WSData = { type: "browser" | "wait"; sessionId: string };

const server = Bun.serve<WSData>({
  port: PORT,
  hostname: "localhost",
  fetch(req, server) {
    const url = new URL(req.url);
    const path = url.pathname;

    // OPTIONS (CORS preflight)
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // Health
    if (path === "/health" && req.method === "GET") {
      const sessions = sessionManager.list().map((s) => s.id);
      return jsonResponse({ ok: true, sessions });
    }

    // POST /api/session/:id/plan
    const planPostMatch = path.match(/^\/api\/session\/([^/]+)\/plan$/);
    if (planPostMatch && req.method === "POST") {
      const sessionId = planPostMatch[1];
      return handlePlanPost(req, sessionId);
    }

    // GET /api/session/:id/plan.js
    const planJsMatch = path.match(/^\/api\/session\/([^/]+)\/plan\.js$/);
    if (planJsMatch && req.method === "GET") {
      const sessionId = planJsMatch[1];
      return handlePlanJs(sessionId);
    }

    // GET /api/session/:id/meta
    const metaMatch = path.match(/^\/api\/session\/([^/]+)\/meta$/);
    if (metaMatch && req.method === "GET") {
      const sessionId = metaMatch[1];
      const session = sessionManager.get(sessionId);
      if (!session) return jsonResponse({ error: "Session not found" }, 404);
      return jsonResponse({
        projectRoot: session.projectRoot,
        version: session.version,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      });
    }

    // GET /api/sessions
    if (path === "/api/sessions" && req.method === "GET") {
      return jsonResponse(sessionManager.list());
    }

    // GET /api/file
    if (path === "/api/file" && req.method === "GET") {
      return handleFileServe(url);
    }

    // GET /api/tree
    if (path === "/api/tree" && req.method === "GET") {
      return handleTreeServe(url);
    }

    // WebSocket upgrade: /ws/session/:id
    const wsBrowserMatch = path.match(/^\/ws\/session\/([^/]+)$/);
    if (wsBrowserMatch) {
      const sessionId = wsBrowserMatch[1];
      const upgraded = server.upgrade(req, { data: { type: "browser", sessionId } });
      if (!upgraded) return new Response("WebSocket upgrade failed", { status: 400 });
      return undefined as any;
    }

    // WebSocket upgrade: /ws/wait/:id
    const wsWaitMatch = path.match(/^\/ws\/wait\/([^/]+)$/);
    if (wsWaitMatch) {
      const sessionId = wsWaitMatch[1];
      const upgraded = server.upgrade(req, { data: { type: "wait", sessionId } });
      if (!upgraded) return new Response("WebSocket upgrade failed", { status: 400 });
      return undefined as any;
    }

    // GET /s/:id — serve session UI
    const sessionPageMatch = path.match(/^\/s\/([^/]+)$/);
    if (sessionPageMatch && req.method === "GET") {
      return serveSessionPage(sessionPageMatch[1]);
    }

    // GET /assets/* — static files
    if (path.startsWith("/assets/") && req.method === "GET") {
      return serveStaticAsset(path);
    }

    // GET / — redirect to last active session or list
    if (path === "/" && req.method === "GET") {
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

  websocket: {
    open(ws) {
      const { type, sessionId } = ws.data;
      const map = type === "browser" ? browserSockets : waitSockets;
      if (!map.has(sessionId)) map.set(sessionId, new Set());
      map.get(sessionId)!.add(ws);
    },
    message(ws, message) {
      const { type, sessionId } = ws.data;
      if (type === "browser") {
        // Browser sends submit
        try {
          const data = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message));
          if (data.type === "submit") {
            // Forward to all waiting CLI sockets
            const waiters = waitSockets.get(sessionId);
            if (waiters) {
              const payload = JSON.stringify({ type: "submit", feedback: data.feedback });
              for (const waiter of waiters) {
                waiter.send(payload);
                waiter.close();
              }
              waitSockets.delete(sessionId);
            }
          }
        } catch {}
      }
    },
    close(ws) {
      const { type, sessionId } = ws.data;
      const map = type === "browser" ? browserSockets : waitSockets;
      map.get(sessionId)?.delete(ws);
      if (map.get(sessionId)?.size === 0) map.delete(sessionId);
    },
  },
});

async function handlePlanPost(req: Request, sessionId: string): Promise<Response> {
  try {
    const body = await req.json();
    const { jsx, projectRoot } = body;
    if (!jsx) return jsonResponse({ error: "Missing jsx" }, 400);

    const isNew = !sessionManager.get(sessionId);
    sessionManager.upsert(sessionId, jsx, projectRoot || process.cwd());

    const result = await compilePlan(jsx);
    if (result.ok) {
      sessionManager.saveCompiled(sessionId, result.js);
      broadcastPlanUpdate(sessionId);
    }

    // Start watching for file changes
    watchSession(sessionId, broadcastPlanUpdate, (id, js) => sessionManager.saveCompiled(id, js));

    const browserUrl = `http://localhost:${PORT}/s/${sessionId}`;
    return jsonResponse({
      ok: result.ok,
      browserUrl,
      isNew,
      error: result.ok ? undefined : result.error,
    });
  } catch (e: any) {
    return jsonResponse({ error: e.message }, 500);
  }
}

function handlePlanJs(sessionId: string): Response {
  const compiled = sessionManager.getCompiled(sessionId);
  if (!compiled) return jsonResponse({ error: "No compiled plan" }, 404);
  return new Response(compiled, {
    headers: {
      "Content-Type": "application/javascript",
      "Cache-Control": "no-cache",
    },
  });
}

function broadcastPlanUpdate(sessionId: string) {
  const sockets = browserSockets.get(sessionId);
  if (!sockets) return;
  const session = sessionManager.get(sessionId);
  const payload = JSON.stringify({
    type: "plan-updated",
    version: session?.version ?? 0,
  });
  for (const ws of sockets) {
    ws.send(payload);
  }
}

async function handleFileServe(url: URL): Promise<Response> {
  const sessionId = url.searchParams.get("session");
  const relPath = url.searchParams.get("path");
  if (!sessionId || !relPath) return jsonResponse({ error: "Missing session or path" }, 400);

  const session = sessionManager.get(sessionId);
  if (!session) return jsonResponse({ error: "Session not found" }, 404);

  const { resolve, join } = await import("path");
  const fullPath = resolve(join(session.projectRoot, relPath));
  if (!fullPath.startsWith(resolve(session.projectRoot))) {
    return jsonResponse({ error: "Path traversal rejected" }, 403);
  }

  try {
    const file = Bun.file(fullPath);
    const stat = await file.exists();
    if (!stat) return jsonResponse({ error: "File not found" }, 404);
    if (file.size > 1024 * 1024) return jsonResponse({ error: "File too large" }, 413);

    const content = await file.text();
    const ext = relPath.split(".").pop() || "";
    const langMap: Record<string, string> = {
      ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
      py: "python", rs: "rust", go: "go", rb: "ruby", java: "java",
      json: "json", yaml: "yaml", yml: "yaml", md: "markdown",
      css: "css", html: "html", sh: "bash", bash: "bash",
    };
    return jsonResponse({ content, language: langMap[ext] || "text" });
  } catch {
    return jsonResponse({ error: "Failed to read file" }, 500);
  }
}

async function handleTreeServe(url: URL): Promise<Response> {
  const sessionId = url.searchParams.get("session");
  const relPath = url.searchParams.get("path") || "";
  if (!sessionId) return jsonResponse({ error: "Missing session" }, 400);

  const session = sessionManager.get(sessionId);
  if (!session) return jsonResponse({ error: "Session not found" }, 404);

  const { resolve, join } = await import("path");
  const fullPath = resolve(join(session.projectRoot, relPath));
  if (!fullPath.startsWith(resolve(session.projectRoot))) {
    return jsonResponse({ error: "Path traversal rejected" }, 403);
  }

  const { readdir } = await import("fs/promises");
  const ignoreDirs = new Set([".git", "node_modules", ".next", "__pycache__", "dist", ".cache"]);

  try {
    const dirents = await readdir(fullPath, { withFileTypes: true });
    const entries = dirents
      .filter((d) => !ignoreDirs.has(d.name) && !d.name.startsWith("."))
      .map((d) => ({
        name: d.name,
        type: d.isDirectory() ? "dir" : "file",
      }))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    return jsonResponse({ entries });
  } catch {
    return jsonResponse({ error: "Failed to read directory" }, 500);
  }
}

async function getDistDir(): Promise<string> {
  const { join, dirname } = await import("path");
  // Try local dist first (dev), then ~/.planner/daemon (installed)
  const localDist = join(dirname(import.meta.dir), "dist");
  if (await Bun.file(join(localDist, "index.html")).exists()) return localDist;
  const homedir = (await import("os")).homedir();
  return join(homedir, ".planner", "daemon");
}

async function serveSessionPage(_sessionId: string): Promise<Response> {
  const { join } = await import("path");
  const distDir = await getDistDir();
  const file = Bun.file(join(distDir, "index.html"));
  if (await file.exists()) {
    return new Response(file, { headers: { "Content-Type": "text/html" } });
  }
  return new Response("Build not found. Run: bun run daemon/build.ts", { status: 500 });
}

async function serveStaticAsset(path: string): Promise<Response> {
  const { join } = await import("path");
  const distDir = await getDistDir();
  const assetPath = join(distDir, path.replace("/assets/", ""));
  const file = Bun.file(assetPath);
  if (!(await file.exists())) return new Response("Not found", { status: 404 });

  const ext = path.split(".").pop() || "";
  const mimeTypes: Record<string, string> = {
    js: "application/javascript",
    css: "text/css",
    html: "text/html",
    svg: "image/svg+xml",
    png: "image/png",
  };
  return new Response(file, {
    headers: { "Content-Type": mimeTypes[ext] || "application/octet-stream" },
  });
}

// Export for file watcher to use
export { broadcastPlanUpdate, sessionManager, server };

console.log(`Planner daemon listening on http://localhost:${PORT}`);
