import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, renameSync, copyFileSync } from "fs";
import { join } from "path";

export interface DiffStats {
  added: number;
  removed: number;
}

export interface CanvasFileInfo {
  filename: string;
  diffStats?: DiffStats;
}

/** How the caller selected the canvases in a revision. New revisions always
 * carry this explicitly; its absence identifies legacy metadata. */
export type CanvasScope =
  | { kind: "view"; filename: string }
  | { kind: "directory" };

export interface RevisionInfo {
  revision: number;
  label?: string;
  canvasFiles: CanvasFileInfo[];
  createdAt: string;
  hasFeedback: boolean;
  feedbackConsumed: boolean;
  response?: string;
  canvasScope?: CanvasScope;
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
  /** Base64url-encoded AES-GCM key for end-to-end encrypted shares. The
   *  same key is also embedded in `url` as a `#k=...` fragment so reviewers
   *  can decrypt; the daemon keeps a copy here so it can decrypt feedback
   *  it polls back from the worker. Absent on legacy unencrypted shares. */
  encryptionKey?: string;
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

export type SecretResolution =
  | { ok: true; values: Map<string, string> }
  | { ok: false; missing: string[] };

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

function computeLineDiffStats(oldText: string, newText: string): DiffStats {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const m = oldLines.length, n = newLines.length;

  // LCS length via two-row DP (O(n) space)
  let prev = new Uint32Array(n + 1);
  let curr = new Uint32Array(n + 1);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      // The `?? 0` fallbacks are for the checker only — both rows are n+1 long.
      curr[j] = oldLines[i - 1] === newLines[j - 1]
        ? (prev[j - 1] ?? 0) + 1
        : Math.max(prev[j] ?? 0, curr[j - 1] ?? 0);
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }
  const lcsLen = prev[n] ?? 0;
  return { added: n - lcsLen, removed: m - lcsLen };
}

export class SessionManager {
  private sessions = new Map<string, SessionData>();
  private sessionSecrets = new Map<string, { revision: number; values: Map<string, string> }>();
  private readonly sessionsDir: string;

  /**
   * @param sessionsDir On-disk sessions root, from `createCanvasPaths()`.
   *   Tests pass an isolated temp directory so they don't interfere with
   *   the user's real sessions.
   */
  constructor(sessionsDir: string) {
    this.sessionsDir = sessionsDir;
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
        const [firstRevision] = meta.revisions;
        if (firstRevision && !("canvasFiles" in firstRevision)) {
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
      } catch (cause) {
        // A session that fails here vanishes from the list, and migration moves
        // the user's files before it can fail — so staying silent loses work
        // without saying so. Other sessions still load.
        const reason = cause instanceof Error ? cause.message : String(cause);
        console.warn(`[sessions] ${name.name}: could not be loaded (${reason})`);
      }
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
      // By revision number, not by name — sorting as text puts 10 before 2, and
      // the order of this array is the revision order everything else reads.
      const files = readdirSync(historyDir)
        .filter((f) => f.endsWith(".jsx"))
        .map((file) => ({ file, num: parseInt(file.replace(".jsx", ""), 10) }))
        .filter(({ num }) => !isNaN(num))
        .sort((a, b) => a.num - b.num);
      for (const { file, num } of files) {
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

    // Only once the new layout is on disk. Anything that fails above leaves the
    // old directory in place rather than half-migrated and unrecorded.
    rmSync(historyDir, { recursive: true, force: true });
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
  upsert(id: string, canvasFiles: Map<string, string>, projectRoot: string, label?: string, response?: string, canvasScope?: CanvasScope): SessionData {
    const existing = this.sessions.get(id);
    const now = new Date().toISOString();
    // Stable session IDs must never recycle revision numbers used as browser draft keys.
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
      ...(canvasScope ? { canvasScope } : {}),
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
      // A session belongs to the project it was created in. Callers send their
      // cwd, so a later push from elsewhere must not repoint it — that would
      // send project-relative reads (file previews, phase state) to the wrong
      // tree.
      projectRoot: existing?.projectRoot ?? projectRoot,
      canvasFiles: filenames,
      currentRevision: revision,
      revisions,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    // Secrets belong to one revision and must never carry into a new runbook.
    this.sessionSecrets.delete(id);
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
    this.sessionSecrets.delete(id);
    rmSync(this.sessionDir(id), { recursive: true, force: true });
  }

  setSecret(id: string, fieldId: string, value: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;

    let secrets = this.sessionSecrets.get(id);
    if (!secrets || secrets.revision !== session.currentRevision) {
      secrets = { revision: session.currentRevision, values: new Map() };
      this.sessionSecrets.set(id, secrets);
    }
    secrets.values.set(fieldId, value);
    return true;
  }

  hasSecret(id: string, fieldId: string): boolean {
    const session = this.sessions.get(id);
    const secrets = this.sessionSecrets.get(id);
    return !!session
      && secrets?.revision === session.currentRevision
      && secrets.values.has(fieldId);
  }

  clearSecret(id: string, fieldId: string): boolean {
    const session = this.sessions.get(id);
    const secrets = this.sessionSecrets.get(id);
    if (!session || secrets?.revision !== session.currentRevision) return false;
    return secrets.values.delete(fieldId);
  }

  resolveSecrets(id: string, fieldIds: string[]): SecretResolution | null {
    const session = this.sessions.get(id);
    if (!session) return null;

    const secrets = this.sessionSecrets.get(id);
    const missing = fieldIds.filter((fieldId) =>
      secrets?.revision !== session.currentRevision || !secrets.values.has(fieldId)
    );
    if (missing.length > 0) return { ok: false, missing };

    const values = new Map<string, string>();
    for (const fieldId of fieldIds) {
      const value = secrets?.values.get(fieldId);
      if (value !== undefined) values.set(fieldId, value);
    }
    return { ok: true, values };
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
      // Feedback arriving is activity: it orders the session list, and it must
      // not leave a session looking untouched while its feedback waits.
      session.updatedAt = new Date().toISOString();
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
      if (ri?.hasFeedback && !ri.feedbackConsumed) {
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

    // Same reason as saveFeedback — a reviewer's comment is input for this
    // session, not something that happens beside it.
    const session = this.sessions.get(id);
    if (session) {
      session.updatedAt = new Date().toISOString();
      this.persistMeta(session);
    }
  }

  getRemoteFeedback(id: string, rev: number): RemoteFeedbackEntry[] {
    try {
      return JSON.parse(readFileSync(join(this.revisionDir(id, rev), "remote_feedback.json"), "utf-8"));
    } catch {
      return [];
    }
  }

  /**
   * Server-side backing store for an in-progress draft. Hosts that wire the
   * AnnotationProvider's loadState/saveState to these endpoints get drafts that
   * survive a reload and follow the author across browsers, instead of living
   * in one browser's localStorage. Opaque payload — the shape is the client's.
   */
  saveResponses(id: string, rev: number, payload: unknown): void {
    const revDir = this.revisionDir(id, rev);
    mkdirSync(revDir, { recursive: true });
    writeFileSync(join(revDir, "responses.json"), JSON.stringify(payload));
  }

  getResponses(id: string, rev: number): unknown | null {
    try {
      return JSON.parse(readFileSync(join(this.revisionDir(id, rev), "responses.json"), "utf-8"));
    } catch {
      return null;
    }
  }

  /** Drop sessions untouched for longer than `maxAge` (default 24h). */
  cleanupStale(maxAge = 24 * 60 * 60 * 1000) {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - new Date(session.updatedAt).getTime() > maxAge) {
        this.remove(id);
      }
    }
  }
}
