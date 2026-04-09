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
 */

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
}

export interface LocalModeInfo {
  isShared: false;
  sessionId: string;
}

export type ModeInfo = SharedModeInfo | LocalModeInfo;

/** One-time detection. In shared mode the daemon-provided sessionId from
 *  the URL path is ignored in favor of the worker-injected shareId. */
export function detectMode(): ModeInfo {
  if (typeof window !== "undefined" && window.__CANVAS_SHARE__?.shareId) {
    return { isShared: true, shareId: window.__CANVAS_SHARE__.shareId };
  }
  // Local: session id is the path suffix /s/:sessionId
  const sessionId = typeof window !== "undefined"
    ? window.location.pathname.replace("/s/", "")
    : "";
  return { isShared: false, sessionId };
}

export const MODE: ModeInfo = detectMode();

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

/**
 * Submit feedback in shared mode. Throws on HTTP error. Caller is
 * responsible for collecting + prompting for the reviewer's name before
 * invoking this.
 */
export async function submitSharedFeedback(payload: SharedFeedbackPayload): Promise<void> {
  if (!MODE.isShared) throw new Error("submitSharedFeedback called outside shared mode");
  const res = await fetch(`/s/${MODE.shareId}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
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
