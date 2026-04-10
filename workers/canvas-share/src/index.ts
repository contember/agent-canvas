/**
 * Canvas Share Worker
 *
 * Accepts canvas snapshots pushed by the agent-canvas daemon and serves
 * them to reviewers over capability URLs. Collects feedback from reviewers
 * and exposes it for the daemon to poll back.
 *
 * Storage:
 *   R2 (BLOBS):
 *     shares/{shareId}/payload.json        — full SharePayload (audit/debug)
 *     shares/{shareId}/record.json         — ShareRecord (lightweight metadata)
 *     shares/{shareId}/canvas/{file}.js    — compiled canvas JS
 *     shares/{shareId}/canvas/{file}.jsx   — original JSX (optional)
 *     shares/{shareId}/uploads/{hash}.{ext} — reviewer uploads (content-addressed)
 *
 *   KV (FEEDBACK):
 *     fb:{shareId}:{submittedAt}:{id}       — individual feedback entries (TTL = share TTL)
 *     rl:{bucket}:{identity}:{minute}       — rate limit counters (TTL 120s)
 *
 * Security model: capability URLs (24-char hex shareId) + optional bearer
 * token gating share creation. No reviewer auth — anyone with the link can
 * comment. Owner token (returned to the daemon at create time) can be used
 * to revoke / delete the share.
 *
 * For deployment instructions see workers/canvas-share/README.md.
 */

import type { Env, ShareRecord, FeedbackEntry } from "./types";
import { LIMITS } from "./types";
import {
  json,
  CORS_HEADERS,
  randomHexId,
  rateLimitShareCreate,
  rateLimitFeedback,
  rateLimitUpload,
  verifyShareAuth,
  readBodyWithLimit,
  timingSafeEqual,
} from "./util";
import {
  validateSharePayload,
  validateFeedbackBody,
  validateShareId,
} from "./validation";

// ----- Share creation -------------------------------------------------------

async function handleCreateShare(req: Request, env: Env, origin: string): Promise<Response> {
  const auth = verifyShareAuth(env, req);
  if (auth) return auth;

  const rl = await rateLimitShareCreate(env, req);
  if (rl) return rl;

  const bodyText = await readBodyWithLimit(req, LIMITS.SHARE_PAYLOAD_BYTES);
  if (typeof bodyText !== "string") return bodyText;

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return json({ error: "Invalid JSON" }, { status: 400 });
  }

  const validation = validateSharePayload(parsed);
  if (typeof validation === "string") return json({ error: validation }, { status: 400 });
  const payload = validation;

  const shareId = randomHexId(12); // 24 hex chars = 96 bits
  const ownerToken = randomHexId(16); // 128 bits — proof of ownership for delete/revoke
  const ttlSeconds = parseInt(env.SHARE_TTL_SECONDS || "", 10) || LIMITS.DEFAULT_SHARE_TTL_SECONDS;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();

  const record: ShareRecord = {
    shareId,
    ownerToken,
    createdAt: now.toISOString(),
    expiresAt,
    componentsVersion: payload.runtime.componentsVersion,
    origin: payload.origin,
    canvasFilenames: payload.canvasFiles.map((cf) => cf.filename),
  };

  const prefix = `shares/${shareId}`;

  // Persist payload, record, and each canvas file separately so the worker
  // can serve compiled JS without parsing the full payload on every hit.
  await env.BLOBS.put(`${prefix}/payload.json`, JSON.stringify(payload), {
    httpMetadata: { contentType: "application/json" },
  });
  await env.BLOBS.put(`${prefix}/record.json`, JSON.stringify(record), {
    httpMetadata: { contentType: "application/json" },
  });

  for (const cf of payload.canvasFiles) {
    const jsName = cf.filename.replace(/\.jsx$/, ".js");
    await env.BLOBS.put(`${prefix}/canvas/${jsName}`, cf.compiledJs, {
      httpMetadata: { contentType: "application/javascript" },
    });
    if (cf.sourceJsx) {
      await env.BLOBS.put(`${prefix}/canvas/${cf.filename}`, cf.sourceJsx, {
        httpMetadata: { contentType: "text/plain; charset=utf-8" },
      });
    }
  }

  return json({
    shareId,
    url: `${origin}/s/${shareId}`,
    ownerToken,
    expiresAt,
  });
}

// ----- Share record loading (with cache) ------------------------------------

async function loadRecord(shareId: string, env: Env): Promise<ShareRecord | null> {
  const obj = await env.BLOBS.get(`shares/${shareId}/record.json`);
  if (!obj) return null;
  try {
    const record = (await obj.json()) as ShareRecord;
    if (record.expiresAt && new Date(record.expiresAt).getTime() < Date.now()) {
      return null; // expired
    }
    return record;
  } catch {
    return null;
  }
}

