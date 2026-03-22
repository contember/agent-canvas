import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, renameSync, copyFileSync } from "fs";
import { join } from "path";
import { SESSIONS_DIR } from "./paths";

export interface DiffStats {
  added: number;
  removed: number;
}

export interface CanvasFileInfo {
  filename: string;
  diffStats?: DiffStats;
}

export interface RevisionInfo {
  revision: number;
  label?: string;
  canvasFiles: CanvasFileInfo[];
  createdAt: string;
  hasFeedback: boolean;
  feedbackConsumed: boolean;
  response?: string;
}

export interface SessionData {
  id: string;
  projectRoot: string;
  canvasFiles: string[];
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

// Legacy format (flat files, pre-revision)
interface LegacyMeta {
  projectRoot: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

// Previous format (single sourceFile per revision)
interface LegacyRevisionInfo {
  revision: number;
  label?: string;
  sourceFile?: string;
  createdAt: string;
  hasFeedback: boolean;
  feedbackConsumed: boolean;
  response?: string;
  diffStats?: DiffStats;
}

const STALE_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours

function computeLineDiffStats(oldText: string, newText: string): DiffStats {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const m = oldLines.length, n = newLines.length;

  // LCS length via two-row DP (O(n) space)
  let prev = new Uint32Array(n + 1);
  let curr = new Uint32Array(n + 1);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      curr[j] = oldLines[i - 1] === newLines[j - 1]
        ? prev[j - 1] + 1
        : Math.max(prev[j], curr[j - 1]);
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }
  const lcsLen = prev[n];
  return { added: n - lcsLen, removed: m - lcsLen };
}

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

