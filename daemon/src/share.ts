import type { SessionManager, ShareEntry } from "./session";

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
 */

export interface SharePayload {
  version: 1;
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
}

export function loadShareConfig(version: string): ShareConfig | null {
  const endpoint = process.env.CANVAS_SHARE_ENDPOINT;
  if (!endpoint) return null;
  return {
    endpoint: endpoint.replace(/\/+$/, ""),
    componentsVersion: version,
    ...(process.env.CANVAS_SHARE_AUTH_TOKEN ? { authToken: process.env.CANVAS_SHARE_AUTH_TOKEN } : {}),
  };
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
 * High-level: build payload, push to worker, record the share on the
 * session. Returns the ShareEntry that was recorded.
 */
export async function shareRevision(
  sessionManager: SessionManager,
  sessionId: string,
  revision: number,
  config: ShareConfig,
): Promise<ShareEntry> {
  const payload = buildSharePayload(sessionManager, sessionId, revision, config.componentsVersion);
  const response = await pushShareToWorker(payload, config);
  const entry: ShareEntry = {
    shareId: response.shareId,
    url: response.url,
    revision,
    createdAt: new Date().toISOString(),
    ...(response.ownerToken ? { ownerToken: response.ownerToken } : {}),
    ...(response.expiresAt ? { expiresAt: response.expiresAt } : {}),
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

