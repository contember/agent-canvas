import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, renameSync } from "fs";
import { join } from "path";
import { SESSIONS_DIR } from "./paths";

export interface RevisionInfo {
  revision: number;
  label?: string;
  sourceFile?: string;
  createdAt: string;
  hasFeedback: boolean;
  feedbackConsumed: boolean;
}

export interface SessionData {
  id: string;
  projectRoot: string;
  jsx: string;
  currentRevision: number;
  revisions: RevisionInfo[];
  createdAt: string;
  updatedAt: string;
}

interface SessionMeta {
  projectRoot: string;
  createdAt: string;
  updatedAt: string;
  currentRevision: number;
  revisions: RevisionInfo[];
}

// Legacy format
interface LegacyMeta {
  projectRoot: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

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

  private revisionDir(id: string, rev: number): string {
    return join(this.sessionDir(id), "revisions", String(rev));
  }

  private loadFromDisk() {
    if (!existsSync(SESSIONS_DIR)) return;
    for (const name of readdirSync(SESSIONS_DIR, { withFileTypes: true })) {
      if (!name.isDirectory()) continue;
      const dir = join(SESSIONS_DIR, name.name);
      const metaPath = join(dir, "meta.json");
      if (!existsSync(metaPath)) continue;

      try {
        const raw = JSON.parse(readFileSync(metaPath, "utf-8"));

        // Detect and migrate legacy format
        if ("version" in raw && !("currentRevision" in raw)) {
          this.migrateLegacy(name.name, raw as LegacyMeta);
          // Re-read after migration
          const migrated: SessionMeta = JSON.parse(readFileSync(metaPath, "utf-8"));
          const jsx = this.readRevisionJsx(name.name, migrated.currentRevision);
          if (!jsx) continue;
          this.sessions.set(name.name, {
            id: name.name,
            projectRoot: migrated.projectRoot,
            jsx,
            currentRevision: migrated.currentRevision,
            revisions: migrated.revisions,
            createdAt: migrated.createdAt,
            updatedAt: migrated.updatedAt,
          });
          continue;
        }

        const meta = raw as SessionMeta;
        const jsx = this.readRevisionJsx(name.name, meta.currentRevision);
        if (!jsx) continue;

        this.sessions.set(name.name, {
          id: name.name,
          projectRoot: meta.projectRoot,
          jsx,
          currentRevision: meta.currentRevision,
          revisions: meta.revisions,
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt,
        });
      } catch {}
    }
  }

