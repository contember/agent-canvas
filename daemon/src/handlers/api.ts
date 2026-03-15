import { readFileSync } from "fs";
import type { SessionManager } from "../session";
import { compilePlan } from "../compiler";
import { watchSession } from "../watcher";
import { jsonResponse } from "./utils";
import type { Route } from "../router";

export interface ApiContext {
  sessionManager: SessionManager;
  broadcastPlanUpdate: (id: string) => void;
  port: number;
}

function readRevisionJsx(sessionManager: SessionManager, sessionId: string, rev: number): string | null {
  try {
    const path = sessionManager.getRevisionJsxPath(sessionId, rev);
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

export function createApiHandlers(ctx: ApiContext): Route[] {
  const { sessionManager, broadcastPlanUpdate, port } = ctx;

  async function handlePlanPost(req: Request, _url: URL, match: URLPatternResult): Promise<Response> {
    const sessionId = match.pathname.groups.id!;
    try {
      const body = await req.json();
      const { jsx, projectRoot, label, sourceFile } = body;
      if (!jsx) return jsonResponse({ error: "Missing jsx" }, 400);

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

      const isNew = !sessionManager.get(sessionId);
      const session = sessionManager.upsert(sessionId, jsx, projectRoot || process.cwd(), label, sourceFile);

      const result = await compilePlan(jsx, session.projectRoot);
      if (result.ok) {
        sessionManager.saveCompiled(sessionId, result.js, session.currentRevision);
        broadcastPlanUpdate(sessionId);
      }

      watchSession(sessionId, sessionManager, broadcastPlanUpdate);

      const browserUrl = `http://localhost:${port}/s/${sessionId}`;
      return jsonResponse({
        ok: result.ok,
        browserUrl,
        isNew,
        revision: session.currentRevision,
        error: result.ok ? undefined : result.error,
      });
    } catch (e: any) {
      return jsonResponse({ error: e.message }, 500);
    }
  }

  async function handlePlanJs(_req: Request, url: URL, match: URLPatternResult): Promise<Response> {
    const sessionId = match.pathname.groups.id!;
    const revParam = url.searchParams.get("rev");
    const rev = revParam ? parseInt(revParam, 10) : undefined;

    let compiled = sessionManager.getCompiled(sessionId, rev);

    if (!compiled && rev) {
      const session = sessionManager.get(sessionId);
      if (session) {
        const jsx = readRevisionJsx(sessionManager, sessionId, rev);
        if (jsx) {
          const result = await compilePlan(jsx, session.projectRoot);
          if (result.ok) {
            sessionManager.saveCompiled(sessionId, result.js, rev);
            compiled = result.js;
          }
        }
      }
    }

    if (!compiled) return jsonResponse({ error: "No compiled plan" }, 404);
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
    return jsonResponse({ found: true, revision: result.revision, feedback: result.feedback });
  }

  return [
    { method: "GET", pattern: new URLPattern({ pathname: "/health" }), handler: handleHealth },
    { method: "POST", pattern: new URLPattern({ pathname: "/api/session/:id/plan" }), handler: handlePlanPost },
    { method: "GET", pattern: new URLPattern({ pathname: "/api/session/:id/plan.js" }), handler: handlePlanJs },
    { method: "GET", pattern: new URLPattern({ pathname: "/api/session/:id/meta" }), handler: handleMeta },
    { method: "GET", pattern: new URLPattern({ pathname: "/api/session/:id/revision/:rev/feedback" }), handler: handleFeedbackGet },
    { method: "POST", pattern: new URLPattern({ pathname: "/api/session/:id/feedback/consume" }), handler: handleFeedbackConsume },
    { method: "GET", pattern: new URLPattern({ pathname: "/api/sessions" }), handler: handleSessions },
  ];
}
