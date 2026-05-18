import type { SessionManager, RemoteFeedbackEntry, RemoteAnnotation } from "./session";
import { loadShareConfig } from "./share";
import { importShareKey, decryptString } from "../client/shareCrypto";

/**
 * Background polling loop for remote feedback.
 *
 * For every session that has at least one share, periodically asks the
 * CF Worker for feedback submitted since we last checked. New entries are
 * persisted locally (as `remote_feedback.json` per revision) and broadcast
 * to any connected browser WebSockets so the UI can merge them into the
 * annotation layer in real time.
 *
 * The polling loop is cheap: one HTTP call per share per 5 seconds. If no
 * shares exist anywhere, the loop sleeps. If the worker is unreachable,
 * errors are logged but the loop keeps running so feedback is picked up
 * as soon as the worker comes back.
 */

const POLL_INTERVAL_MS = 5_000;
const MAX_BACKOFF_MS = 60_000;

/** Wire-format feedback entry as returned by the worker. When the
 *  reviewer submitted from an encrypted share their browser ciphertexted
 *  the secret fields and stamped this with `encryption`; the daemon
 *  decrypts using the key stashed on the local ShareEntry. */
interface WireFeedbackEntry {
  id: string;
  shareId: string;
  revision: number;
  submittedAt: string;
  author: { id: string; name: string };
  annotations: Array<{
    id: string;
    snippet: string;
    note: string;
    createdAt: string;
    filePath?: string;
    canvasFile?: string;
    context?: unknown;
    attachments?: Array<{ url: string; mime?: string }>;
  }>;
  generalNote?: string;
  encryption?: { alg: string; v: number };
}

interface WorkerFeedbackResponse {
  entries: WireFeedbackEntry[];
  /** Server-reported high water mark — echo back in the next `since` param */
  latestAt?: string;
}

/** Decrypt an encrypted-wire feedback entry into the plaintext shape used
 *  throughout the rest of the daemon. Throws if any field fails to
 *  decrypt — caller treats that as a transient error so we re-try later. */
async function decryptFeedbackEntry(entry: WireFeedbackEntry, key: CryptoKey): Promise<RemoteFeedbackEntry> {
  const annotations: RemoteAnnotation[] = await Promise.all(
    entry.annotations.map(async (a) => {
      const out: RemoteAnnotation = {
        id: a.id,
        snippet: await decryptString(key, a.snippet),
        note: await decryptString(key, a.note),
        createdAt: a.createdAt,
      };
      if (a.filePath) out.filePath = await decryptString(key, a.filePath);
      if (a.canvasFile) out.canvasFile = await decryptString(key, a.canvasFile);
      if (typeof a.context === "string" && a.context.length > 0) {
        out.context = JSON.parse(await decryptString(key, a.context));
      }
      if (a.attachments) out.attachments = a.attachments;
      return out;
    }),
  );

  return {
    id: entry.id,
    shareId: entry.shareId,
    revision: entry.revision,
    submittedAt: entry.submittedAt,
    author: {
      id: entry.author.id,
      name: await decryptString(key, entry.author.name),
    },
    annotations,
    ...(entry.generalNote ? { generalNote: await decryptString(key, entry.generalNote) } : {}),
  };
}

