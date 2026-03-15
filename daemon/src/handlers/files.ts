import { join, resolve } from "path";
import { readdir } from "fs/promises";
import type { SessionManager } from "../session";
import { LANG_MAP } from "../../langMap";
import { jsonResponse } from "./utils";
import type { Route } from "../router";

const IMAGE_MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", svg: "image/svg+xml", webp: "image/webp",
  ico: "image/x-icon", bmp: "image/bmp", avif: "image/avif",
};

function resolveSessionPath(
  sessionManager: SessionManager,
  sessionId: string,
  relPath: string,
): { fullPath: string; session: ReturnType<SessionManager["get"]> & {} } | Response {
  const session = sessionManager.get(sessionId);
  if (!session) return jsonResponse({ error: "Session not found" }, 404);

  const fullPath = resolve(join(session.projectRoot, relPath));
  if (!fullPath.startsWith(resolve(session.projectRoot))) {
    return jsonResponse({ error: "Path traversal rejected" }, 403);
  }

  return { fullPath, session };
}

export function createFileHandlers(sessionManager: SessionManager): Route[] {
  async function handleFileServe(_req: Request, url: URL): Promise<Response> {
    const sessionId = url.searchParams.get("session");
    const relPath = url.searchParams.get("path");
    if (!sessionId || !relPath) return jsonResponse({ error: "Missing session or path" }, 400);

    const resolved = resolveSessionPath(sessionManager, sessionId, relPath);
    if (resolved instanceof Response) return resolved;

    try {
      const file = Bun.file(resolved.fullPath);
      const stat = await file.exists();
      if (!stat) return jsonResponse({ error: "File not found" }, 404);
      if (file.size > 1024 * 1024) return jsonResponse({ error: "File too large" }, 413);

      const content = await file.text();
      const ext = relPath.split(".").pop() || "";
      return jsonResponse({ content, language: LANG_MAP[ext] || "text" });
    } catch {
      return jsonResponse({ error: "Failed to read file" }, 500);
    }
  }

  async function handleImageServe(_req: Request, url: URL): Promise<Response> {
    const sessionId = url.searchParams.get("session");
    const relPath = url.searchParams.get("path");
    if (!sessionId || !relPath) return jsonResponse({ error: "Missing session or path" }, 400);

    const resolved = resolveSessionPath(sessionManager, sessionId, relPath);
    if (resolved instanceof Response) return resolved;

    try {
      const file = Bun.file(resolved.fullPath);
      if (!(await file.exists())) return jsonResponse({ error: "File not found" }, 404);
      if (file.size > 10 * 1024 * 1024) return jsonResponse({ error: "File too large" }, 413);

      const ext = relPath.split(".").pop()?.toLowerCase() || "";
      const mime = IMAGE_MIME[ext];
      if (!mime) return jsonResponse({ error: "Unsupported image format" }, 415);

      return new Response(file, {
        headers: {
          "Content-Type": mime,
          "Cache-Control": "public, max-age=300",
        },
      });
    } catch {
      return jsonResponse({ error: "Failed to read file" }, 500);
    }
  }

  async function handleTreeServe(_req: Request, url: URL): Promise<Response> {
    const sessionId = url.searchParams.get("session");
    const relPath = url.searchParams.get("path") || "";
    if (!sessionId) return jsonResponse({ error: "Missing session" }, 400);

    const resolved = resolveSessionPath(sessionManager, sessionId, relPath);
    if (resolved instanceof Response) return resolved;

    const ignoreDirs = new Set([".git", "node_modules", ".next", "__pycache__", "dist", ".cache"]);

    try {
      const dirents = await readdir(resolved.fullPath, { withFileTypes: true });
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

  return [
    { method: "GET", pattern: new URLPattern({ pathname: "/api/file" }), handler: handleFileServe },
    { method: "GET", pattern: new URLPattern({ pathname: "/api/image" }), handler: handleImageServe },
    { method: "GET", pattern: new URLPattern({ pathname: "/api/tree" }), handler: handleTreeServe },
  ];
}
