import { join, dirname } from "path";
import { DATA_DIR } from "../paths";
import type { Route } from "../router";

const MIME_TYPES: Record<string, string> = {
  js: "application/javascript",
  css: "text/css",
  html: "text/html",
  svg: "image/svg+xml",
  png: "image/png",
};

let cachedDistDir: string | null = null;
async function getDistDir(): Promise<string> {
  if (cachedDistDir) return cachedDistDir;
  // import.meta.dir = daemon/src/handlers/, go up two levels to daemon/
  const localDist = join(dirname(import.meta.dir), "..", "dist");
  if (await Bun.file(join(localDist, "index.html")).exists()) {
    cachedDistDir = localDist;
  } else {
    cachedDistDir = join(DATA_DIR, "daemon");
  }
  return cachedDistDir;
}

async function serveSessionPage(): Promise<Response> {
  const distDir = await getDistDir();
  const file = Bun.file(join(distDir, "index.html"));
  if (await file.exists()) {
    return new Response(file, { headers: { "Content-Type": "text/html" } });
  }
  return new Response("Build not found. Run: bun run daemon/build.ts", { status: 500 });
}

async function serveStaticAsset(_req: Request, url: URL): Promise<Response> {
  const path = url.pathname;
  const distDir = await getDistDir();
  const assetPath = join(distDir, path.replace("/assets/", ""));
  const file = Bun.file(assetPath);
  if (!(await file.exists())) return new Response("Not found", { status: 404 });

  const ext = path.split(".").pop() || "";
  return new Response(file, {
    headers: { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" },
  });
}

export function createStaticHandlers(): Route[] {
  return [
    {
      method: "GET",
      pattern: new URLPattern({ pathname: "/s/:id" }),
      handler: serveSessionPage,
    },
    {
      method: "GET",
      pattern: new URLPattern({ pathname: "/assets/*" }),
      handler: serveStaticAsset,
    },
  ];
}