export function startRemoteFeedbackPoller(
  sessionManager: SessionManager,
  broadcastRemoteFeedback: (sessionId: string, revision: number, entries: RemoteFeedbackEntry[]) => void,
  version: string,
): { stop: () => void } {
  let stopped = false;

  // Per-share CryptoKey cache — `importKey` is async and pure given the
  // same encoded key, so we memoize it for the lifetime of the poller.
  const keyCache = new Map<string, Promise<CryptoKey>>();
  function getKey(shareId: string, encoded: string): Promise<CryptoKey> {
    let cached = keyCache.get(shareId);
    if (!cached) {
      cached = importShareKey(encoded);
      keyCache.set(shareId, cached);
    }
    return cached;
  }

  // Per-share consecutive error count → exponential backoff so a dead
  // worker doesn't generate a fire-hose of failed requests.
  const errorCounts = new Map<string, number>();
  function backoffFor(shareId: string): number {
    const errors = errorCounts.get(shareId) || 0;
    if (errors === 0) return 0;
    return Math.min(MAX_BACKOFF_MS, POLL_INTERVAL_MS * Math.pow(2, errors - 1));
  }

  async function pollShare(
    sessionId: string,
    share: { shareId: string; lastFeedbackAt?: string; encryptionKey?: string },
    endpoint: string,
  ) {
    try {
      const since = share.lastFeedbackAt ?? "";
      const url = `${endpoint}/shares/${share.shareId}/feedback${since ? `?since=${encodeURIComponent(since)}` : ""}`;
      const res = await fetch(url);
      if (!res.ok) {
        if (res.status === 404) {
          // Share no longer exists on the worker — likely revoked or expired.
          // Stop trying so we don't hammer it forever.
          errorCounts.set(share.shareId, 99);
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as WorkerFeedbackResponse;
      errorCounts.delete(share.shareId);

      if (!data.entries || data.entries.length === 0) return;

      // Decrypt any entries that came in encrypted. Plaintext entries
      // (legacy submissions from non-encrypted shares) pass through.
      const decrypted: RemoteFeedbackEntry[] = [];
      for (const e of data.entries) {
        if (e.encryption) {
          if (!share.encryptionKey) {
            console.warn(`[remote-feedback] ${share.shareId}: received encrypted feedback but no local key — skipping entry ${e.id}`);
            continue;
          }
          try {
            const key = await getKey(share.shareId, share.encryptionKey);
            decrypted.push(await decryptFeedbackEntry(e, key));
          } catch (err: any) {
            console.warn(`[remote-feedback] ${share.shareId}: failed to decrypt entry ${e.id}: ${err.message || err}`);
            continue;
          }
        } else {
          decrypted.push(e as RemoteFeedbackEntry);
        }
      }

      if (decrypted.length === 0) return;

      const byRev = new Map<number, RemoteFeedbackEntry[]>();
      for (const e of decrypted) {
        if (!byRev.has(e.revision)) byRev.set(e.revision, []);
        byRev.get(e.revision)!.push(e);
      }

      for (const [rev, entries] of byRev) {
        sessionManager.appendRemoteFeedback(sessionId, rev, entries);
        broadcastRemoteFeedback(sessionId, rev, entries);
      }

      const latest = data.latestAt
        ?? data.entries.reduce((acc, e) => (e.submittedAt > acc ? e.submittedAt : acc), share.lastFeedbackAt ?? "");
      if (latest) {
        sessionManager.updateShareLastFeedback(sessionId, share.shareId, latest);
      }
    } catch (e: any) {
      errorCounts.set(share.shareId, (errorCounts.get(share.shareId) || 0) + 1);
      console.warn(`[remote-feedback] ${share.shareId}: ${e.message || e} (will retry with backoff)`);
    }
  }

  // Per-share next-poll timestamps so backoffs are independent.
  const nextPollAt = new Map<string, number>();

  async function pollOnce() {
    const config = loadShareConfig(version);
    if (!config) return;

    const sessions = sessionManager.listSessionsWithShares();
    if (sessions.length === 0) return;

    const now = Date.now();
    const tasks: Promise<void>[] = [];
    for (const session of sessions) {
      for (const share of session.shares ?? []) {
        const next = nextPollAt.get(share.shareId) || 0;
        if (now < next) continue;
        // Skip "permanently dead" shares (after a 404).
        if ((errorCounts.get(share.shareId) || 0) >= 99) continue;
        nextPollAt.set(share.shareId, now + Math.max(POLL_INTERVAL_MS, backoffFor(share.shareId)));
        tasks.push(pollShare(session.id, share, config.endpoint));
      }
    }
    await Promise.all(tasks);
  }

  async function loop() {
    while (!stopped) {
      try {
        await pollOnce();
      } catch (e: any) {
        console.warn(`[remote-feedback] loop error: ${e.message || e}`);
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }

  loop();

  return {
    stop: () => {
      stopped = true;
    },
  };
}
