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

/**
 * A single piece of feedback received from a remote (shared) reviewer.
 * Structured so it can be merged into the local annotation system alongside
 * the author's own annotations. `annotations` is the structured list of
 * highlighted-text comments; `generalNote` is the free-form markdown.
 */
export interface RemoteFeedbackEntry {
  /** Stable unique id assigned by the worker; used to dedupe on re-poll */
  id: string;
  shareId: string;
  revision: number;
  /** ISO timestamp when the reviewer submitted */
  submittedAt: string;
  author: { id: string; name: string };
  annotations: RemoteAnnotation[];
  generalNote?: string;
}

/**
 * Mirror of the client-side Annotation shape, minus fields that only make
 * sense locally. Kept intentionally narrow so the wire format is stable.
 */
export interface RemoteAnnotation {
  id: string;
  snippet: string;
  note: string;
  createdAt: string;
  filePath?: string;
  canvasFile?: string;
  context?: {
    before: string;
    after: string;
    hierarchy: string[];
    lineStart?: number;
    lineEnd?: number;
  };
  attachments?: { url: string; mime?: string }[];
}

/**
 * A share is a snapshot of a specific revision that has been pushed to a
 * remote endpoint (CF Worker) for external review. The `shareId` is the
 * opaque capability token returned by the worker; the `url` is the full
 * public URL the user shared with reviewers.
 */
export interface ShareEntry {
  shareId: string;
  url: string;
  revision: number;
  createdAt: string;
  /** Bearer token returned by the worker — proves ownership for revoke. */
  ownerToken?: string;
  /** ISO timestamp when the share will expire on the worker side. */
  expiresAt?: string;
  /** ISO timestamp of the most recent remote feedback we've seen */
  lastFeedbackAt?: string;
}

export interface SessionData {
  id: string;
  projectRoot: string;
  canvasFiles: string[];
  currentRevision: number;
  revisions: RevisionInfo[];
  createdAt: string;
  updatedAt: string;
  shares?: ShareEntry[];
}

interface SessionMeta {
  projectRoot: string;
  createdAt: string;
  updatedAt: string;
  currentRevision: number;
  revisions: RevisionInfo[];
  shares?: ShareEntry[];
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
  private readonly sessionsDir: string;

  /**
   * @param sessionsDir Override the on-disk sessions root. Defaults to
   *   the global SESSIONS_DIR (`~/.claude/agent-canvas/sessions`).
   *   Tests pass an isolated temp directory so they don't interfere with
   *   the user's real sessions.
   */
  constructor(sessionsDir?: string) {
    this.sessionsDir = sessionsDir ?? SESSIONS_DIR;
    mkdirSync(this.sessionsDir, { recursive: true });
    this.loadFromDisk();
  }

  private sessionDir(id: string): string {
    return join(this.sessionsDir, id);
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
    if (!existsSync(this.sessionsDir)) return;
    for (const name of readdirSync(this.sessionsDir, { withFileTypes: true })) {
      if (!name.isDirectory()) continue;
      const dir = join(this.sessionsDir, name.name);
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
          ...(meta.shares ? { shares: meta.shares } : {}),
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
      ...(session.shares?.length ? { shares: session.shares } : {}),
    };
    writeFileSync(join(this.sessionDir(session.id), "meta.json"), JSON.stringify(meta, null, 2));
  }

  /** Record a new share for a session revision. */
  addShare(id: string, entry: ShareEntry): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.shares = [...(session.shares ?? []), entry];
    session.updatedAt = new Date().toISOString();
    this.persistMeta(session);
  }

  getShares(id: string): ShareEntry[] {
    return this.sessions.get(id)?.shares ?? [];
  }

  removeShare(id: string, shareId: string): void {
    const session = this.sessions.get(id);
    if (!session?.shares) return;
    session.shares = session.shares.filter((s) => s.shareId !== shareId);
    session.updatedAt = new Date().toISOString();
    this.persistMeta(session);
  }

  updateShareLastFeedback(id: string, shareId: string, at: string): void {
    const session = this.sessions.get(id);
    if (!session?.shares) return;
    const entry = session.shares.find((s) => s.shareId === shareId);
    if (!entry) return;
    entry.lastFeedbackAt = at;
    this.persistMeta(session);
  }

  /** List all sessions that have at least one share. Used by the remote feedback poller. */
  listSessionsWithShares(): SessionData[] {
    return Array.from(this.sessions.values()).filter((s) => (s.shares?.length ?? 0) > 0);
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

  /**
   * Remote feedback from shared views. Stored as one JSON file per revision
   * at `revisions/{rev}/remote_feedback.json`, containing an array of
   * RemoteFeedbackEntry. Appended to (not replaced) as new feedback arrives.
   */
  appendRemoteFeedback(id: string, rev: number, entries: RemoteFeedbackEntry[]): void {
    if (entries.length === 0) return;
    const revDir = this.revisionDir(id, rev);
    mkdirSync(revDir, { recursive: true });
    const file = join(revDir, "remote_feedback.json");
    let existing: RemoteFeedbackEntry[] = [];
    try {
      existing = JSON.parse(readFileSync(file, "utf-8"));
    } catch {}
    const seen = new Set(existing.map((e) => e.id));
    const merged = [...existing];
    for (const e of entries) if (!seen.has(e.id)) merged.push(e);
    writeFileSync(file, JSON.stringify(merged, null, 2));
  }

  getRemoteFeedback(id: string, rev: number): RemoteFeedbackEntry[] {
    try {
      return JSON.parse(readFileSync(join(this.revisionDir(id, rev), "remote_feedback.json"), "utf-8"));
    } catch {
      return [];
    }
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
