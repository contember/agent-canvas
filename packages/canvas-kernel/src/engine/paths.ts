import { join } from "path";
import { tmpdir, homedir } from "os";
import { mkdirSync } from "fs";

/**
 * On-disk layout for one canvas host (agent-canvas, fabrika, …).
 *
 * Built explicitly by the host at startup rather than resolved from module-level
 * constants, so importing the kernel has no side effects and two hosts can
 * coexist in one process (tests rely on this).
 */
export interface CanvasPaths {
  /** Persistent root — survives reboots. */
  dataDir: string;
  /** Session + revision store. */
  sessionsDir: string;
  /** Ephemeral root — may be lost on reboot. */
  tempDir: string;
  /** Daemon PID file. */
  pidFile: string;
  /** Scratch space for JSX compilation. */
  compileTempDir: string;
  /** Uploaded annotation images. */
  uploadsDir: string;
}

export interface CanvasPathsConfig {
  /** Namespace for on-disk locations, e.g. `"agent-canvas"` or `"fabrika"`. */
  appName: string;
  /**
   * Persistent root. Defaults to `~/.claude/<appName>`. Hosts that keep data
   * elsewhere — or that migrate from a legacy location — resolve it themselves
   * and pass the result; the kernel holds no migration policy.
   */
  dataDir?: string;
  /** Ephemeral root. Defaults to `<tmpdir>/<appName>`. */
  tempDir?: string;
  /** Create the directories. Pass `false` when only the strings are needed. */
  ensure?: boolean;
}

export function createCanvasPaths(config: CanvasPathsConfig): CanvasPaths {
  const { appName, ensure = true } = config;
  const dataDir = config.dataDir ?? join(homedir(), ".claude", appName);
  const tempDir = config.tempDir ?? join(tmpdir(), appName);

  const paths: CanvasPaths = {
    dataDir,
    sessionsDir: join(dataDir, "sessions"),
    tempDir,
    pidFile: join(tempDir, "daemon.pid"),
    compileTempDir: join(tempDir, "compile"),
    uploadsDir: join(tempDir, "uploads"),
  };

  if (ensure) {
    mkdirSync(paths.sessionsDir, { recursive: true });
    mkdirSync(paths.compileTempDir, { recursive: true });
    mkdirSync(paths.uploadsDir, { recursive: true });
  }

  return paths;
}
