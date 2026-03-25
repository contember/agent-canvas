import { readFileSync, readdirSync, existsSync } from "fs";
import type { SessionManager } from "../session";
import { compilePlan } from "../compiler";
import { watchSession } from "../watcher";
import { jsonResponse } from "./utils";
import type { Route } from "../router";

export interface ApiContext {
  sessionManager: SessionManager;
  broadcastPlanUpdate: (id: string) => void;
  broadcastRevisionUpdate: (id: string) => void;
  port: number;
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
      const session = sessionManager.upsert(sessionId, canvasFiles, projectRoot, body.label, body.response);

      // Compile all canvas files in parallel
      const errors: Record<string, string> = {};
      let anyOk = false;
      await Promise.all(
        [...canvasFiles.entries()].map(async ([filename, jsx]) => {
          const result = await compilePlan(jsx, session.projectRoot);
          if (result.ok) {
            sessionManager.saveCompiled(sessionId, filename, result.js, session.currentRevision);
            anyOk = true;
          } else {
            errors[filename] = result.error;
          }
        }),
      );

      if (anyOk) {
        broadcastPlanUpdate(sessionId);
      }

      watchSession(sessionId, sessionManager, broadcastPlanUpdate);

      const browserUrl = `http://localhost:${port}/s/${sessionId}`;
      return jsonResponse({
        ok: anyOk,
        browserUrl,
        isNew,
        revision: session.currentRevision,
        sessionId,
        canvasFiles: [...canvasFiles.keys()],
        ...(Object.keys(errors).length > 0 ? { errors } : {}),
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
          const result = await compilePlan(jsx, session.projectRoot);
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
    return jsonResponse({ ok: true, sessions });
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
    });
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

  return [
    { method: "GET", pattern: new URLPattern({ pathname: "/health" }), handler: handleHealth },
    { method: "POST", pattern: new URLPattern({ pathname: "/api/session/:id/plan" }), handler: handlePlanPost },
    { method: "GET", pattern: new URLPattern({ pathname: "/api/session/:id/canvas/:filename" }), handler: handleCanvasJs },
    { method: "GET", pattern: new URLPattern({ pathname: "/api/session/:id/meta" }), handler: handleMeta },
    { method: "GET", pattern: new URLPattern({ pathname: "/api/session/:id/revision/:rev/feedback" }), handler: handleFeedbackGet },
    { method: "POST", pattern: new URLPattern({ pathname: "/api/session/:id/feedback/consume" }), handler: handleFeedbackConsume },
    { method: "GET", pattern: new URLPattern({ pathname: "/api/sessions" }), handler: handleSessions },
  ];
}
