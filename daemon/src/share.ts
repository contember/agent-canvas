import type { SessionManager, ShareEntry } from "./session";
import {
  generateShareKey,
  exportShareKey,
  encryptString,
  ENCRYPTION_META,
  type EncryptionMeta,
} from "../client/shareCrypto";

/**
 * Canvas sharing: packages a specific revision into a self-contained
 * snapshot and POSTs it to the configured cloud endpoint (CF Worker).
 *
 * The cloud endpoint stores the snapshot and returns a public capability
 * URL that the author can send to reviewers. Runtime bundles
 * (react/preact-compat, runtime.js, components.js) are NOT bundled into the
 * payload — the worker serves matching runtime from its own deploy, keyed
 * off `runtime.componentsVersion` in the payload. This keeps shares small
 * while still guaranteeing version compatibility.
 *
 * End-to-end encryption (default on)
 * ----------------------------------
 * Unless `CANVAS_SHARE_ENCRYPTION=off`, each share is encrypted with a
 * fresh AES-GCM-256 key generated client-side here. The key is embedded
 * in the returned URL as a `#k=<base64url>` fragment, which browsers do
 * not transmit to the worker. The worker stores opaque ciphertext and
 * routing metadata only. The daemon retains the key on `ShareEntry` so it
 * can also decrypt feedback polled from the worker.
 *
 * Legacy unencrypted shares remain supported: the worker accepts both
 * formats, and the browser detects which one to use based on the URL
 * fragment.
 */

export interface SharePayload {
  version: 1;
  /** Present iff payload fields below are ciphertext rather than plaintext. */
  encryption?: EncryptionMeta;
  origin: {
    sessionId: string;
    revision: number;
    label?: string;
    createdAt: string;
  };
  canvasFiles: Array<{
    filename: string;
    compiledJs: string;
    sourceJsx?: string;
  }>;
  runtime: {
    componentsVersion: string;
  };
}

export interface ShareResponse {
  shareId: string;
  url: string;
  ownerToken?: string;
  expiresAt?: string;
}

export interface ShareConfig {
  /** Base URL of the share worker, e.g. `https://canvas-share.example.workers.dev` */
  endpoint: string;
  /** Version of the @agent-canvas runtime bundles — worker uses this to pick matching runtime */
  componentsVersion: string;
  /** Optional bearer token. If the worker has SHARE_AUTH_TOKEN set, this
   *  must match. Loaded from CANVAS_SHARE_AUTH_TOKEN env var on the daemon. */
  authToken?: string;
  /** End-to-end encryption setting. Defaults to true. */
  encryption?: boolean;
}

export function loadShareConfig(version: string): ShareConfig | null {
  const endpoint = process.env.CANVAS_SHARE_ENDPOINT ?? "https://canvas.contember.com";
  if (!endpoint) return null;
  return {
    endpoint: endpoint.replace(/\/+$/, ""),
    componentsVersion: version,
    encryption: !isEncryptionDisabled(),
    ...(process.env.CANVAS_SHARE_AUTH_TOKEN ? { authToken: process.env.CANVAS_SHARE_AUTH_TOKEN } : {}),
  };
}

function isEncryptionDisabled(): boolean {
  const v = (process.env.CANVAS_SHARE_ENCRYPTION ?? "").trim().toLowerCase();
  return v === "0" || v === "off" || v === "false" || v === "no";
}

/**
 * Build a SharePayload for the given session/revision. Reads the already
 * compiled JS from the session's revision directory. Also includes the
 * original JSX source for "view source" functionality on the shared canvas.
 */
export function buildSharePayload(
  sessionManager: SessionManager,
  sessionId: string,
  revision: number,
  componentsVersion: string,
): SharePayload {
  const session = sessionManager.get(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);

  const revInfo = session.revisions.find((r) => r.revision === revision);
  if (!revInfo) throw new Error(`Revision ${revision} not found in session ${sessionId}`);

  const canvasFiles: SharePayload["canvasFiles"] = [];
  for (const cf of revInfo.canvasFiles) {
    const compiledJs = sessionManager.getCompiled(sessionId, cf.filename, revision);
    if (!compiledJs) {
      throw new Error(`No compiled JS for ${cf.filename} at revision ${revision}`);
    }
    const sourceJsx = sessionManager.readRevisionJsx(sessionId, revision, cf.filename) ?? undefined;
    canvasFiles.push({
      filename: cf.filename,
      compiledJs,
      ...(sourceJsx ? { sourceJsx } : {}),
    });
  }

  return {
    version: 1,
    origin: {
      sessionId,
      revision,
      ...(revInfo.label ? { label: revInfo.label } : {}),
      createdAt: revInfo.createdAt,
    },
    canvasFiles,
    runtime: { componentsVersion },
  };
}

