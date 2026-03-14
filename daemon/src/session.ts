import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface SessionData {
  id: string;
  projectRoot: string;
  jsx: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface SessionMeta {
  projectRoot: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

const SESSIONS_DIR = join(homedir(), ".planner", "sessions");
const STALE_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours

export class SessionManager {
  private sessions = new Map<string, SessionData>();

  constructor() {
    mkdirSync(SESSIONS_DIR, { recursive: true });
    this.loadFromDisk();
  }

  private sessionDir(id: string): string {
    return join(SESSIONS_DIR, id);
  }

  private loadFromDisk() {
    if (!existsSync(SESSIONS_DIR)) return;
    for (const name of readdirSync(SESSIONS_DIR, { withFileTypes: true })) {
      if (!name.isDirectory()) continue;
      const dir = join(SESSIONS_DIR, name.name);
      const metaPath = join(dir, "meta.json");
      const jsxPath = join(dir, "plan.jsx");
      if (!existsSync(metaPath) || !existsSync(jsxPath)) continue;

      try {
        const meta: SessionMeta = JSON.parse(readFileSync(metaPath, "utf-8"));
        const jsx = readFileSync(jsxPath, "utf-8");
        this.sessions.set(name.name, {
          id: name.name,
          projectRoot: meta.projectRoot,
          jsx,
          version: meta.version,
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt,
        });
      } catch {}
    }
  }

  upsert(id: string, jsx: string, projectRoot: string): SessionData {
    const existing = this.sessions.get(id);
    const now = new Date().toISOString();
    const version = existing ? existing.version + 1 : 1;

    const session: SessionData = {
      id,
      projectRoot,
      jsx,
      version,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.sessions.set(id, session);
    this.persistToDisk(session, existing?.version);
    return session;
  }

  private persistToDisk(session: SessionData, previousVersion?: number) {
    const dir = this.sessionDir(session.id);
    const historyDir = join(dir, "history");
    mkdirSync(historyDir, { recursive: true });

    // Save history of previous version
    if (previousVersion) {
      const histNum = String(previousVersion).padStart(3, "0");
      const prevJsxPath = join(dir, "plan.jsx");
      if (existsSync(prevJsxPath)) {
        const prevJsx = readFileSync(prevJsxPath, "utf-8");
        writeFileSync(join(historyDir, `${histNum}.jsx`), prevJsx);
      }
    }

    // Write current
    writeFileSync(join(dir, "plan.jsx"), session.jsx);
    writeFileSync(
      join(dir, "meta.json"),
      JSON.stringify(
        {
          projectRoot: session.projectRoot,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          version: session.version,
        },
        null,
        2
      )
    );
  }

  get(id: string): SessionData | undefined {
    return this.sessions.get(id);
  }

  list(): SessionData[] {
    return Array.from(this.sessions.values());
  }

  remove(id: string) {
    this.sessions.delete(id);
    const dir = this.sessionDir(id);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  saveCompiled(id: string, js: string) {
    const dir = this.sessionDir(id);
    if (existsSync(dir)) {
      writeFileSync(join(dir, "plan.compiled.js"), js);
    }
  }

  getCompiled(id: string): string | null {
    const path = join(this.sessionDir(id), "plan.compiled.js");
    if (!existsSync(path)) return null;
    return readFileSync(path, "utf-8");
  }

  cleanupStale(maxAge = STALE_TIMEOUT_MS) {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - new Date(session.updatedAt).getTime() > maxAge) {
        this.remove(id);
      }
    }
  }
}