  /** Compute file order from revision history: first-appearance order, alpha for ties */
  private deriveFileOrder(revisions: RevisionInfo[], currentFiles: string[]): string[] {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const rev of revisions) {
      for (const cf of rev.canvasFiles) {
        if (!seen.has(cf.filename)) {
          seen.add(cf.filename);
          ordered.push(cf.filename);
        }
      }
    }
    // Keep only files that still exist, then append any unknown ones
    const current = new Set(currentFiles);
    const result = ordered.filter(f => current.has(f));
    const remaining = currentFiles.filter(f => !seen.has(f)).sort();
    return [...result, ...remaining];
  }

  /** List *.jsx filenames in a revision directory */
  getRevisionCanvasFiles(id: string, rev: number): string[] {
    const dir = this.revisionDir(id, rev);
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter(f => f.endsWith(".jsx")).sort();
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

        // Detect and migrate legacy flat-file format
        if ("version" in raw && !("currentRevision" in raw)) {
          this.migrateLegacy(name.name, raw as LegacyMeta);
          const migrated: SessionMeta = JSON.parse(readFileSync(metaPath, "utf-8"));
          const canvasFiles = this.getRevisionCanvasFiles(name.name, migrated.currentRevision);
          if (canvasFiles.length === 0) continue;
          this.sessions.set(name.name, {
            id: name.name,
            projectRoot: migrated.projectRoot,
            canvasFiles,
            currentRevision: migrated.currentRevision,
            revisions: migrated.revisions,
            createdAt: migrated.createdAt,
            updatedAt: migrated.updatedAt,
          });
          continue;
        }

        let meta = raw as SessionMeta;

        // Migrate single-sourceFile revision format to canvasFiles
        if (meta.revisions.length > 0 && !("canvasFiles" in meta.revisions[0])) {
          meta = {
            ...meta,
            revisions: (meta.revisions as unknown as LegacyRevisionInfo[]).map(r => ({
              revision: r.revision,
              label: r.label,
              canvasFiles: [{ filename: r.sourceFile || "plan.jsx", diffStats: r.diffStats }],
              createdAt: r.createdAt,
              hasFeedback: r.hasFeedback,
              feedbackConsumed: r.feedbackConsumed,
              response: r.response,
            })),
          };
          writeFileSync(metaPath, JSON.stringify(meta, null, 2));
        }

        const diskFiles = this.getRevisionCanvasFiles(name.name, meta.currentRevision);
        if (diskFiles.length === 0) continue;
        // Derive file order from revision history (first-appearance order)
        const canvasFiles = this.deriveFileOrder(meta.revisions, diskFiles);

        this.sessions.set(name.name, {
          id: name.name,
          projectRoot: meta.projectRoot,
          canvasFiles,
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
        revisions.push({
          revision: num,
          canvasFiles: [{ filename: "plan.jsx" }],
          createdAt: legacy.createdAt,
          hasFeedback: false,
          feedbackConsumed: false,
        });
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
    revisions.push({
      revision: currentRev,
      canvasFiles: [{ filename: "plan.jsx" }],
      createdAt: legacy.updatedAt,
      hasFeedback: false,
      feedbackConsumed: false,
    });

    const meta: SessionMeta = {
      projectRoot: legacy.projectRoot,
      createdAt: legacy.createdAt,
      updatedAt: legacy.updatedAt,
      currentRevision: currentRev,
      revisions,
    };
    writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 2));
  }

  readRevisionJsx(id: string, rev: number, filename: string): string | null {
    try {
      return readFileSync(join(this.revisionDir(id, rev), filename), "utf-8");
    } catch {
      return null;
    }
  }

  /**
   * Create or update a session with a set of canvas files.
   * @param canvasFiles Map of filename -> JSX content
   */
  upsert(id: string, canvasFiles: Map<string, string>, projectRoot: string, label?: string, response?: string): SessionData {
    const existing = this.sessions.get(id);
    const now = new Date().toISOString();
    const revision = existing ? existing.currentRevision + 1 : 1;

    // Compute per-file diffStats against the previous revision
    const prevRev = existing ? existing.currentRevision : 0;
    const canvasFileInfos: CanvasFileInfo[] = [];
    for (const [filename, jsx] of canvasFiles) {
      let diffStats: DiffStats | undefined;
      if (prevRev > 0) {
        const prevJsx = this.readRevisionJsx(id, prevRev, filename);
        if (prevJsx) {
          diffStats = computeLineDiffStats(prevJsx, jsx);
        }
      }
      canvasFileInfos.push({
        filename,
        ...(diffStats ? { diffStats } : {}),
      });
    }

    const revInfo: RevisionInfo = {
      revision,
      canvasFiles: canvasFileInfos,
      createdAt: now,
      hasFeedback: false,
      feedbackConsumed: false,
      ...(label ? { label } : {}),
      ...(response ? { response } : {}),
    };
    const revisions = existing ? [...existing.revisions, revInfo] : [revInfo];
    // Order: files from previous revision first (preserving their order), then new files alphabetically
    const prevOrder = existing?.canvasFiles ?? [];
    const currentNames = new Set(canvasFiles.keys());
    const filenames = [
      ...prevOrder.filter(f => currentNames.has(f)),
      ...[...currentNames].filter(f => !prevOrder.includes(f)).sort(),
    ];

    const session: SessionData = {
      id,
      projectRoot,
      canvasFiles: filenames,
      currentRevision: revision,
      revisions,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.sessions.set(id, session);
    this.persistToDisk(session, canvasFiles);
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

  private persistToDisk(session: SessionData, canvasFiles: Map<string, string>) {
    const revDir = this.revisionDir(session.id, session.currentRevision);
    mkdirSync(revDir, { recursive: true });
    for (const [filename, jsx] of canvasFiles) {
      writeFileSync(join(revDir, filename), jsx);
    }
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

  saveCompiled(id: string, filename: string, js: string, rev?: number) {
    const session = this.sessions.get(id);
    const revision = rev ?? session?.currentRevision;
    if (!revision) return;
    const revDir = this.revisionDir(id, revision);
    mkdirSync(revDir, { recursive: true });
    const compiledName = filename.replace(/\.jsx$/, ".compiled.js");
    writeFileSync(join(revDir, compiledName), js);
  }

  getCompiled(id: string, filename: string, rev?: number): string | null {
    const session = this.sessions.get(id);
    const revision = rev ?? session?.currentRevision;
    if (!revision) return null;
    const compiledName = filename.replace(/\.jsx$/, ".compiled.js");
    try {
      return readFileSync(join(this.revisionDir(id, revision), compiledName), "utf-8");
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
    for (let i = session.revisions.length - 1; i >= 0; i--) {
      const ri = session.revisions[i];
      if (ri.hasFeedback && !ri.feedbackConsumed) {
        const feedback = this.getFeedback(id, ri.revision);
        if (feedback) return { revision: ri.revision, feedback };
      }
    }
    return null;
  }

  getRevisionJsxPath(id: string, rev: number, filename: string): string {
    return join(this.revisionDir(id, rev), filename);
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