  private migrateLegacy(id: string, legacy: LegacyMeta) {
    const dir = this.sessionDir(id);
    const flatJsx = join(dir, "plan.jsx");
    const flatCompiled = join(dir, "plan.compiled.js");
    const historyDir = join(dir, "history");

    // Collect all historical revisions + current
    const revisions: RevisionInfo[] = [];

    // Migrate history files
    if (existsSync(historyDir)) {
      const files = readdirSync(historyDir).filter((f) => f.endsWith(".jsx")).sort();
      for (const file of files) {
        const num = parseInt(file.replace(".jsx", ""), 10);
        if (isNaN(num)) continue;
        const revDir = this.revisionDir(id, num);
        mkdirSync(revDir, { recursive: true });
        renameSync(join(historyDir, file), join(revDir, "plan.jsx"));
        revisions.push({ revision: num, createdAt: legacy.createdAt, hasFeedback: false, feedbackConsumed: false });
      }
      rmSync(historyDir, { recursive: true, force: true });
    }

    // Migrate current version
    const currentRev = legacy.version;
    const revDir = this.revisionDir(id, currentRev);
    mkdirSync(revDir, { recursive: true });
    if (existsSync(flatJsx)) {
      renameSync(flatJsx, join(revDir, "plan.jsx"));
    }
    if (existsSync(flatCompiled)) {
      renameSync(flatCompiled, join(revDir, "plan.compiled.js"));
    }
    revisions.push({ revision: currentRev, createdAt: legacy.updatedAt, hasFeedback: false, feedbackConsumed: false });

    // Write new meta
    const meta: SessionMeta = {
      projectRoot: legacy.projectRoot,
      createdAt: legacy.createdAt,
      updatedAt: legacy.updatedAt,
      currentRevision: currentRev,
      revisions,
    };
    writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 2));
  }

  private readRevisionJsx(id: string, rev: number): string | null {
    try {
      return readFileSync(join(this.revisionDir(id, rev), "plan.jsx"), "utf-8");
    } catch {
      return null;
    }
  }

  upsert(id: string, jsx: string, projectRoot: string, label?: string, sourceFile?: string): SessionData {
    const existing = this.sessions.get(id);
    const now = new Date().toISOString();
    const revision = existing ? existing.currentRevision + 1 : 1;

    const revInfo: RevisionInfo = { revision, createdAt: now, hasFeedback: false, feedbackConsumed: false, ...(label ? { label } : {}), ...(sourceFile ? { sourceFile } : {}) };
    const revisions = existing ? [...existing.revisions, revInfo] : [revInfo];

    const session: SessionData = {
      id,
      projectRoot,
      jsx,
      currentRevision: revision,
      revisions,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.sessions.set(id, session);
    this.persistToDisk(session);
    return session;
  }

  private persistMeta(session: SessionData) {
    const meta: SessionMeta = {
      projectRoot: session.projectRoot,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      currentRevision: session.currentRevision,
      revisions: session.revisions,
    };
    writeFileSync(join(this.sessionDir(session.id), "meta.json"), JSON.stringify(meta, null, 2));
  }

  private persistToDisk(session: SessionData) {
    const revDir = this.revisionDir(session.id, session.currentRevision);
    mkdirSync(revDir, { recursive: true });
    writeFileSync(join(revDir, "plan.jsx"), session.jsx);
    this.persistMeta(session);
  }

  get(id: string): SessionData | undefined {
    return this.sessions.get(id);
  }

  list(): SessionData[] {
    return Array.from(this.sessions.values());
  }

  remove(id: string) {
    this.sessions.delete(id);
    rmSync(this.sessionDir(id), { recursive: true, force: true });
  }

  saveCompiled(id: string, js: string, rev?: number) {
    const session = this.sessions.get(id);
    const revision = rev ?? session?.currentRevision;
    if (!revision) return;
    const revDir = this.revisionDir(id, revision);
    mkdirSync(revDir, { recursive: true });
    writeFileSync(join(revDir, "plan.compiled.js"), js);
  }

  getCompiled(id: string, rev?: number): string | null {
    const session = this.sessions.get(id);
    const revision = rev ?? session?.currentRevision;
    if (!revision) return null;
    try {
      return readFileSync(join(this.revisionDir(id, revision), "plan.compiled.js"), "utf-8");
    } catch {
      return null;
    }
  }

  saveFeedback(id: string, rev: number, markdown: string) {
    const revDir = this.revisionDir(id, rev);
    mkdirSync(revDir, { recursive: true });
    writeFileSync(join(revDir, "feedback.md"), markdown);

    const session = this.sessions.get(id);
    if (session) {
      const ri = session.revisions.find((r) => r.revision === rev);
      if (ri) {
        ri.hasFeedback = true;
        ri.feedbackConsumed = false;
      }
      this.persistMeta(session);
    }
  }

  getFeedback(id: string, rev: number): string | null {
    try {
      return readFileSync(join(this.revisionDir(id, rev), "feedback.md"), "utf-8");
    } catch {
      return null;
    }
  }

  consumeFeedback(id: string, rev: number) {
    const session = this.sessions.get(id);
    if (!session) return;
    const ri = session.revisions.find((r) => r.revision === rev);
    if (!ri || !ri.hasFeedback || ri.feedbackConsumed) return;
    ri.feedbackConsumed = true;
    this.persistMeta(session);
  }

  getLatestUnconsumedFeedback(id: string): { revision: number; feedback: string } | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    // Search from newest to oldest
    for (let i = session.revisions.length - 1; i >= 0; i--) {
      const ri = session.revisions[i];
      if (ri.hasFeedback && !ri.feedbackConsumed) {
        const feedback = this.getFeedback(id, ri.revision);
        if (feedback) return { revision: ri.revision, feedback };
      }
    }
    return null;
  }

  getRevisionJsxPath(id: string, rev: number): string {
    return join(this.revisionDir(id, rev), "plan.jsx");
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
