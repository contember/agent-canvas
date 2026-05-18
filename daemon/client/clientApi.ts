/**
 * Client API layer — abstracts over daemon-local vs. shared (CF Worker)
 * modes. Every fetch-adjacent function in the client should go through
 * this module instead of hardcoding URLs, so shared mode works without
 * scattering branches across components.
 *
 * Mode is determined once at module load by checking
 * `window.__CANVAS_SHARE__`, which the CF Worker injects into the HTML
 * shell it serves. Local daemon never sets this, so the app defaults to
 * local mode.
 *
 * End-to-end encryption
 * ---------------------
 * When the share URL carries a `#k=<base64url>` fragment, every secret
 * payload going over the wire is encrypted with that key:
 *   - canvas JS bodies (decrypted before being imported as ES modules),
 *   - origin.sessionId / origin.label in the meta response,
 *   - feedback fields submitted by the reviewer.
 * The key is never sent to the worker — browsers strip URL fragments
 * before issuing requests. Legacy shares with no fragment continue to
 * work in cleartext.
 */

import {
  importShareKey,
  encryptString,
  decryptString,
  ENCRYPTION_META,
  type EncryptionMeta,
} from "./shareCrypto";

declare global {
  interface Window {
    __CANVAS_SHARE__?: {
      shareId: string;
      mode: "shared";
    };
  }
}

export interface SharedModeInfo {
  isShared: true;
  shareId: string;
  /** Lazy-imported AES-GCM key parsed from the URL fragment, if any. */
  encryptionKey: Promise<CryptoKey> | null;
}

export interface LocalModeInfo {
  isShared: false;
  sessionId: string;
}

export type ModeInfo = SharedModeInfo | LocalModeInfo;

/** Strip the `#k=...` fragment and parse out the key (base64url). */
function readFragmentKey(): string | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return null;
  for (const part of hash.split("&")) {
    const [k, v] = part.split("=");
    if (k === "k" && v) return decodeURIComponent(v);
  }
  return null;
}

/** One-time detection. In shared mode the daemon-provided sessionId from
 *  the URL path is ignored in favor of the worker-injected shareId. */
export function detectMode(): ModeInfo {
  if (typeof window !== "undefined" && window.__CANVAS_SHARE__?.shareId) {
    const encoded = readFragmentKey();
    return {
      isShared: true,
      shareId: window.__CANVAS_SHARE__.shareId,
      encryptionKey: encoded ? importShareKey(encoded) : null,
    };
  }
  // Local: session id is the path suffix /s/:sessionId
  const sessionId = typeof window !== "undefined"
    ? window.location.pathname.replace("/s/", "")
    : "";
  return { isShared: false, sessionId };
}

export const MODE: ModeInfo = detectMode();

/** True iff we're in a shared canvas AND have a fragment key. */
export function isEncryptedShare(): boolean {
  return MODE.isShared && MODE.encryptionKey !== null;
}

/** Build a canonical id-ish string used as React keys / identifiers. */
export function getIdentifier(): string {
  return MODE.isShared ? MODE.shareId : MODE.sessionId;
}

// --- URL builders -----------------------------------------------------------

/** Metadata endpoint (revisions, canvas files, project root). */
export function metaUrl(): string {
  if (MODE.isShared) return `/s/${MODE.shareId}/meta`;
  return `/api/session/${MODE.sessionId}/meta`;
}

/** Compiled canvas JS module for a given filename (+ optional revision). */
export function canvasJsUrl(filename: string, revision?: number): string {
  const jsName = filename.replace(/\.jsx$/, ".js");
  if (MODE.isShared) {
    return `/s/${MODE.shareId}/canvas/${encodeURIComponent(jsName)}`;
  }
  const rev = revision ? `?rev=${revision}&t=${Date.now()}` : `?t=${Date.now()}`;
  return `/api/session/${MODE.sessionId}/canvas/${encodeURIComponent(jsName)}${rev}`;
}

/** Upload endpoint for annotation images. */
export function uploadUrl(): string {
  if (MODE.isShared) return `/s/${MODE.shareId}/upload`;
  return `/api/session/${MODE.sessionId}/upload`;
}

// --- Meta fetch (with optional decryption) ---------------------------------

interface RawMetaResponse {
  encryption?: EncryptionMeta;
  origin?: { sessionId?: string; label?: string; revision?: number; createdAt?: string };
  [key: string]: unknown;
}

/** Fetch + parse meta, decrypting origin.sessionId/label for encrypted
 *  shares. The shape returned is the same as the worker/daemon emits, so
 *  callers don't have to branch. */
export async function fetchMeta(): Promise<any> {
  const res = await fetch(metaUrl());
  if (!res.ok) throw new Error(`meta ${res.status}`);
  const data = (await res.json()) as RawMetaResponse;

  if (data.encryption && MODE.isShared && MODE.encryptionKey) {
    const key = await MODE.encryptionKey;
    if (data.origin) {
      const o: any = { ...data.origin };
      if (o.sessionId) o.sessionId = await decryptString(key, o.sessionId);
      if (o.label) o.label = await decryptString(key, o.label);
      data.origin = o;
    }
    // The worker synthesizes a one-element revisions array from the same
    // ShareRecord.origin, so its `label` is also ciphertext — decrypt it
    // in lockstep with origin.label above.
    const revs = (data as any).revisions;
    if (Array.isArray(revs)) {
      for (const r of revs) {
        if (r.label) {
          try { r.label = await decryptString(key, r.label); } catch {}
        }
      }
    }
  }
  return data;
}