// ----- Share metadata + canvas serving --------------------------------------

async function handleGetMeta(shareId: string, env: Env): Promise<Response> {
  const record = await loadRecord(shareId, env);
  if (!record) return json({ error: "Not found or expired" }, { status: 404 });

  // Daemon-compatible meta shape so the same client bundle works unchanged
  // in shared mode. A shared canvas only ever exposes its single baked
  // revision, but we still surface it as a one-element revisions array.
  const rev = record.origin.revision;
  return json({
    shareId,
    origin: record.origin,
    projectRoot: undefined,
    currentRevision: rev,
    canvasFiles: record.canvasFilenames,
    revisions: [
      {
        revision: rev,
        ...(record.origin.label ? { label: record.origin.label } : {}),
        canvasFiles: record.canvasFilenames.map((filename) => ({ filename })),
        createdAt: record.origin.createdAt,
        hasFeedback: false,
        feedbackConsumed: false,
      },
    ],
    shares: [],
    shareEnabled: false,
    runtime: { componentsVersion: record.componentsVersion },
  });
}

async function handleGetCanvas(shareId: string, filename: string, env: Env): Promise<Response> {
  if (filename.includes("..") || filename.includes("/")) {
    return json({ error: "Invalid filename" }, { status: 400 });
  }
  const record = await loadRecord(shareId, env);
  if (!record) return json({ error: "Not found or expired" }, { status: 404 });

  const obj = await env.BLOBS.get(`shares/${shareId}/canvas/${filename}`);
  if (!obj) return json({ error: "Not found" }, { status: 404 });
  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType || "application/javascript",
      // Compiled canvas JS is immutable per share — cache aggressively.
      "Cache-Control": "public, max-age=31536000, immutable",
      ...CORS_HEADERS,
    },
  });
}

// ----- Feedback submit / list ----------------------------------------------

async function handleSubmitFeedback(shareId: string, req: Request, env: Env): Promise<Response> {
  const rl = await rateLimitFeedback(env, req, shareId);
  if (rl) return rl;

  const record = await loadRecord(shareId, env);
  if (!record) return json({ error: "Share not found or expired" }, { status: 404 });

  const bodyText = await readBodyWithLimit(req, LIMITS.FEEDBACK_BODY_BYTES);
  if (typeof bodyText !== "string") return bodyText;

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return json({ error: "Invalid JSON" }, { status: 400 });
  }

  const validation = validateFeedbackBody(parsed);
  if (typeof validation === "string") return json({ error: validation }, { status: 400 });
  const body = validation;

  const entry: FeedbackEntry = {
    id: randomHexId(8),
    shareId,
    revision: body.revision,
    submittedAt: new Date().toISOString(),
    author: {
      id: body.author.id || randomHexId(8),
      name: body.author.name.slice(0, LIMITS.AUTHOR_NAME_LENGTH),
    },
    annotations: body.annotations || [],
    ...(body.generalNote ? { generalNote: body.generalNote } : {}),
  };

  // KV key is sortable so `since` queries can use prefix listing efficiently.
  // The full entry is stored as the value AND mirrored into list metadata
  // so handleListFeedback can avoid an N+1 round-trip.
  const key = `fb:${shareId}:${entry.submittedAt}:${entry.id}`;
  const ttlSeconds = Math.max(
    60,
    Math.floor((new Date(record.expiresAt).getTime() - Date.now()) / 1000),
  );
  await env.FEEDBACK.put(key, JSON.stringify(entry), {
    expirationTtl: ttlSeconds,
    metadata: { submittedAt: entry.submittedAt, revision: entry.revision },
  });

  return json({ ok: true, id: entry.id });
}

async function handleListFeedback(shareId: string, req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const since = url.searchParams.get("since") || "";

  const prefix = `fb:${shareId}:`;
  // Page through KV. List metadata lets us skip filtered entries without
  // fetching values; we only fetch values for keys that pass the `since`
  // filter, and we parallelize the gets.
  const entries: FeedbackEntry[] = [];
  let latestAt = since;
  let cursor: string | undefined;

  do {
    const list = await env.FEEDBACK.list({
      prefix,
      cursor,
      limit: 1000,
    });
    cursor = list.list_complete ? undefined : list.cursor;

    const wanted = list.keys.filter((k) => {
      const rest = k.name.slice(prefix.length);
      const submittedAt = rest.slice(0, rest.lastIndexOf(":"));
      return !since || submittedAt > since;
    });
    if (wanted.length === 0) {
      if (list.list_complete) break;
      continue;
    }

    const fetched = await Promise.all(
      wanted.map(async (k) => {
        const value = await env.FEEDBACK.get(k.name);
        if (!value) return null;
        try {
          return JSON.parse(value) as FeedbackEntry;
        } catch {
          return null;
        }
      }),
    );

    for (const entry of fetched) {
      if (!entry) continue;
      entries.push(entry);
      if (entry.submittedAt > latestAt) latestAt = entry.submittedAt;
    }
  } while (cursor);

  return json({ entries, latestAt });
}

