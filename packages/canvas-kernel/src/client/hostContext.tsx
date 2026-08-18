import { createContext, useContext } from "react";

/**
 * What the annotation surface needs from the host serving it.
 *
 * The kernel ships a local-daemon implementation, so a host that serves
 * canvases straight off its own daemon needs no provider. Hosts with extra
 * delivery modes (agent-canvas also serves read-only encrypted share links)
 * provide their own.
 */
export interface CanvasHost {
  /** Session the canvas belongs to. */
  sessionId: string;
  /** Read-only share view — local-only affordances stay hidden. */
  isShared: boolean;
  /** Host can read project files (feedback bodies, file browser). */
  fsAvailable: boolean;
  /** Endpoint accepting annotation image uploads, or `null` for a host that
   *  has none — the attach affordances then stay hidden rather than posting
   *  into the void. Required, not optional, so no host can be silent about it. */
  uploadUrl: (() => string) | null;
  /** Fetch and `import()` a compiled canvas module. */
  loadCanvasModule: (filename: string, revision?: number) => Promise<any>;
}

/** Local mode carries the session id as the `/s/:id` path suffix. */
function localSessionId(): string {
  if (typeof window === "undefined") return "";
  return window.location.pathname.replace("/s/", "");
}

export const localCanvasHost: CanvasHost = {
  get sessionId() {
    return localSessionId();
  },
  isShared: false,
  fsAvailable: true,
  // No endpoint by default. The only hosts that reach this fallback are the
  // ones that configured nothing, which are exactly the ones least likely to
  // serve an upload route — claiming one on their behalf is how every host got
  // a paperclip that posts into the void. A host with uploads names its own.
  uploadUrl: null,
  loadCanvasModule: (filename, revision) => {
    const jsName = filename.replace(/\.jsx$/, ".js");
    const query = revision ? `?rev=${revision}&t=${Date.now()}` : `?t=${Date.now()}`;
    const url = `/api/session/${localSessionId()}/canvas/${encodeURIComponent(jsName)}${query}`;
    return import(/* @vite-ignore */ url);
  },
};

export const CanvasHostContext = createContext<CanvasHost>(localCanvasHost);

export function useCanvasHost(): CanvasHost {
  return useContext(CanvasHostContext);
}