/**
 * Encrypt a plaintext SharePayload in-place semantics, returning a new
 * payload whose secret fields are ciphertext + the `encryption` marker.
 * Fields kept plaintext (and why):
 *  - `version`, `runtime.componentsVersion`: routing
 *  - `origin.revision`, `origin.createdAt`: indexing/display
 *  - `canvasFiles[].filename`: used as the route key by the worker
 * Everything else (sessionId, label, compiledJs, sourceJsx) is encrypted.
 */
export async function encryptSharePayload(
  payload: SharePayload,
  key: CryptoKey,
): Promise<SharePayload> {
  const canvasFiles = await Promise.all(
    payload.canvasFiles.map(async (cf) => ({
      filename: cf.filename,
      compiledJs: await encryptString(key, cf.compiledJs),
      ...(cf.sourceJsx ? { sourceJsx: await encryptString(key, cf.sourceJsx) } : {}),
    })),
  );
  return {
    version: payload.version,
    encryption: ENCRYPTION_META,
    origin: {
      sessionId: await encryptString(key, payload.origin.sessionId),
      revision: payload.origin.revision,
      ...(payload.origin.label
        ? { label: await encryptString(key, payload.origin.label) }
        : {}),
      createdAt: payload.origin.createdAt,
    },
    canvasFiles,
    runtime: payload.runtime,
  };
}

/**
 * POST the payload to the CF Worker. Returns the `shareId` + public URL
 * assigned by the worker. Throws on any HTTP error — the caller is expected
 * to surface the failure to the client (dialog) so the user can retry or
 * fix their config.
 */
export async function pushShareToWorker(
  payload: SharePayload,
  config: ShareConfig,
): Promise<ShareResponse> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.authToken) headers["Authorization"] = `Bearer ${config.authToken}`;

  const res = await fetch(`${config.endpoint}/shares`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Share endpoint returned ${res.status}: ${text || res.statusText}`);
  }
  const data = (await res.json()) as { shareId?: string; url?: string; ownerToken?: string; expiresAt?: string };
  if (!data.shareId || !data.url) {
    throw new Error(`Share endpoint returned invalid response: ${JSON.stringify(data)}`);
  }
  return {
    shareId: data.shareId,
    url: data.url,
    ...(data.ownerToken ? { ownerToken: data.ownerToken } : {}),
    ...(data.expiresAt ? { expiresAt: data.expiresAt } : {}),
  };
}

/**
 * High-level: build payload, optionally encrypt it, push to worker, record
 * the share on the session. The URL stored on the ShareEntry includes the
 * `#k=...` fragment when encryption is on so the user can simply copy &
 * paste it to reviewers.
 */
export async function shareRevision(
  sessionManager: SessionManager,
  sessionId: string,
  revision: number,
  config: ShareConfig,
): Promise<ShareEntry> {
  const plaintext = buildSharePayload(sessionManager, sessionId, revision, config.componentsVersion);

  const useEncryption = config.encryption !== false;
  let payload = plaintext;
  let encodedKey: string | undefined;
  if (useEncryption) {
    const key = await generateShareKey();
    encodedKey = await exportShareKey(key);
    payload = await encryptSharePayload(plaintext, key);
  }

  const response = await pushShareToWorker(payload, config);
  const url = encodedKey ? `${response.url}#k=${encodedKey}` : response.url;

  const entry: ShareEntry = {
    shareId: response.shareId,
    url,
    revision,
    createdAt: new Date().toISOString(),
    ...(response.ownerToken ? { ownerToken: response.ownerToken } : {}),
    ...(response.expiresAt ? { expiresAt: response.expiresAt } : {}),
    ...(encodedKey ? { encryptionKey: encodedKey } : {}),
  };
  sessionManager.addShare(sessionId, entry);
  return entry;
}

/**
 * Revoke a share by calling the worker's owner-only delete endpoint. Removes
 * it from the local session metadata on success.
 */
export async function revokeShare(
  sessionManager: SessionManager,
  sessionId: string,
  shareId: string,
  config: ShareConfig,
): Promise<void> {
  const session = sessionManager.get(sessionId);
  const entry = session?.shares?.find((s) => s.shareId === shareId);
  if (!entry) throw new Error(`Share ${shareId} not found`);
  if (!entry.ownerToken) throw new Error("No owner token recorded for this share");

  const res = await fetch(`${config.endpoint}/shares/${shareId}/revoke`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${entry.ownerToken}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Revoke failed: ${res.status} ${text}`);
  }
  sessionManager.removeShare(sessionId, shareId);
}
