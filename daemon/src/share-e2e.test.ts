/**
 * End-to-end test: exercises daemon-side encryption + the real worker
 * fetch handler against in-memory R2/KV stubs, then plays the role of
 * the browser to decrypt the canvas JS and meta, and finally the role of
 * a reviewer to submit encrypted feedback and verify the daemon poller
 * decrypts it back.
 *
 * No network, no Miniflare — just direct fetch-handler invocation, which
 * exercises every production code path except the actual Workers runtime.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import workerHandler from "../../workers/canvas-share/src/index";
import type { Env } from "../../workers/canvas-share/src/types";
import { SessionManager } from "./session";
import { buildSharePayload, encryptSharePayload } from "./share";
import {
  generateShareKey,
  exportShareKey,
  importShareKey,
  encryptString,
  decryptString,
  ENCRYPTION_META,
} from "../client/shareCrypto";

// ---- Minimal in-memory R2 / KV stubs ---------------------------------------

function makeR2(): R2Bucket {
  const store = new Map<string, { body: Uint8Array; contentType?: string }>();
  return {
    async put(key: string, value: any, opts?: any) {
      const bytes = typeof value === "string"
        ? new TextEncoder().encode(value)
        : value instanceof Uint8Array
          ? value
          : new Uint8Array(await new Response(value).arrayBuffer());
      store.set(key, { body: bytes, contentType: opts?.httpMetadata?.contentType });
      return null as any;
    },
    async get(key: string) {
      const v = store.get(key);
      if (!v) return null;
      return {
        body: new Response(v.body).body,
        async text() { return new TextDecoder().decode(v.body); },
        async json() { return JSON.parse(new TextDecoder().decode(v.body)); },
        async arrayBuffer() { return v.body.buffer; },
        httpMetadata: { contentType: v.contentType },
      } as any;
    },
    async delete(key: string) { store.delete(key); },
    async list(opts?: any) {
      const prefix = opts?.prefix ?? "";
      const objects = [];
      for (const k of store.keys()) {
        if (k.startsWith(prefix)) objects.push({ key: k });
      }
      return { objects, truncated: false, delimitedPrefixes: [] } as any;
    },
  } as unknown as R2Bucket;
}

function makeKV(): KVNamespace {
  const store = new Map<string, { value: string; meta?: any; expireAt?: number }>();
  return {
    async put(key: string, value: string, opts?: any) {
      const expireAt = opts?.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : undefined;
      store.set(key, { value, meta: opts?.metadata, expireAt });
    },
    async get(key: string) {
      const v = store.get(key);
      if (!v) return null;
      if (v.expireAt && v.expireAt < Date.now()) { store.delete(key); return null; }
      return v.value;
    },
    async delete(key: string) { store.delete(key); },
    async list(opts?: any) {
      const prefix = opts?.prefix ?? "";
      const keys = [];
      for (const [k, v] of store.entries()) {
        if (!k.startsWith(prefix)) continue;
        if (v.expireAt && v.expireAt < Date.now()) continue;
        keys.push({ name: k, metadata: v.meta });
      }
      return { keys, list_complete: true, cursor: "" } as any;
    },
  } as unknown as KVNamespace;
}

function makeEnv(): Env {
  return {
    BLOBS: makeR2(),
    FEEDBACK: makeKV(),
    ASSETS: { fetch: async () => new Response("asset", { status: 200 }) } as any,
  };
}

// ---- The full flow ---------------------------------------------------------

describe("encrypted share e2e (daemon → worker → browser → reviewer → daemon)", () => {
  test("round-trips canvas JS, meta, and feedback through the real worker handler", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "canvas-e2e-"));
    try {
      // ----- 1. Daemon side: prepare a session + revision ------------------
      const sm = new SessionManager(testDir);
      const sid = "sess-secret-id";
      const SECRET_LABEL = "Secret quarterly plan";
      const SECRET_COMPILED = "/* SECRET */ export default function Plan(){ return null; }";
      const SECRET_JSX = "<Section title='Top secret'>Confidential strategy.</Section>";

      sm.upsert(sid, new Map([["plan.jsx", SECRET_JSX]]), "/tmp", SECRET_LABEL);
      sm.saveCompiled(sid, "plan.jsx", SECRET_COMPILED);

      // ----- 2. Daemon encrypts the payload --------------------------------
      const plaintext = buildSharePayload(sm, sid, 1, "1.0.0");
      const key = await generateShareKey();
      const encodedKey = await exportShareKey(key);
      const encryptedPayload = await encryptSharePayload(plaintext, key);

      // ----- 3. POST it to the real worker handler -------------------------
      const env = makeEnv();
      const createRes = await workerHandler.fetch(
        new Request("https://example.com/shares", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(encryptedPayload),
        }),
        env,
      );
      expect(createRes.status).toBe(200);
      const created = await createRes.json() as { shareId: string; url: string; ownerToken: string };
      expect(created.shareId).toMatch(/^[a-f0-9]{24}$/);
      expect(created.url).toBe(`https://example.com/s/${created.shareId}`);

      // ----- 4. Confirm what's stored in R2 is ciphertext, NOT plaintext ----
      const storedPayloadObj = await env.BLOBS.get(`shares/${created.shareId}/payload.json`);
      const storedPayload = JSON.parse(await storedPayloadObj!.text()) as any;
      expect(storedPayload.encryption).toEqual({ alg: "AES-GCM", v: 1 });
      expect(storedPayload.origin.sessionId).not.toBe(sid);
      expect(storedPayload.origin.label).not.toBe(SECRET_LABEL);
      expect(JSON.stringify(storedPayload)).not.toContain(SECRET_LABEL);
      expect(JSON.stringify(storedPayload)).not.toContain("SECRET");
      expect(JSON.stringify(storedPayload)).not.toContain("Confidential");

      const storedCanvasJsObj = await env.BLOBS.get(`shares/${created.shareId}/canvas/plan.js`);
      const storedCanvasJs = await storedCanvasJsObj!.text();
      expect(storedCanvasJs).not.toContain("SECRET");
      expect(storedCanvasJs).not.toContain("function Plan");

      // ----- 5. Browser side: fetch /meta, decrypt origin.label/sessionId --
      const metaRes = await workerHandler.fetch(
        new Request(`https://example.com/s/${created.shareId}/meta`),
        env,
      );
      expect(metaRes.status).toBe(200);
      const meta = await metaRes.json() as any;
      expect(meta.encryption).toEqual({ alg: "AES-GCM", v: 1 });

      const browserKey = await importShareKey(encodedKey);
      const decryptedSessionId = await decryptString(browserKey, meta.origin.sessionId);
      const decryptedLabel = await decryptString(browserKey, meta.origin.label);
      expect(decryptedSessionId).toBe(sid);
      expect(decryptedLabel).toBe(SECRET_LABEL);

      // ----- 6. Browser fetches canvas JS and decrypts it -------------------
      const canvasRes = await workerHandler.fetch(
        new Request(`https://example.com/s/${created.shareId}/canvas/plan.js`),
        env,
      );
      expect(canvasRes.status).toBe(200);
      const ciphertextBody = await canvasRes.text();
      const decryptedJs = await decryptString(browserKey, ciphertextBody);
      expect(decryptedJs).toBe(SECRET_COMPILED);

      // ----- 7. Reviewer submits encrypted feedback ------------------------
      const SECRET_NAME = "Dr. Confidential";
      const SECRET_NOTE = "This section reveals our pricing strategy.";
      const SECRET_GENERAL = "Overall: please redact slide 3 before sharing further.";
      const encryptedFeedback = {
        author: {
          id: "reviewer-1",
          name: await encryptString(browserKey, SECRET_NAME),
        },
        revision: 1,
        annotations: [{
          id: "ann-1",
          createdAt: "2026-05-18T12:00:00Z",
          snippet: await encryptString(browserKey, "[Section] Top secret"),
          note: await encryptString(browserKey, SECRET_NOTE),
          canvasFile: await encryptString(browserKey, "plan.jsx"),
        }],
        generalNote: await encryptString(browserKey, SECRET_GENERAL),
        encryption: ENCRYPTION_META,
      };

      const submitRes = await workerHandler.fetch(
        new Request(`https://example.com/s/${created.shareId}/feedback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(encryptedFeedback),
        }),
        env,
      );
      expect(submitRes.status).toBe(200);

      // ----- 8. Confirm KV-stored feedback has no plaintext leakage --------
      const kvList = await (env.FEEDBACK as any).list({ prefix: `fb:${created.shareId}:` });
      expect(kvList.keys.length).toBe(1);
      const kvValueRaw = await env.FEEDBACK.get(kvList.keys[0].name);
      expect(kvValueRaw).not.toBeNull();
      expect(kvValueRaw!).not.toContain(SECRET_NAME);
      expect(kvValueRaw!).not.toContain(SECRET_NOTE);
      expect(kvValueRaw!).not.toContain(SECRET_GENERAL);
      expect(kvValueRaw!).not.toContain("plan.jsx");

      // ----- 9. Daemon polls /feedback and decrypts ------------------------
      const pollRes = await workerHandler.fetch(
        new Request(`https://example.com/shares/${created.shareId}/feedback`),
        env,
      );
      expect(pollRes.status).toBe(200);
      const polled = await pollRes.json() as { entries: any[] };
      expect(polled.entries.length).toBe(1);
      const wireEntry = polled.entries[0];
      expect(wireEntry.encryption).toEqual({ alg: "AES-GCM", v: 1 });

      // Daemon-side key (same encodedKey, freshly imported as the poller does)
      const daemonKey = await importShareKey(encodedKey);
      const decryptedName = await decryptString(daemonKey, wireEntry.author.name);
      const decryptedSnippet = await decryptString(daemonKey, wireEntry.annotations[0].snippet);
      const decryptedNote = await decryptString(daemonKey, wireEntry.annotations[0].note);
      const decryptedCanvasFile = await decryptString(daemonKey, wireEntry.annotations[0].canvasFile);
      const decryptedGeneral = await decryptString(daemonKey, wireEntry.generalNote);

      expect(decryptedName).toBe(SECRET_NAME);
      expect(decryptedSnippet).toBe("[Section] Top secret");
      expect(decryptedNote).toBe(SECRET_NOTE);
      expect(decryptedCanvasFile).toBe("plan.jsx");
      expect(decryptedGeneral).toBe(SECRET_GENERAL);

      // ----- 10. Legacy unencrypted share still works ----------------------
      const legacyEnv = makeEnv();
      const legacyCreate = await workerHandler.fetch(
        new Request("https://example.com/shares", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(plaintext),
        }),
        legacyEnv,
      );
      expect(legacyCreate.status).toBe(200);
      const legacy = await legacyCreate.json() as { shareId: string };

      const legacyMeta = await (await workerHandler.fetch(
        new Request(`https://example.com/s/${legacy.shareId}/meta`),
        legacyEnv,
      )).json() as any;
      expect(legacyMeta.encryption).toBeUndefined();
      expect(legacyMeta.origin.sessionId).toBe(sid);
      expect(legacyMeta.origin.label).toBe(SECRET_LABEL);

      const legacyCanvas = await (await workerHandler.fetch(
        new Request(`https://example.com/s/${legacy.shareId}/canvas/plan.js`),
        legacyEnv,
      )).text();
      expect(legacyCanvas).toBe(SECRET_COMPILED);

      sm.remove(sid);
    } finally {
      try { rmSync(testDir, { recursive: true, force: true }); } catch {}
    }
  });
});
