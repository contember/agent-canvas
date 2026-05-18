/**
 * AES-GCM-256 helpers for end-to-end encrypted canvas shares.
 *
 * The same module is loaded in the browser (decrypts payloads) and in the
 * daemon's Bun runtime (encrypts payloads + decrypts polled feedback). It
 * only uses `crypto.subtle`, `TextEncoder`/`TextDecoder`, and
 * `btoa`/`atob` — all available in both environments.
 *
 * Wire format
 * -----------
 * - Key: 32 random bytes, transported in the URL fragment as base64url
 *   (e.g. `#k=<key>`). Fragments are never sent to the worker, so the
 *   worker cannot decrypt the payloads it stores.
 * - Each encrypted string is `base64(IV || ciphertext-with-tag)` where the
 *   IV is 12 fresh random bytes. This is the standard AES-GCM packing.
 * - The presence of an `encryption: { alg: "AES-GCM", v: 1 }` marker on a
 *   SharePayload / FeedbackPostBody / ShareRecord tells the consumer that
 *   the marked fields contain ciphertext rather than plaintext.
 */

export const CRYPTO_ALG = "AES-GCM" as const;
export const CRYPTO_VERSION = 1 as const;

export interface EncryptionMeta {
  alg: typeof CRYPTO_ALG;
  v: typeof CRYPTO_VERSION;
}

export const ENCRYPTION_META: EncryptionMeta = { alg: CRYPTO_ALG, v: CRYPTO_VERSION };

/** Generate a fresh 256-bit AES-GCM key. */
export async function generateShareKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: CRYPTO_ALG, length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
}

/** Export a CryptoKey to a base64url string suitable for URL fragments. */
export async function exportShareKey(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey("raw", key);
  return b64urlFromBytes(new Uint8Array(raw));
}

/** Import a base64url-encoded key for AES-GCM. */
export async function importShareKey(encoded: string): Promise<CryptoKey> {
  const raw = bytesFromB64url(encoded);
  return crypto.subtle.importKey(
    "raw",
    raw as BufferSource,
    { name: CRYPTO_ALG, length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Encrypt a UTF-8 string. Returns base64(IV || ciphertext+tag). */
export async function encryptString(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(plaintext);
  const ct = await crypto.subtle.encrypt(
    { name: CRYPTO_ALG, iv: iv as BufferSource },
    key,
    data as BufferSource,
  );
  const combined = new Uint8Array(iv.byteLength + ct.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ct), iv.byteLength);
  return b64FromBytes(combined);
}

/** Decrypt a base64-encoded ciphertext back to a UTF-8 string. */
export async function decryptString(key: CryptoKey, ciphertext: string): Promise<string> {
  const combined = bytesFromB64(ciphertext);
  if (combined.byteLength < 12 + 16) throw new Error("Ciphertext too short");
  const iv = combined.subarray(0, 12);
  const ct = combined.subarray(12);
  const pt = await crypto.subtle.decrypt(
    { name: CRYPTO_ALG, iv: iv as BufferSource },
    key,
    ct as BufferSource,
  );
  return new TextDecoder().decode(pt);
}

/** Convenience: encrypt a JSON-serializable value as a single ciphertext blob. */
export async function encryptJson(key: CryptoKey, value: unknown): Promise<string> {
  return encryptString(key, JSON.stringify(value));
}

/** Convenience: decrypt a ciphertext blob into a JSON value. */
export async function decryptJson<T = unknown>(key: CryptoKey, ciphertext: string): Promise<T> {
  return JSON.parse(await decryptString(key, ciphertext)) as T;
}

// --- base64 helpers ---------------------------------------------------------

function b64FromBytes(bytes: Uint8Array): string {
  let bin = "";
  // Chunk to avoid stack overflow on large inputs.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.byteLength; i += CHUNK) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(bin);
}

function bytesFromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlFromBytes(bytes: Uint8Array): string {
  return b64FromBytes(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function bytesFromB64url(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return bytesFromB64(padded);
}
