/**
 * Wire types shared between the daemon and the worker. Keep these in sync
 * with daemon/src/share.ts and daemon/src/session.ts. Treat this file as
 * the protocol definition — bump the `version` field in SharePayload
 * whenever the schema changes incompatibly.
 */

export interface Env {
  BLOBS: R2Bucket;
  FEEDBACK: KVNamespace;
  ASSETS: Fetcher;
  /** Optional. If set, share creation requires this token in
   *  `Authorization: Bearer <token>`. Recommended in production. */
  SHARE_AUTH_TOKEN?: string;
  /** Default share TTL in seconds. Defaults to 30 days. */
  SHARE_TTL_SECONDS?: string;
}

export interface EncryptionMeta {
  alg: "AES-GCM";
  v: 1;
}

export interface SharePayload {
  version: 1;
  /** Present when sessionId/label/compiledJs/sourceJsx are ciphertext. */
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
  runtime: { componentsVersion: string };
}

export interface ShareRecord {
  shareId: string;
  ownerToken: string;
  createdAt: string;
  expiresAt: string;
  componentsVersion: string;
  origin: SharePayload["origin"];
  canvasFilenames: string[];
  /** Mirrored from the SharePayload so consumers (meta endpoint, daemon
   *  feedback poller) know whether they're looking at ciphertext fields. */
  encryption?: EncryptionMeta;
}

export interface FeedbackPostBody {
  author: { id?: string; name: string };
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
  revision: number;
  /** Present when name/snippet/note/etc. fields are ciphertext. The worker
   *  stores the marker verbatim; the daemon uses it to decide whether to
   *  decrypt with the share's encryption key. */
  encryption?: EncryptionMeta;
}

export interface FeedbackEntry {
  id: string;
  shareId: string;
  revision: number;
  submittedAt: string;
  author: { id: string; name: string };
  annotations: FeedbackPostBody["annotations"];
  generalNote?: string;
  encryption?: EncryptionMeta;
}

// --- Limits — single source of truth -------------------------------------

export const LIMITS = {
  /** Maximum size of a single share payload (POST /shares body). */
  SHARE_PAYLOAD_BYTES: 2 * 1024 * 1024, // 2 MB
  /** Maximum size of a single feedback POST body. */
  FEEDBACK_BODY_BYTES: 256 * 1024, // 256 KB
  /** Maximum size of an annotation upload. */
  UPLOAD_BYTES: 5 * 1024 * 1024, // 5 MB
  /** Maximum length of a reviewer-supplied display name (plaintext mode). */
  AUTHOR_NAME_LENGTH: 80,
  /** Loose upper bound for `author.name` accepted by validation. Plaintext
   *  names are sliced down to AUTHOR_NAME_LENGTH in the handler; ciphertext
   *  names from encrypted shares need extra headroom for IV + tag + base64
   *  overhead and the unknown plaintext length. 1 KB is plenty. */
  AUTHOR_NAME_CIPHERTEXT_LENGTH: 1024,
  /** Maximum number of annotations per feedback submission. */
  MAX_ANNOTATIONS_PER_FEEDBACK: 200,
  /** Maximum length of generalNote markdown (plaintext mode). */
  GENERAL_NOTE_LENGTH: 10_000,
  /** Loose upper bound for `generalNote` accepted by validation. */
  GENERAL_NOTE_CIPHERTEXT_LENGTH: 32_000,
  /** Default share TTL when SHARE_TTL_SECONDS env var is not set. */
  DEFAULT_SHARE_TTL_SECONDS: 30 * 24 * 60 * 60,
} as const;

export const RATE_LIMITS = {
  /** Max share creates per minute, keyed by client IP. */
  SHARE_CREATE_PER_MINUTE: 5,
  /** Max feedback submissions per minute, keyed by client IP + shareId. */
  FEEDBACK_PER_MINUTE: 20,
  /** Max uploads per minute, keyed by client IP + shareId. */
  UPLOAD_PER_MINUTE: 30,
} as const;