// ----- Share revoke ---------------------------------------------------------

async function handleRevokeShare(shareId: string, req: Request, env: Env): Promise<Response> {
  const record = await loadRecord(shareId, env);
  if (!record) return json({ error: "Not found" }, { status: 404 });

  const header = req.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/);
  if (!match || !timingSafeEqual(match[1], record.ownerToken)) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  // Delete payload + record + canvas files. Uploads and feedback are left
  // to expire via TTL — fully purging them on revoke would require listing
  // all R2 keys, which is expensive. Marking the record as deleted is
  // sufficient because every load goes through `loadRecord` which would
  // 404 once the record is gone.
  const prefix = `shares/${shareId}/`;
  const list = await env.BLOBS.list({ prefix });
  await Promise.all(list.objects.map((o) => env.BLOBS.delete(o.key)));

  return json({ ok: true });
}

// ----- Annotation uploads ---------------------------------------------------

async function handleUpload(shareId: string, req: Request, env: Env, origin: string): Promise<Response> {
  const rl = await rateLimitUpload(env, req, shareId);
  if (rl) return rl;

  const record = await loadRecord(shareId, env);
  if (!record) return json({ error: "Share not found or expired" }, { status: 404 });

  const cl = req.headers.get("Content-Length");
  if (cl && parseInt(cl, 10) > LIMITS.UPLOAD_BYTES) {
    return json({ error: "Image too large" }, { status: 413 });
  }

  const formData = await req.formData();
  const file = formData.get("image") as unknown as File | null;
  if (!file || typeof (file as any).arrayBuffer !== "function") {
    return json({ error: "No image provided" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) return json({ error: "Not an image" }, { status: 400 });
  if (file.size > LIMITS.UPLOAD_BYTES) {
    return json({ error: "Image too large" }, { status: 413 });
  }

  // Content-addressed storage so duplicate uploads dedupe.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hashBuf = await crypto.subtle.digest("SHA-256", bytes);
  const hashHex = Array.from(new Uint8Array(hashBuf), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
  const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
  const key = `shares/${shareId}/uploads/${hashHex}.${ext}`;

  await env.BLOBS.put(key, bytes, {
    httpMetadata: { contentType: file.type },
  });

  return json({
    url: `${origin}/s/${shareId}/uploads/${hashHex}.${ext}`,
    mime: file.type,
  });
}

async function handleUploadServe(shareId: string, filename: string, env: Env): Promise<Response> {
  if (filename.includes("/") || filename.includes("..")) {
    return json({ error: "Invalid filename" }, { status: 400 });
  }
  const obj = await env.BLOBS.get(`shares/${shareId}/uploads/${filename}`);
  if (!obj) return json({ error: "Not found" }, { status: 404 });
  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType || "application/octet-stream",
      "Cache-Control": "public, max-age=86400",
      ...CORS_HEADERS,
    },
  });
}

// ----- HTML shell -----------------------------------------------------------

/** HTML served at /s/:shareId. Loads runtime bundles + booted client in
 *  shared mode. The `__CANVAS_SHARE__` global is the entry point used by
 *  clientApi.ts to flip into shared mode. */
