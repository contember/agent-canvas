import { watch, existsSync, readFileSync } from "fs";
import { compilePlan } from "./compiler";
import type { SessionManager } from "./session";

type BroadcastFn = (sessionId: string) => void;

const watchers = new Map<string, ReturnType<typeof watch>>();

export function watchSession(
  sessionId: string,
  sessionManager: SessionManager,
  broadcast: BroadcastFn,
) {
  // Close existing watcher for this session (revision may have changed)
  unwatchSession(sessionId);

  const session = sessionManager.get(sessionId);
  if (!session) return;

  const planPath = sessionManager.getRevisionJsxPath(sessionId, session.currentRevision);
  if (!existsSync(planPath)) return;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const rev = session.currentRevision;

  const watcher = watch(planPath, async (event) => {
    if (event !== "change") return;

    // Debounce — Claude Code may do multiple rapid edits
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      try {
        const jsx = readFileSync(planPath, "utf-8");
        const result = await compilePlan(jsx);
        if (result.ok) {
          sessionManager.saveCompiled(sessionId, result.js, rev);
          broadcast(sessionId);
        }
      } catch {}
    }, 200);
  });

  watchers.set(sessionId, watcher);
}

export function unwatchSession(sessionId: string) {
  const watcher = watchers.get(sessionId);
  if (watcher) {
    watcher.close();
    watchers.delete(sessionId);
  }
}

export function unwatchAll() {
  for (const [id, watcher] of watchers) {
    watcher.close();
  }
  watchers.clear();
}
