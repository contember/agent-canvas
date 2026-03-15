import { resolve, join, dirname } from "path";
import { tmpdir } from "os";

export const PACKAGE_ROOT = resolve(join(dirname(import.meta.path), "../.."));
export const TEMP_DIR = join(tmpdir(), "agent-canvas");
export const DAEMON_PORT = parseInt(process.env.CANVAS_PORT || "19400", 10);
export const BASE_URL = `http://localhost:${DAEMON_PORT}`;
export const WS_URL = `ws://localhost:${DAEMON_PORT}`;
export const TIMEOUT_MS = parseInt(process.env.CANVAS_TIMEOUT || String(60 * 60 * 1000), 10);
export const PID_FILE = join(TEMP_DIR, "daemon.pid");
