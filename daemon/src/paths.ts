import { join } from "path";
import { createCanvasPaths } from "@fabrika/canvas-kernel/server";

/** agent-canvas's on-disk layout. Kept in sync with bin/lib/config.ts. */
export const paths = createCanvasPaths({ appName: "agent-canvas" });

export const DATA_DIR = paths.dataDir;
export const SESSIONS_DIR = paths.sessionsDir;
export const TEMP_DIR = paths.tempDir;
export const PID_FILE = paths.pidFile;
export const COMPILE_TEMP_DIR = paths.compileTempDir;
export const UPLOADS_DIR = paths.uploadsDir;

/** Capability used only by the CLI to resolve secret values */
export const CLI_AUTH_FILE = join(paths.tempDir, "daemon-auth-token");
