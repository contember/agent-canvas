import { watch, existsSync, readFileSync } from "fs";
import { join } from "path";
import { compilePlan } from "./compiler";
import { SESSIONS_DIR } from "./session";

type BroadcastFn = (sessionId: string) => void;
type SaveCompiledFn = (sessionId: string, js: string) => void;

const watchers = new Map<string, ReturnType<typeof watch>>();

export function watchSession(
  sessionId: string,
  broadcast: BroadcastFn,
  saveCompiled: SaveCompiledFn
) {
  // Don't watch twice
  if (watchers.has(sessionId)) return;

  const planPath = join(SESSIONS_DIR, sessionId, "plan.jsx");
  if (!existsSync(planPath)) return;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const watcher = watch(planPath, async (event) => {
    if (event !== "change") return;

    // Debounce — Claude Code may do multiple rapid edits
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      try {
        const jsx = readFileSync(planPath, "utf-8");
        const result = await compilePlan(jsx);
        if (result.ok) {
          saveCompiled(sessionId, result.js);
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
