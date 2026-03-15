import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { BASE_URL, WS_URL, TIMEOUT_MS } from "./config.ts";

export function getSessionId(session?: string): string {
  if (session) return session;
  return process.env.CANVAS_SESSION_ID || (() => {
    const id = randomUUID();
    console.error(`Warning: CANVAS_SESSION_ID not set, using generated ID: ${id}`);
    return id;
  })();
}

export async function consumeFeedback(sessionId: string): Promise<string | null> {
  const res = await fetch(`${BASE_URL}/api/session/${sessionId}/feedback/consume`, { method: "POST" });
  const data = await res.json() as any;
  if (data.found) return data.feedback;
  return null;
}

export function openBrowser(url: string) {
  const candidates = process.platform === "darwin"
    ? ["open"]
    : ["xdg-open", "wslview", "sensible-browser"];

  for (const cmd of candidates) {
    const which = Bun.spawnSync(["which", cmd]);
    if (which.exitCode === 0) {
      spawn(cmd, [url], { detached: true, stdio: "ignore" }).unref();
      return;
    }
  }
  console.error(`Open this URL in your browser: ${url}`);
}

export async function waitForFeedback(sessionId: string): Promise<void> {
  return new Promise((resolveP, rejectP) => {
    const ws = new WebSocket(`${WS_URL}/ws/wait/${sessionId}`);
    const timeout = setTimeout(() => {
      ws.close();
      console.error("Error: Timeout waiting for feedback.");
      process.exit(1);
    }, TIMEOUT_MS);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(typeof event.data === "string" ? event.data : "");
        if (data.type === "submit") {
          clearTimeout(timeout);
          process.stdout.write(data.feedback);
          ws.close();
          process.exit(0);
        }
      } catch {}
    };

    ws.onerror = () => {
      clearTimeout(timeout);
      console.error("Error: WebSocket connection failed.");
      process.exit(1);
    };

    ws.onclose = () => {
      clearTimeout(timeout);
    };
  });
}

export async function readLine(): Promise<string> {
  const buf: number[] = [];
  for await (const chunk of Bun.stdin.stream()) {
    for (const byte of chunk) {
      if (byte === 10) return Buffer.from(buf).toString("utf-8");
      buf.push(byte);
    }
  }
  return Buffer.from(buf).toString("utf-8");
}
