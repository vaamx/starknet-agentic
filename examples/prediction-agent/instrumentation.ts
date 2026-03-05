export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;
  const { ensureChildSelfSchedulerStarted } = await import(
    "./app/lib/child-self-scheduler"
  );
  ensureChildSelfSchedulerStarted();
}
