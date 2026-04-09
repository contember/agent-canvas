/**
 * Worker unit tests. Validates pure functions (validation, util) without
 * spinning up Miniflare. End-to-end tests against a real Worker run via
 * `wrangler dev` are documented in README.md.
 *
 * Run with `bun test` from workers/canvas-share/.
 */

import { describe, expect, test } from "bun:test";
import { validateSharePayload, validateFeedbackBody, validateShareId } from "./validation";
import { LIMITS } from "./types";
import { randomHexId, sha256Hex, timingSafeEqual } from "./util";

describe("validateSharePayload", () => {
  const valid = {
    version: 1,
    origin: { sessionId: "s1", revision: 1, createdAt: "2026-04-09T00:00:00.000Z" },
    canvasFiles: [{ filename: "plan.jsx", compiledJs: "export default ()=>null" }],
    runtime: { componentsVersion: "0.1.0" },
  };

  test("accepts a minimal valid payload", () => {
    expect(typeof validateSharePayload(valid)).toBe("object");
  });

  test("rejects wrong version", () => {
    expect(typeof validateSharePayload({ ...valid, version: 2 })).toBe("string");
  });

  test("rejects missing canvasFiles", () => {
    expect(typeof validateSharePayload({ ...valid, canvasFiles: [] })).toBe("string");
  });

  test("rejects path traversal in filename", () => {
    expect(typeof validateSharePayload({
      ...valid,
      canvasFiles: [{ filename: "../etc/passwd.jsx", compiledJs: "x" }],
    })).toBe("string");
  });

  test("rejects non-jsx filenames", () => {
    expect(typeof validateSharePayload({
      ...valid,
      canvasFiles: [{ filename: "plan.js", compiledJs: "x" }],
    })).toBe("string");
  });

  test("rejects empty compiledJs", () => {
    expect(typeof validateSharePayload({
      ...valid,
      canvasFiles: [{ filename: "plan.jsx", compiledJs: "" }],
    })).toBe("string");
  });

  test("rejects too many canvas files", () => {
    expect(typeof validateSharePayload({
      ...valid,
      canvasFiles: Array.from({ length: 51 }, (_, i) => ({ filename: `f${i}.jsx`, compiledJs: "x" })),
    })).toBe("string");
  });

  test("rejects missing runtime version", () => {
    expect(typeof validateSharePayload({ ...valid, runtime: {} })).toBe("string");
  });
});

describe("validateFeedbackBody", () => {
  const valid = {
    author: { name: "Alice" },
    revision: 1,
    annotations: [{ id: "a1", snippet: "x", note: "y", createdAt: "2026-04-09T00:00:00.000Z" }],
  };

  test("accepts a minimal valid body", () => {
    expect(typeof validateFeedbackBody(valid)).toBe("object");
  });

  test("rejects missing author name", () => {
    expect(typeof validateFeedbackBody({ ...valid, author: {} })).toBe("string");
  });

  test("rejects empty author name", () => {
    expect(typeof validateFeedbackBody({ ...valid, author: { name: "  " } })).toBe("string");
  });

  test("rejects too-long author name", () => {
    expect(typeof validateFeedbackBody({
      ...valid,
      author: { name: "x".repeat(LIMITS.AUTHOR_NAME_LENGTH + 1) },
    })).toBe("string");
  });

  test("rejects non-integer revision", () => {
    expect(typeof validateFeedbackBody({ ...valid, revision: 1.5 })).toBe("string");
  });

  test("rejects too-long generalNote", () => {
    expect(typeof validateFeedbackBody({
      ...valid,
      generalNote: "x".repeat(LIMITS.GENERAL_NOTE_LENGTH + 1),
    })).toBe("string");
  });

  test("rejects too-many annotations", () => {
    expect(typeof validateFeedbackBody({
      ...valid,
      annotations: Array.from({ length: LIMITS.MAX_ANNOTATIONS_PER_FEEDBACK + 1 }, (_, i) => ({
        id: `a${i}`, snippet: "x", note: "y", createdAt: "2026-04-09T00:00:00.000Z",
      })),
    })).toBe("string");
  });

  test("rejects malformed annotation", () => {
    expect(typeof validateFeedbackBody({
      ...valid,
      annotations: [{ id: "a1", snippet: 123, note: "y", createdAt: "2026-04-09T00:00:00.000Z" }],
    })).toBe("string");
  });
});

describe("validateShareId", () => {
  test("accepts hex tokens", () => {
    expect(validateShareId("abc123def456")).toBe(true);
  });

  test("rejects path traversal", () => {
    expect(validateShareId("../etc")).toBe(false);
  });

  test("rejects too short", () => {
    expect(validateShareId("abc")).toBe(false);
  });

  test("rejects uppercase", () => {
    expect(validateShareId("ABC123DEF456")).toBe(false);
  });

  test("rejects non-hex chars", () => {
    expect(validateShareId("abcg12def456")).toBe(false);
  });
});

describe("util", () => {
  test("randomHexId returns hex of expected length", () => {
    const id = randomHexId(12);
    expect(id).toMatch(/^[a-f0-9]{24}$/);
  });

  test("randomHexId is unique-ish", () => {
    const a = randomHexId(12);
    const b = randomHexId(12);
    expect(a).not.toBe(b);
  });

  test("sha256Hex matches known value", async () => {
    const h = await sha256Hex("hello");
    expect(h).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });

  test("timingSafeEqual works", () => {
    expect(timingSafeEqual("hello", "hello")).toBe(true);
    expect(timingSafeEqual("hello", "world")).toBe(false);
    expect(timingSafeEqual("hello", "hi")).toBe(false);
  });
});
