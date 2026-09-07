/**
 * The canvas vocabulary on top of the generic channel: topic = session id,
 * `submit` persists feedback, and a waiter is the CLI blocking on one answer,
 * so a delivery closes it.
 */

import { browserFrame, createNotificationChannel, type ChannelSocket, type TopicChannel } from "@fabrika/daemon-kit";
import type { SessionManager, RemoteFeedbackEntry } from "./session";

export type WSData = { type: "browser" | "wait"; sessionId: string };

export interface CanvasSocket extends ChannelSocket {
  data: WSData;
}

interface CanvasRenderError {
  revision: number;
  filename: string;
  message: string;
  stack?: string;
  componentStack?: string;
}

interface SubmitFrame {
  type: "submit";
  feedback: string;
}

interface RenderErrorFrame {
  type: "render-error";
  error: CanvasRenderError;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCanvasRenderError(value: unknown): value is CanvasRenderError {
  return typeof value === "object" && value !== null
    && "revision" in value && Number.isInteger(value.revision)
    && "filename" in value && typeof value.filename === "string"
    && "message" in value && typeof value.message === "string"
    && (!("stack" in value) || value.stack === undefined || typeof value.stack === "string")
    && (!("componentStack" in value) || value.componentStack === undefined || typeof value.componentStack === "string");
}

function isSubmitFrame(value: unknown): value is SubmitFrame {
  return isRecord(value) && value.type === "submit" && typeof value.feedback === "string";
}

function isRenderErrorFrame(value: unknown): value is RenderErrorFrame {
  return isRecord(value) && value.type === "render-error" && isCanvasRenderError(value.error);
}

export interface WebSocketManagerOptions {
  /**
   * Who marks feedback consumed once a waiting client has been handed it.
   *
   * `"on-delivery"` (default) clears it in the same step, so the same feedback
   * can never be delivered twice — right when the waiting client *is* the
   * consumer. `"external"` leaves it pending for a separate gate to claim
   * through the consume endpoint, for hosts where delivery and consumption are
   * different steps.
   */
  feedbackConsumption?: "on-delivery" | "external";
}

export function createWebSocketManager(
  sessionManager: SessionManager,
  options: WebSocketManagerOptions = {},
) {
  const consumeOnDelivery = (options.feedbackConsumption ?? "on-delivery") === "on-delivery";
  const pendingRenderErrors = new Map<string, CanvasRenderError>();

  /** Hands a held error to the waiters, if any showed up; the caller announces the departure. */
  function deliverPendingRenderError(sessionId: string): boolean {
    const error = pendingRenderErrors.get(sessionId);
    if (!error) return false;
    if (!channel.relayToWaiters(sessionId, { type: "render-error", error })) return false;
    pendingRenderErrors.delete(sessionId);
    return true;
  }

  function submit(frame: SubmitFrame, topic: TopicChannel) {
    const sessionId = topic.topic;
    const session = sessionManager.get(sessionId);
    if (!session) return;

    sessionManager.saveFeedback(sessionId, session.currentRevision, frame.feedback);
    broadcastRevisionUpdate(sessionId);
    if (!topic.hasWaiter()) return;

    if (consumeOnDelivery) {
      sessionManager.consumeFeedback(sessionId, session.currentRevision);
      broadcastRevisionUpdate(sessionId);
    }
    topic.relayToWaiters({ type: "submit", feedback: frame.feedback });
  }

  function renderError(frame: RenderErrorFrame, topic: TopicChannel) {
    const sessionId = topic.topic;
    const session = sessionManager.get(sessionId);
    if (!session) return;
    if (frame.error.revision !== session.currentRevision) return;
    if (!session.canvasFiles.includes(frame.error.filename)) return;

    pendingRenderErrors.set(sessionId, frame.error);
    if (deliverPendingRenderError(sessionId)) topic.broadcastPresence();
  }

  const channel = createNotificationChannel<CanvasSocket>({
    roleOf: (socket) => socket.data.type,
    topicOf: (socket) => socket.data.sessionId,
    waiterPolicy: "close-on-delivery",
    presenceFrame: (watching) => ({ type: "watcher-status", watching }),
    // A render error raised before the CLI watcher connected is held for it.
    onWaiterOpen: (topic) => { deliverPendingRenderError(topic.topic); },
    frames: [
      browserFrame(isSubmitFrame, submit),
      browserFrame(isRenderErrorFrame, renderError),
    ],
  });

  function broadcastPlanUpdate(sessionId: string) {
    pendingRenderErrors.delete(sessionId);
    const session = sessionManager.get(sessionId);
    if (!session) return;
    channel.broadcast(sessionId, {
      type: "plan-updated",
      currentRevision: session.currentRevision,
      revisions: session.revisions,
    });
  }

  function broadcastRevisionUpdate(sessionId: string) {
    const session = sessionManager.get(sessionId);
    if (!session) return;
    channel.broadcast(sessionId, {
      type: "revision-updated",
      revisions: session.revisions,
    });
  }

  function broadcastRemoteFeedback(sessionId: string, revision: number, entries: RemoteFeedbackEntry[]) {
    channel.broadcast(sessionId, { type: "remote-feedback", revision, entries });
  }

  function broadcastWatcherStatus(sessionId: string) {
    channel.broadcastPresence(sessionId);
  }

  return {
    handlers: channel.handlers,
    broadcastPlanUpdate,
    broadcastRevisionUpdate,
    broadcastWatcherStatus,
    broadcastRemoteFeedback,
  };
}
