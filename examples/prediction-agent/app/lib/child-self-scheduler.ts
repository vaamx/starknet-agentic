import { config } from "./config";
import { agentLoop } from "./agent-loop";

declare global {
  // eslint-disable-next-line no-var
  var __childSelfSchedulerStarted: boolean | undefined;
  // eslint-disable-next-line no-var
  var __childSelfSchedulerTickInFlight: boolean | undefined;
}

function isChildSelfSchedulerEnabled(): boolean {
  return (
    config.childSelfSchedulerEnabled &&
    Boolean(process.env.CHILD_AGENT_NAME) &&
    process.env.NODE_ENV !== "test"
  );
}

async function runChildTick(): Promise<void> {
  if (globalThis.__childSelfSchedulerTickInFlight) return;
  globalThis.__childSelfSchedulerTickInFlight = true;
  try {
    const actions = await agentLoop.singleTick();
    console.log(
      `[child-self-scheduler] tick=${Date.now()} actions=${actions.length}`
    );
  } catch (err: any) {
    console.error(
      "[child-self-scheduler] tick failed:",
      err?.message ?? String(err)
    );
  } finally {
    globalThis.__childSelfSchedulerTickInFlight = false;
  }
}

export function ensureChildSelfSchedulerStarted(): void {
  if (!isChildSelfSchedulerEnabled()) return;
  if (globalThis.__childSelfSchedulerStarted) return;

  globalThis.__childSelfSchedulerStarted = true;

  const intervalMs = config.childSelfSchedulerIntervalMs;
  const jitterMs = config.childSelfSchedulerJitterMs;
  const firstRunDelay =
    jitterMs > 0 ? Math.floor(Math.random() * (jitterMs + 1)) : 0;

  setTimeout(() => {
    void runChildTick();
    setInterval(() => {
      void runChildTick();
    }, intervalMs);
  }, firstRunDelay);

  console.log(
    `[child-self-scheduler] started interval=${intervalMs}ms jitter<=${jitterMs}ms agent=${process.env.CHILD_AGENT_NAME}`
  );
}

