import { writeFileSync } from "fs";
import { join } from "path";
import { UPLOADS_DIR } from "../paths";
import type { SessionManager } from "../session";
import { jsonResponse } from "./utils";
import type { Route } from "../router";

const IMAGE_MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", svg: "image/svg+xml", webp: "image/webp",
  bmp: "image/bmp", avif: "image/avif",
};

export function createUploadHandlers(sessionManager: SessionManager): Route[] {
  async function handleUpload(req: Request, _url: URL, match: URLPatternResult): Promise<Response> {
    const sessionId = match.pathname.groups.id!;
    if (!sessionManager.get(sessionId)) {
      return jsonResponse({ error: "Session not found" }, 404);
    }

    const formData = await req.formData();
    const file = formData.get("image") as File | null;
    if (!file) return jsonResponse({ error: "No image provided" }, 400);
    if (!file.type.startsWith("image/")) return jsonResponse({ error: "Not an image" }, 400);
    if (file.size > 10 * 1024 * 1024) return jsonResponse({ error: "Image too large (max 10MB)" }, 413);

    const ext = file.name.split(".").pop()?.toLowerCase() || "png";
    const filename = `${crypto.randomUUID()}.${ext}`;
    const filepath = join(UPLOADS_DIR, filename);

    const buffer = await file.arrayBuffer();
    writeFileSync(filepath, Buffer.from(buffer));

    return jsonResponse({ path: filepath, filename });
  }

  async function handleUploadServe(_req: Request, _url: URL, match: URLPatternResult): Promise<Response> {
    const filename = match.pathname.groups.filename!;
    if (filename.includes("/") || filename.includes("..")) {
      return jsonResponse({ error: "Invalid filename" }, 400);
    }

    const filepath = join(UPLOADS_DIR, filename);
    const file = Bun.file(filepath);
    if (!(await file.exists())) return jsonResponse({ error: "Not found" }, 404);

    const ext = filename.split(".").pop()?.toLowerCase() || "";
    const mime = IMAGE_MIME[ext] || "application/octet-stream";

    return new Response(file, {
      headers: {
        "Content-Type": mime,
        "Cache-Control": "public, max-age=3600",
      },
    });
  }

  return [
    { method: "POST", pattern: new URLPattern({ pathname: "/api/session/:id/upload" }), handler: handleUpload },
    { method: "GET", pattern: new URLPattern({ pathname: "/api/uploads/:filename" }), handler: handleUploadServe },
  ];
}
