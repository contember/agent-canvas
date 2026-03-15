import { parseArgs } from "util";
import { ensureDaemon } from "../daemon-lifecycle.ts";
import { getSessionId, consumeFeedback, waitForFeedback } from "../helpers.ts";

export async function handleWatch(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      session: { type: "string" },
    },
  });

  const sessionId = getSessionId(values.session);
  await ensureDaemon();

  const feedback = await consumeFeedback(sessionId);
  if (feedback) {
    process.stdout.write(feedback);
    process.exit(0);
  }

  await waitForFeedback(sessionId);
}
