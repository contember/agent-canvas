// @fabrika/canvas-kernel — server entry.
//
// The host-agnostic canvas engine: compile pipeline, session/revision store,
// JSX watcher, WebSocket feedback protocol, router, and the on-disk layout.
// Imports nothing from preact/DOM, so a Bun.serve daemon can pull it in without
// dragging the browser bundle along.
//
// The browser-facing surface (components + annotation runtime) is exposed
// separately through the package `imports`/`exports` maps as `#canvas/components`
// and `#canvas/runtime`.

// --- Compile pipeline (JSX -> Bun.build) -----------------------------------
export { compileJsx, compilePlan } from "./src/engine/compiler";
export type { CompileResult, CompileOptions } from "./src/engine/compiler";

// --- Session / revision / feedback store -----------------------------------
export { SessionManager } from "./src/engine/session";
export type {
  SessionData,
  RevisionInfo,
  CanvasFileInfo,
  CanvasScope,
  DiffStats,
  SecretResolution,
  RemoteFeedbackEntry,
  RemoteAnnotation,
  ShareEntry,
} from "./src/engine/session";

// --- WebSocket feedback protocol -------------------------------------------
export { createWebSocketManager } from "./src/engine/websocket";
export type { WSData, CanvasSocket, WebSocketManagerOptions } from "./src/engine/websocket";

// --- JSX watcher -----------------------------------------------------------
export { watchSession, unwatchSession, unwatchAll } from "./src/engine/watcher";
export type { WatchOptions } from "./src/engine/watcher";

// --- Router ----------------------------------------------------------------
export { dispatch } from "./src/engine/router";
export type { Route, RouteHandler } from "./src/engine/router";

// --- HTTP helpers ----------------------------------------------------------
export { jsonResponse, corsHeaders } from "./src/engine/http-utils";

// --- On-disk layout --------------------------------------------------------
export { createCanvasPaths } from "./src/engine/paths";
export type { CanvasPaths, CanvasPathsConfig } from "./src/engine/paths";