// --- Canvas module loading -------------------------------------------------

/** Dynamically import the compiled canvas JS for a revision. In encrypted
 *  shared mode the body is ciphertext, so we fetch it, decrypt to plain JS
 *  source, then materialize as a Blob URL the browser can `import()`.
 *  Import maps still apply to Blob-URL module imports, so the resulting
 *  module's `#canvas/runtime` / `#canvas/components` imports resolve
 *  exactly as they would for an in-place script. */
export async function loadCanvasModule(filename: string, revision?: number): Promise<any> {
  const url = canvasJsUrl(filename, revision);
  if (!isEncryptedShare()) {
    return import(/* @vite-ignore */ url);
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`canvas ${res.status}`);
  const ciphertext = await res.text();
  const key = await (MODE as SharedModeInfo).encryptionKey!;
  const js = await decryptString(key, ciphertext);
  const blob = new Blob([js], { type: "application/javascript" });
  const blobUrl = URL.createObjectURL(blob);
  try {
    return await import(/* @vite-ignore */ blobUrl);
  } finally {
    // Revoke after a tick so the import has fully resolved its source.
    setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
  }
}

// --- Feedback submission ----------------------------------------------------

/**
 * Local-mode author info used when submitting feedback in shared mode.
 * Prompted on first submit and cached in localStorage.
 */
const REVIEWER_KEY = "canvas-reviewer-identity";

export function getReviewerIdentity(): { id: string; name: string } | null {
  try {
    const raw = localStorage.getItem(REVIEWER_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setReviewerIdentity(name: string): { id: string; name: string } {
  let existing = getReviewerIdentity();
  if (!existing) {
    existing = { id: crypto.randomUUID?.() || String(Date.now()), name };
  } else {
    existing.name = name;
  }
  localStorage.setItem(REVIEWER_KEY, JSON.stringify(existing));
  return existing;
}

/**
 * Shape submitted by the shared-mode client when a reviewer submits
 * feedback. Matches the worker's `FeedbackPostBody`.
 */
export interface SharedFeedbackPayload {
  author: { id: string; name: string };
  revision: number;
  annotations: Array<Record<string, unknown>>;
  generalNote?: string;
}

/** Encrypt the secret fields of a feedback payload in-place semantics. */
async function encryptFeedback(
  payload: SharedFeedbackPayload,
  key: CryptoKey,
): Promise<SharedFeedbackPayload & { encryption: EncryptionMeta }> {
  const annotations = await Promise.all(
    payload.annotations.map(async (a) => {
      const out: Record<string, unknown> = {
        id: a.id,
        createdAt: a.createdAt,
        snippet: await encryptString(key, String(a.snippet ?? "")),
        note: await encryptString(key, String(a.note ?? "")),
      };
      if (a.filePath) out.filePath = await encryptString(key, String(a.filePath));
      if (a.canvasFile) out.canvasFile = await encryptString(key, String(a.canvasFile));
      if (a.context !== undefined && a.context !== null) {
        out.context = await encryptString(key, JSON.stringify(a.context));
      }
      // Image attachments are content-addressed worker URLs — already public
      // by virtue of being served by the worker, so leaving them plaintext
      // is fine and avoids breaking client-side rendering of the URL.
      if (a.attachments) out.attachments = a.attachments;
      return out;
    }),
  );
  return {
    author: {
      id: payload.author.id,
      name: await encryptString(key, payload.author.name),
    },
    revision: payload.revision,
    annotations,
    ...(payload.generalNote ? { generalNote: await encryptString(key, payload.generalNote) } : {}),
    encryption: ENCRYPTION_META,
  };
}

/**
 * Submit feedback in shared mode. Throws on HTTP error. Caller is
 * responsible for collecting + prompting for the reviewer's name before
 * invoking this. Transparently encrypts when the share URL carried a
 * fragment key.
 */
export async function submitSharedFeedback(payload: SharedFeedbackPayload): Promise<void> {
  if (!MODE.isShared) throw new Error("submitSharedFeedback called outside shared mode");
  let body: unknown = payload;
  if (MODE.encryptionKey) {
    const key = await MODE.encryptionKey;
    body = await encryptFeedback(payload, key);
  }
  const res = await fetch(`/s/${MODE.shareId}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Feedback submission failed: ${res.status} ${text}`);
  }
}

// --- Feature flags ----------------------------------------------------------

/** Are daemon-only filesystem endpoints (file tree, file viewer) available? */
export const FS_AVAILABLE: boolean = !MODE.isShared;

/** Is live WebSocket session updates available? */
export const WS_AVAILABLE: boolean = !MODE.isShared;
