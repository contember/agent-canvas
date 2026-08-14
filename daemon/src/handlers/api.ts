import { readFileSync, readdirSync, existsSync } from "fs";
import {
  compileJsx,
  jsonResponse,
  watchSession,
  type Route,
  type SessionManager,
} from "@fabrika/canvas-kernel/server";
import { loadShareConfig, shareRevision, revokeShare } from "../share";
import { COMPILE_TEMP_DIR } from "../paths";
import { HOST_COMPONENTS } from "../components";

const SECRET_FIELD_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_SECRET_BYTES = 64 * 1024;
const MAX_RESOLVED_SECRETS = 32;

function secretJsonResponse(data: unknown, status = 200): Response {
  const response = jsonResponse(data, status);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidSecretField(fieldId: string): boolean {
  return SECRET_FIELD_RE.test(fieldId);
}

export interface ApiContext {
  sessionManager: SessionManager;
  broadcastPlanUpdate: (id: string) => void;
  broadcastRevisionUpdate: (id: string) => void;
  port: number;
  version: string;
  cliAuthToken: string;
}

export function createApiHandlers(ctx: ApiContext): Route[] {
  const { sessionManager, broadcastPlanUpdate, broadcastRevisionUpdate, port } = ctx;

  /**
   * Read *.jsx canvas files from a directory.
   * Returns a Map of filename -> JSX content.
   */
  function resolveCanvasFiles(directory: string): Map<string, string> | null {
    if (!existsSync(directory)) return null;
    const files = readdirSync(directory).filter(f => f.endsWith(".jsx")).sort();
    if (files.length === 0) return null;
    const map = new Map<string, string>();
    for (const f of files) {
      map.set(f, readFileSync(`${directory}/${f}`, "utf-8"));
    }
    return map;
  }

  async function handlePlanPost(req: Request, _url: URL, match: URLPatternResult): Promise<Response> {
    const sessionId = match.pathname.groups.id!;
    try {
      const body = await req.json();

      if (!body.directory) {
        return jsonResponse({ error: "Missing directory" }, 400);
      }
      const canvasFiles = resolveCanvasFiles(body.directory);
      if (!canvasFiles) {
        return jsonResponse({ error: "No .jsx files found in directory" }, 400);
      }

      const unconsumed = sessionManager.getLatestUnconsumedFeedback(sessionId);
      if (unconsumed) {
        sessionManager.consumeFeedback(sessionId, unconsumed.revision);
        return jsonResponse({
          ok: false,
          error: `Unconsumed feedback from revision ${unconsumed.revision}. Address the feedback before pushing a new canvas.`,
          unconsumedFeedback: unconsumed.feedback,
          unconsumedRevision: unconsumed.revision,
        }, 409);
      }

      const projectRoot = body.projectRoot || process.cwd();
      const isNew = !sessionManager.get(sessionId);

      // Compile all canvas files — fail if any file fails
      const compiled = new Map<string, string>();
      const errors: Record<string, string> = {};
      await Promise.all(
        [...canvasFiles.entries()].map(async ([filename, jsx]) => {
          const result = await compileJsx(jsx, { projectRoot, tempDir: COMPILE_TEMP_DIR, components: HOST_COMPONENTS });
          if (result.ok) {
            compiled.set(filename, result.js);
          } else {
            errors[filename] = result.error;
          }
        }),
      );

      if (Object.keys(errors).length > 0) {
        return jsonResponse({
          ok: false,
          error: "Canvas compilation failed",
          errors,
        }, 400);
      }

      const session = sessionManager.upsert(sessionId, canvasFiles, projectRoot, body.label, body.response);
      for (const [filename, js] of compiled) {
        sessionManager.saveCompiled(sessionId, filename, js, session.currentRevision);
      }

      broadcastPlanUpdate(sessionId);
      watchSession(sessionId, sessionManager, broadcastPlanUpdate, { tempDir: COMPILE_TEMP_DIR, components: HOST_COMPONENTS });

      const browserUrl = `http://localhost:${port}/s/${sessionId}`;
      return jsonResponse({
        ok: true,
        browserUrl,
        isNew,
        revision: session.currentRevision,
        sessionId,
        canvasFiles: [...canvasFiles.keys()],
      });
    } catch (e: any) {
      return jsonResponse({ error: e.message }, 500);
    }
  }

  async function handleCanvasJs(_req: Request, url: URL, match: URLPatternResult): Promise<Response> {
    const sessionId = match.pathname.groups.id!;
    const jsFilename = match.pathname.groups.filename!;
    const jsxFilename = jsFilename.replace(/\.js$/, ".jsx");
    const revParam = url.searchParams.get("rev");
    const rev = revParam ? parseInt(revParam, 10) : undefined;

    let compiled = sessionManager.getCompiled(sessionId, jsxFilename, rev);

    if (!compiled && rev) {
      const session = sessionManager.get(sessionId);
      if (session) {
        const jsx = sessionManager.readRevisionJsx(sessionId, rev, jsxFilename);
        if (jsx) {
          const result = await compileJsx(jsx, { projectRoot: session.projectRoot, tempDir: COMPILE_TEMP_DIR, components: HOST_COMPONENTS });
          if (result.ok) {
            sessionManager.saveCompiled(sessionId, jsxFilename, result.js, rev);
            compiled = result.js;
          } else {
            console.warn(`[canvas.js] compilation failed for ${sessionId}/${jsxFilename} rev ${rev}: ${result.error}`);
          }
        } else {
          console.warn(`[canvas.js] no JSX found for ${sessionId}/${jsxFilename} rev ${rev}`);
        }
      }
    }

    if (!compiled) return jsonResponse({ error: "No compiled canvas" }, 404);
    return new Response(compiled, {
      headers: {
        "Content-Type": "application/javascript",
        "Cache-Control": "no-cache",
      },
    });
  }

  function handleHealth(): Response {
    const sessions = sessionManager.list().map((s) => s.id);
    return jsonResponse({ ok: true, sessions, version: ctx.version });
  }

  function handleMeta(_req: Request, _url: URL, match: URLPatternResult): Response {
    const sessionId = match.pathname.groups.id!;
    const session = sessionManager.get(sessionId);
    if (!session) return jsonResponse({ error: "Session not found" }, 404);
    return jsonResponse({
      projectRoot: session.projectRoot,
      currentRevision: session.currentRevision,
      revisions: session.revisions,
      canvasFiles: session.canvasFiles,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      shares: session.shares ?? [],
      shareEnabled: !!loadShareConfig(ctx.version),
    });
  }

  async function handleShareRevision(_req: Request, _url: URL, match: URLPatternResult): Promise<Response> {
    const sessionId = match.pathname.groups.id!;
    const rev = parseInt(match.pathname.groups.rev!, 10);

    const session = sessionManager.get(sessionId);
    if (!session) return jsonResponse({ error: "Session not found" }, 404);
    if (!session.revisions.find((r) => r.revision === rev)) {
      return jsonResponse({ error: `Revision ${rev} not found` }, 404);
    }

    const config = loadShareConfig(ctx.version);
    if (!config) {
      return jsonResponse({
        error: "Sharing disabled. Set CANVAS_SHARE_ENDPOINT to the deployed canvas-share worker URL.",
      }, 501);
    }

    try {
      const entry = await shareRevision(sessionManager, sessionId, rev, config);
      broadcastRevisionUpdate(sessionId);
      return jsonResponse({ ok: true, share: entry });
    } catch (e: any) {
      return jsonResponse({ error: e.message || String(e) }, 502);
    }
  }

  async function handleShareRevoke(_req: Request, _url: URL, match: URLPatternResult): Promise<Response> {
    const sessionId = match.pathname.groups.id!;
    const shareId = match.pathname.groups.shareId!;
    if (!sessionManager.get(sessionId)) return jsonResponse({ error: "Session not found" }, 404);
    const config = loadShareConfig(ctx.version);
    if (!config) return jsonResponse({ error: "Sharing disabled" }, 501);
    try {
      await revokeShare(sessionManager, sessionId, shareId, config);
      broadcastRevisionUpdate(sessionId);
      return jsonResponse({ ok: true });
    } catch (e: any) {
      return jsonResponse({ error: e.message || String(e) }, 502);
    }
  }

  function handleSharesList(_req: Request, _url: URL, match: URLPatternResult): Response {
    const sessionId = match.pathname.groups.id!;
    const session = sessionManager.get(sessionId);
    if (!session) return jsonResponse({ error: "Session not found" }, 404);
    return jsonResponse({ shares: session.shares ?? [] });
  }

  function handleRemoteFeedbackGet(_req: Request, _url: URL, match: URLPatternResult): Response {
    const sessionId = match.pathname.groups.id!;
    const rev = parseInt(match.pathname.groups.rev!, 10);
    if (!sessionManager.get(sessionId)) return jsonResponse({ error: "Session not found" }, 404);
    const entries = sessionManager.getRemoteFeedback(sessionId, rev);
    return jsonResponse({ entries });
  }

  function handleSessions(): Response {
    return jsonResponse(sessionManager.list().map((s) => ({
      id: s.id,
      projectRoot: s.projectRoot,
      currentRevision: s.currentRevision,
      updatedAt: s.updatedAt,
    })));
  }

  function handleFeedbackGet(_req: Request, _url: URL, match: URLPatternResult): Response {
    const sessionId = match.pathname.groups.id!;
    const rev = parseInt(match.pathname.groups.rev!, 10);
    const feedback = sessionManager.getFeedback(sessionId, rev);
    if (feedback === null) return jsonResponse({ error: "No feedback" }, 404);
    return jsonResponse({ feedback });
  }

  function handleFeedbackConsume(_req: Request, _url: URL, match: URLPatternResult): Response {
    const sessionId = match.pathname.groups.id!;
    const result = sessionManager.getLatestUnconsumedFeedback(sessionId);
    if (!result) return jsonResponse({ found: false });
    sessionManager.consumeFeedback(sessionId, result.revision);
    broadcastRevisionUpdate(sessionId);
    return jsonResponse({ found: true, revision: result.revision, feedback: result.feedback });
  }

  async function handleSecretStore(req: Request, _url: URL, match: URLPatternResult): Promise<Response> {
    const sessionId = match.pathname.groups.id!;
    const fieldId = match.pathname.groups.field!;
    if (!sessionManager.get(sessionId)) return secretJsonResponse({ error: "Session not found" }, 404);
    if (!isValidSecretField(fieldId)) return secretJsonResponse({ error: "Invalid secret field ID" }, 400);

    const raw: unknown = await req.json();
    if (!isRecord(raw) || typeof raw.value !== "string" || raw.value.length === 0) {
      return secretJsonResponse({ error: "Secret value must be a non-empty string" }, 400);
    }
    if (new TextEncoder().encode(raw.value).byteLength > MAX_SECRET_BYTES) {
      return secretJsonResponse({ error: `Secret exceeds ${MAX_SECRET_BYTES} bytes` }, 413);
    }

    sessionManager.setSecret(sessionId, fieldId, raw.value);
    return secretJsonResponse({ ok: true, ready: true });
  }

  function handleSecretStatus(_req: Request, _url: URL, match: URLPatternResult): Response {
    const sessionId = match.pathname.groups.id!;
    const fieldId = match.pathname.groups.field!;
    if (!sessionManager.get(sessionId)) return secretJsonResponse({ error: "Session not found" }, 404);
    if (!isValidSecretField(fieldId)) return secretJsonResponse({ error: "Invalid secret field ID" }, 400);
    return secretJsonResponse({ ready: sessionManager.hasSecret(sessionId, fieldId) });
  }

  function handleSecretClear(_req: Request, _url: URL, match: URLPatternResult): Response {
    const sessionId = match.pathname.groups.id!;
    const fieldId = match.pathname.groups.field!;
    if (!sessionManager.get(sessionId)) return secretJsonResponse({ error: "Session not found" }, 404);
    if (!isValidSecretField(fieldId)) return secretJsonResponse({ error: "Invalid secret field ID" }, 400);
    sessionManager.clearSecret(sessionId, fieldId);
    return secretJsonResponse({ ok: true, ready: false });
  }

  async function handleSecretResolve(req: Request, _url: URL, match: URLPatternResult): Promise<Response> {
    if (req.headers.get("X-Agent-Canvas-CLI-Token") !== ctx.cliAuthToken) {
      return secretJsonResponse({ error: "Secret resolution is available only to the local CLI" }, 403);
    }
    const sessionId = match.pathname.groups.id!;
    if (!sessionManager.get(sessionId)) return secretJsonResponse({ error: "Session not found" }, 404);

    const raw: unknown = await req.json();
    const fields = isRecord(raw) && Array.isArray(raw.fields) ? raw.fields : null;
    if (!fields || fields.length === 0 || fields.length > MAX_RESOLVED_SECRETS || !fields.every((field) => typeof field === "string" && isValidSecretField(field))) {
      return secretJsonResponse({ error: `fields must contain 1-${MAX_RESOLVED_SECRETS} valid secret field IDs` }, 400);
    }

    const uniqueFields = [...new Set(fields)];
    const result = sessionManager.resolveSecrets(sessionId, uniqueFields);
    if (!result) return secretJsonResponse({ error: "Session not found" }, 404);
    if (!result.ok) return secretJsonResponse({ error: "Required secrets are not ready", missing: result.missing }, 409);

    return secretJsonResponse({
      values: [...result.values].map(([id, value]) => ({ id, value })),
    });
  }

  return [
    { method: "GET", pattern: new URLPattern({ pathname: "/health" }), handler: handleHealth },
    { method: "POST", pattern: new URLPattern({ pathname: "/api/session/:id/plan" }), handler: handlePlanPost },
    { method: "GET", pattern: new URLPattern({ pathname: "/api/session/:id/canvas/:filename" }), handler: handleCanvasJs },
    { method: "GET", pattern: new URLPattern({ pathname: "/api/session/:id/meta" }), handler: handleMeta },
    { method: "GET", pattern: new URLPattern({ pathname: "/api/session/:id/revision/:rev/feedback" }), handler: handleFeedbackGet },
    { method: "POST", pattern: new URLPattern({ pathname: "/api/session/:id/feedback/consume" }), handler: handleFeedbackConsume },
    { method: "POST", pattern: new URLPattern({ pathname: "/api/session/:id/secrets/resolve" }), handler: handleSecretResolve },
    { method: "POST", pattern: new URLPattern({ pathname: "/api/session/:id/secrets/:field/value" }), handler: handleSecretStore },
    { method: "GET", pattern: new URLPattern({ pathname: "/api/session/:id/secrets/:field/status" }), handler: handleSecretStatus },
    { method: "DELETE", pattern: new URLPattern({ pathname: "/api/session/:id/secrets/:field/value" }), handler: handleSecretClear },
    { method: "POST", pattern: new URLPattern({ pathname: "/api/session/:id/revision/:rev/share" }), handler: handleShareRevision },
    { method: "POST", pattern: new URLPattern({ pathname: "/api/session/:id/shares/:shareId/revoke" }), handler: handleShareRevoke },
    { method: "GET", pattern: new URLPattern({ pathname: "/api/session/:id/shares" }), handler: handleSharesList },
    { method: "GET", pattern: new URLPattern({ pathname: "/api/session/:id/revision/:rev/remote-feedback" }), handler: handleRemoteFeedbackGet },
    { method: "GET", pattern: new URLPattern({ pathname: "/api/sessions" }), handler: handleSessions },
  ];
}
