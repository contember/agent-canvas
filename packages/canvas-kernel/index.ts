export { compileJsx, compilePlan, KERNEL_COMPONENTS } from "./src/engine/compiler";
export type { CompileResult, CompileOptions, CanvasComponents, CanvasComponentSpec } from "./src/engine/compiler";
export { SessionManager } from "./src/engine/session";
export type {
  SessionData, RevisionInfo, CanvasFileInfo, CanvasScope, DiffStats, SecretResolution,
  RemoteFeedbackEntry, RemoteAnnotation, ShareEntry,
} from "./src/engine/session";
export { createWebSocketManager } from "./src/engine/websocket";
export type { WSData, CanvasSocket, WebSocketManagerOptions } from "./src/engine/websocket";
export { watchSession, unwatchSession, unwatchAll } from "./src/engine/watcher";
export type { WatchOptions } from "./src/engine/watcher";
export { createCanvasPaths } from "./src/engine/paths";
export type { CanvasPaths, CanvasPathsConfig } from "./src/engine/paths";
