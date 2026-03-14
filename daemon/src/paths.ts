import { join } from "path";
import { homedir, tmpdir } from "os";
import { mkdirSync } from "fs";

/** Persistent data — survives reboots */
export const DATA_DIR = join(homedir(), ".claude", "agent-canvas");

/** Session storage */
export const SESSIONS_DIR = join(DATA_DIR, "sessions");

/** Ephemeral — can be lost on reboot */
export const TEMP_DIR = join(tmpdir(), "agent-canvas");

/** PID file for daemon process */
export const PID_FILE = join(TEMP_DIR, "daemon.pid");

/** Temp dir for JSX compilation */
export const COMPILE_TEMP_DIR = join(TEMP_DIR, "compile");

// Ensure dirs exist
mkdirSync(SESSIONS_DIR, { recursive: true });
mkdirSync(COMPILE_TEMP_DIR, { recursive: true });
