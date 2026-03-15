import { parseArgs } from "util";
import { DAEMON_PORT, BASE_URL } from "../config.ts";
import { isDaemonRunning, startDaemon, stopDaemon } from "../daemon-lifecycle.ts";

export async function handleDaemon(args: string[]) {
  const { positionals } = parseArgs({
    args,
    allowPositionals: true,
  });

  const subcommand = positionals[0];

  switch (subcommand) {
    case "status": {
      try {
        const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(2000) });
        const data = await res.json() as any;
        console.log(`Daemon: running on port ${DAEMON_PORT}`);
        console.log(`Sessions: ${data.sessions.length > 0 ? data.sessions.join(", ") : "none"}`);
      } catch {
        console.log("Daemon: not running");
      }
      break;
    }
    case "stop": {
      stopDaemon();
      break;
    }
    case "start": {
      if (await isDaemonRunning()) {
        console.log("Daemon is already running.");
        return;
      }
      await startDaemon();
      break;
    }
    case "restart": {
      stopDaemon();
      for (let i = 0; i < 10; i++) {
        if (!(await isDaemonRunning())) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      await startDaemon();
      break;
    }
    default: {
      console.error("Usage: agent-canvas daemon [status|stop|start|restart]");
      process.exit(1);
    }
  }
}
