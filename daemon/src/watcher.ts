import { watch, existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { compilePlan } from "./compiler";
import type { SessionManager } from "./session";

type BroadcastFn = (sessionId: string) => void;

const watchers = new Map<string, ReturnType<typeof watch>[]>();

export function watchSession(
  sessionId: string,
  sessionManager: SessionManager,
  broadcast: BroadcastFn,
) {
  // Close existing watchers for this session
  unwatchSession(sessionId);

  const session = sessionManager.get(sessionId);
  if (!session) return;

  const rev = session.currentRevision;
  const canvasFiles = sessionManager.getRevisionCanvasFiles(sessionId, rev);
  if (canvasFiles.length === 0) return;

  const fileWatchers: ReturnType<typeof watch>[] = [];
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  for (const filename of canvasFiles) {
    const filePath = sessionManager.getRevisionJsxPath(sessionId, rev, filename);
    if (!existsSync(filePath)) continue;

    const watcher = watch(filePath, async (event) => {
      if (event !== "change") return;

      // Debounce per-file
      const existing = debounceTimers.get(filename);
      if (existing) clearTimeout(existing);

      debounceTimers.set(filename, setTimeout(async () => {
        debounceTimers.delete(filename);
        try {
          const jsx = readFileSync(filePath, "utf-8");
          const result = await compilePlan(jsx, session.projectRoot);
          if (result.ok) {
            sessionManager.saveCompiled(sessionId, filename, result.js, rev);
            broadcast(sessionId);
          }
        } catch {}
      }, 200));
    });

    fileWatchers.push(watcher);
  }

  watchers.set(sessionId, fileWatchers);
}

export function unwatchSession(sessionId: string) {
  const sessionWatchers = watchers.get(sessionId);
  if (sessionWatchers) {
    for (const w of sessionWatchers) w.close();
    watchers.delete(sessionId);
  }
}

export function unwatchAll() {
  for (const [, sessionWatchers] of watchers) {
    for (const w of sessionWatchers) w.close();
  }
  watchers.clear();
}
