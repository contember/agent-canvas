// @fabrika/canvas-kernel/daemon — the host-agnostic daemon runtime.
//
// Ring 1: everything a local daemon needs that knows nothing about canvases —
// the WebSocket notification channel, the CLI waiter, process lifecycle, route
// dispatch, and the on-disk layout. A host whose domain is not canvases (Figma
// screens, say) takes this entry and none of the canvas engine behind `/server`.

// --- WebSocket notification channel ----------------------------------------
export { createNotificationChannel, browserFrame } from "./src/engine/channel";
export type {
  ChannelRole,
  ChannelSocket,
  TopicChannel,
  RelayOptions,
  BrowserFrameHandler,
  NotificationChannel,
  NotificationChannelOptions,
} from "./src/engine/channel";

// --- CLI waiter ------------------------------------------------------------
export { waitForEvent, WaitError } from "./src/engine/waiter";
export type { WaiterSocket, WaitVerdict, WaitOptions, WaitMessages, WaitFailure } from "./src/engine/waiter";

// --- Daemon process lifecycle ----------------------------------------------
export { createDaemonLifecycle, DaemonStartError } from "./src/engine/lifecycle";
export type {
  DaemonLifecycle,
  DaemonLifecycleConfig,
  DaemonHealth,
  DaemonHealthUp,
  DaemonHealthDown,
  DaemonPid,
  DaemonStopResult,
  DaemonStopReason,
  DaemonEvent,
  DaemonTimeouts,
} from "./src/engine/lifecycle";

// --- Router / HTTP ---------------------------------------------------------
export { dispatch } from "./src/engine/router";
export type { Route, RouteHandler } from "./src/engine/router";
export { jsonResponse, corsHeaders } from "./src/engine/http-utils";

// --- On-disk layout --------------------------------------------------------
export { createCanvasPaths } from "./src/engine/paths";
export type { CanvasPaths, CanvasPathsConfig } from "./src/engine/paths";
