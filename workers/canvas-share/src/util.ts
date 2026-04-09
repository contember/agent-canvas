import type { Env } from "./types";
import { RATE_LIMITS } from "./types";

/**
 * Liberal CORS — the worker is intentionally open. The shared canvas is
 * loaded from the worker's own origin so reviewer fetches are same-origin
 * anyway. The daemon polls server-to-server and is exempt from CORS. We
 * keep `*` for resilience against future deployments behind alternate
 * origins (e.g. custom domain in front of the worker).
 */
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
};

export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
      ...(init.headers || {}),
    },
  });
}

/** Hex-encoded random id of `byteLen` bytes (always lowercase). */
export function randomHexId(byteLen = 12): string {
  const bytes = new Uint8Array(byteLen);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** SHA-256(message) hex */
export async function sha256Hex(message: string | Uint8Array): Promise<string> {
  const data = typeof message === "string" ? new TextEncoder().encode(message) : message;
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string comparison. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/** Best-effort client IP from request headers (CF or X-Forwarded-For). */
export function clientIp(req: Request): string {
  return req.headers.get("CF-Connecting-IP")
    || req.headers.get("X-Forwarded-For")?.split(",")[0]?.trim()
    || "unknown";
}

/**
 * Simple sliding-window rate limiter using KV with per-minute buckets.
 * Returns `null` if the request is allowed; returns a `Response` (HTTP 429)
 * if it's rate-limited so the caller can early-return.
 *
 * Note: KV is eventually consistent, so a determined attacker can race the
 * limit by ~1 bucket. For the threat model here (abuse prevention, not
 * cryptographic auth) that's acceptable.
 */
export async function checkRateLimit(
  env: Env,
  bucket: string,
  identityKey: string,
  maxPerMinute: number,
): Promise<Response | null> {
  const minute = Math.floor(Date.now() / 60_000);
  const key = `rl:${bucket}:${identityKey}:${minute}`;
  const current = parseInt((await env.FEEDBACK.get(key)) || "0", 10);
  if (current >= maxPerMinute) {
    return json(
      { error: "Rate limit exceeded. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": "60" },
      },
    );
  }
  // Increment and persist with a 2-minute TTL so the bucket auto-expires.
  await env.FEEDBACK.put(key, String(current + 1), { expirationTtl: 120 });
  return null;
}

export async function rateLimitShareCreate(env: Env, req: Request): Promise<Response | null> {
  const ip = clientIp(req);
  return checkRateLimit(env, "share", ip, RATE_LIMITS.SHARE_CREATE_PER_MINUTE);
}

export async function rateLimitFeedback(env: Env, req: Request, shareId: string): Promise<Response | null> {
  const ip = clientIp(req);
  return checkRateLimit(env, "fb", `${ip}:${shareId}`, RATE_LIMITS.FEEDBACK_PER_MINUTE);
}

export async function rateLimitUpload(env: Env, req: Request, shareId: string): Promise<Response | null> {
  const ip = clientIp(req);
  return checkRateLimit(env, "up", `${ip}:${shareId}`, RATE_LIMITS.UPLOAD_PER_MINUTE);
}

/**
 * Verify the optional shared-secret bearer token used to gate share
 * creation. Returns null if auth is OK, otherwise an error Response.
 */
export function verifyShareAuth(env: Env, req: Request): Response | null {
  if (!env.SHARE_AUTH_TOKEN) return null; // open mode (dev)
  const header = req.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/);
  if (!match || !timingSafeEqual(match[1], env.SHARE_AUTH_TOKEN)) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

/** Reads the request body as text but rejects if Content-Length exceeds the limit. */
export async function readBodyWithLimit(req: Request, maxBytes: number): Promise<string | Response> {
  const cl = req.headers.get("Content-Length");
  if (cl && parseInt(cl, 10) > maxBytes) {
    return json(
      { error: `Body too large (${maxBytes} bytes max)` },
      { status: 413 },
    );
  }
  // Defensive: also enforce by counting bytes during read.
  const reader = req.body?.getReader();
  if (!reader) return "";
  let received = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.length;
    if (received > maxBytes) {
      try { reader.cancel(); } catch {}
      return json(
        { error: `Body too large (${maxBytes} bytes max)` },
        { status: 413 },
      );
    }
    chunks.push(value);
  }
  // Join chunks into a single string. For our payloads (≤ 2 MB) this is fine.
  let total = 0;
  for (const c of chunks) total += c.length;
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { merged.set(c, offset); offset += c.length; }
  return new TextDecoder().decode(merged);
}