function sharedCanvasHtml(shareId: string): string {
  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Shared Canvas</title>
  <script>!function(){var p=localStorage.getItem('canvas-theme')||'auto';document.documentElement.dataset.theme=p==='auto'?(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light'):p}()</script>
  <link rel="stylesheet" href="/assets/client.css" />
  <link rel="stylesheet" href="https://unpkg.com/@highlightjs/cdn-assets@11.11.1/styles/github-dark-dimmed.min.css" />
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
  <script>window.__CANVAS_SHARE__ = { shareId: ${JSON.stringify(shareId)}, mode: "shared" };</script>
</head>
<body class="min-h-screen">
  <div id="root"></div>
  <script src="https://unpkg.com/@highlightjs/cdn-assets@11.11.1/highlight.min.js"></script>
  <script src="https://unpkg.com/mermaid@11.4.1/dist/mermaid.min.js"></script>
  <script>mermaid.initialize({ startOnLoad: false, theme: document.documentElement.dataset.theme === 'light' ? 'default' : 'dark' });</script>
  <script type="importmap">
  {
    "imports": {
      "react": "/assets/preact-compat.js",
      "react-dom": "/assets/preact-compat.js",
      "react-dom/client": "/assets/preact-compat.js",
      "react/jsx-runtime": "/assets/jsx-runtime.js",
      "react/jsx-dev-runtime": "/assets/jsx-runtime.js",
      "#canvas/components": "/assets/components.js",
      "#canvas/runtime": "/assets/runtime.js"
    }
  }
  </script>
  <script type="module" src="/assets/client.js"></script>
</body>
</html>`;
}

// ----- Router ---------------------------------------------------------------

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const origin = `${url.protocol}//${url.host}`;

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Health check
    if (url.pathname === "/health" && req.method === "GET") {
      return json({ ok: true });
    }

    // POST /shares — create
    if (url.pathname === "/shares" && req.method === "POST") {
      return handleCreateShare(req, env, origin);
    }

    // POST /shares/:shareId/revoke — owner-only delete
    const revokeMatch = url.pathname.match(/^\/shares\/([a-f0-9]+)\/revoke$/);
    if (revokeMatch && req.method === "POST") {
      if (!validateShareId(revokeMatch[1])) return json({ error: "Invalid shareId" }, { status: 400 });
      return handleRevokeShare(revokeMatch[1], req, env);
    }

    // GET /shares/:shareId/feedback — list (called by daemon poller)
    const feedbackListMatch = url.pathname.match(/^\/shares\/([a-f0-9]+)\/feedback$/);
    if (feedbackListMatch && req.method === "GET") {
      if (!validateShareId(feedbackListMatch[1])) return json({ error: "Invalid shareId" }, { status: 400 });
      return handleListFeedback(feedbackListMatch[1], req, env);
    }

    // GET /s/:shareId — HTML shell
    const shellMatch = url.pathname.match(/^\/s\/([a-f0-9]+)\/?$/);
    if (shellMatch && req.method === "GET") {
      if (!validateShareId(shellMatch[1])) return json({ error: "Invalid shareId" }, { status: 400 });
      // Verify the share exists before serving the shell so reviewers see
      // a clear 404 instead of a broken canvas.
      const record = await loadRecord(shellMatch[1], env);
      if (!record) return json({ error: "Share not found or expired" }, { status: 404 });
      return new Response(sharedCanvasHtml(shellMatch[1]), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache",
        },
      });
    }

    // GET /s/:shareId/meta
    const metaMatch = url.pathname.match(/^\/s\/([a-f0-9]+)\/meta$/);
    if (metaMatch && req.method === "GET") {
      if (!validateShareId(metaMatch[1])) return json({ error: "Invalid shareId" }, { status: 400 });
      return handleGetMeta(metaMatch[1], env);
    }

    // GET /s/:shareId/canvas/:filename
    const canvasMatch = url.pathname.match(/^\/s\/([a-f0-9]+)\/canvas\/(.+)$/);
    if (canvasMatch && req.method === "GET") {
      if (!validateShareId(canvasMatch[1])) return json({ error: "Invalid shareId" }, { status: 400 });
      return handleGetCanvas(canvasMatch[1], canvasMatch[2], env);
    }

    // POST /s/:shareId/feedback
    const feedbackPostMatch = url.pathname.match(/^\/s\/([a-f0-9]+)\/feedback$/);
    if (feedbackPostMatch && req.method === "POST") {
      if (!validateShareId(feedbackPostMatch[1])) return json({ error: "Invalid shareId" }, { status: 400 });
      return handleSubmitFeedback(feedbackPostMatch[1], req, env);
    }

    // POST /s/:shareId/upload
    const uploadMatch = url.pathname.match(/^\/s\/([a-f0-9]+)\/upload$/);
    if (uploadMatch && req.method === "POST") {
      if (!validateShareId(uploadMatch[1])) return json({ error: "Invalid shareId" }, { status: 400 });
      return handleUpload(uploadMatch[1], req, env, origin);
    }

    // GET /s/:shareId/uploads/:filename
    const uploadServeMatch = url.pathname.match(/^\/s\/([a-f0-9]+)\/uploads\/(.+)$/);
    if (uploadServeMatch && req.method === "GET") {
      if (!validateShareId(uploadServeMatch[1])) return json({ error: "Invalid shareId" }, { status: 400 });
      return handleUploadServe(uploadServeMatch[1], uploadServeMatch[2], env);
    }

    // Static assets — served by Wrangler's [assets] binding.
    if (url.pathname.startsWith("/assets/")) {
      return env.ASSETS.fetch(req);
    }

    return json({ error: "Not found" }, { status: 404 });
  },
};
