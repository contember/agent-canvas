/**
 * Wire-format validators for incoming bodies. Backed by Zod so the schemas
 * double as TypeScript types and the error messages stay readable.
 *
 * Two helpers — `validateSharePayload` and `validateFeedbackBody` — wrap
 * the Zod schemas with a `unknown -> Result | string` shape so handlers
 * can early-return a `400` with the error string without needing
 * try/catch around every parse.
 */

import { z } from "zod";
import { LIMITS } from "./types";

// --- Encryption marker ------------------------------------------------------

/** Marker on a SharePayload / FeedbackPostBody that tells consumers the
 *  associated string fields contain ciphertext rather than plaintext. The
 *  worker itself never inspects encrypted contents — it just stores them
 *  as opaque strings. The marker exists so the *daemon* (when polling
 *  feedback) and the *browser* (when rendering a share) know whether to
 *  decrypt. */
const encryptionSchema = z.object({
  alg: z.literal("AES-GCM"),
  v: z.literal(1),
});

// --- Share creation payload -------------------------------------------------

const canvasFileSchema = z.object({
  filename: z
    .string()
    .endsWith(".jsx", { message: "must end in .jsx" })
    .refine((s) => !s.includes("/") && !s.includes(".."), {
      message: "must not contain path separators",
    }),
  compiledJs: z.string().min(1, "must be a non-empty string"),
  sourceJsx: z.string().optional(),
});

const sharePayloadSchema = z.object({
  version: z.literal(1),
  encryption: encryptionSchema.optional(),
  origin: z.object({
    sessionId: z.string(),
    revision: z.number().int(),
    label: z.string().optional(),
    createdAt: z.string(),
  }),
  canvasFiles: z
    .array(canvasFileSchema)
    .min(1, "must be a non-empty array")
    .max(50, "Too many canvas files (max 50)"),
  runtime: z.object({
    componentsVersion: z.string(),
  }),
});

export type SharePayloadParsed = z.infer<typeof sharePayloadSchema>;

// --- Feedback POST body -----------------------------------------------------

const annotationSchema = z.object({
  id: z.string(),
  snippet: z.string(),
  note: z.string(),
  createdAt: z.string(),
  filePath: z.string().optional(),
  canvasFile: z.string().optional(),
  context: z.unknown().optional(),
  attachments: z
    .array(
      z.object({
        url: z.string(),
        mime: z.string().optional(),
      }),
    )
    .optional(),
});

// In encrypted mode `name` / `generalNote` are ciphertext blobs (base64)
// and cannot be sensibly length-bound to plaintext limits. The base schema
// uses the looser ciphertext caps; a post-parse refine then re-applies the
// strict plaintext bounds when no `encryption` marker is present.
const feedbackBodySchema = z
  .object({
    author: z.object({
      id: z.string().optional(),
      name: z
        .string()
        .min(1, "author.name is required")
        .max(LIMITS.AUTHOR_NAME_CIPHERTEXT_LENGTH, "author.name too long"),
    }),
    revision: z.number().int(),
    annotations: z
      .array(annotationSchema)
      .max(LIMITS.MAX_ANNOTATIONS_PER_FEEDBACK, `Too many annotations (max ${LIMITS.MAX_ANNOTATIONS_PER_FEEDBACK})`)
      .optional(),
    generalNote: z
      .string()
      .max(LIMITS.GENERAL_NOTE_CIPHERTEXT_LENGTH, `generalNote too long`)
      .optional(),
    encryption: encryptionSchema.optional(),
  })
  .superRefine((body, ctx) => {
    if (body.encryption) return;
    if (body.author.name.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["author", "name"],
        message: "author.name is required",
      });
    }
    if (body.author.name.length > LIMITS.AUTHOR_NAME_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["author", "name"],
        message: `author.name must be ≤ ${LIMITS.AUTHOR_NAME_LENGTH} chars`,
      });
    }
    if (body.generalNote && body.generalNote.length > LIMITS.GENERAL_NOTE_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["generalNote"],
        message: `generalNote too long (max ${LIMITS.GENERAL_NOTE_LENGTH} chars)`,
      });
    }
  });

export type FeedbackBodyParsed = z.infer<typeof feedbackBodySchema>;

// --- Wrappers ---------------------------------------------------------------

/**
 * Format the first issue from a Zod error into a single-line message.
 * For our needs (one error at a time, returned as JSON.error) we don't
 * need to surface every issue.
 */
function firstError(err: z.ZodError): string {
  const issue = err.issues[0];
  if (!issue) return "Invalid input";
  const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
  return `${path}${issue.message}`;
}

export function validateSharePayload(raw: unknown): SharePayloadParsed | string {
  const result = sharePayloadSchema.safeParse(raw);
  if (!result.success) return firstError(result.error);
  return result.data;
}

export function validateFeedbackBody(raw: unknown): FeedbackBodyParsed | string {
  const result = feedbackBodySchema.safeParse(raw);
  if (!result.success) return firstError(result.error);
  return result.data;
}

/** Validate a shareId path segment — must look like a hex token. */
export function validateShareId(id: string): boolean {
  return /^[a-f0-9]{8,64}$/.test(id);
}
