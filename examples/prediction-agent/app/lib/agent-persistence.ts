import {
  agentSpawner,
  serializeForStorage,
  type SerializedSpawnedAgent,
} from "./agent-spawner";
import {
  getPersistedSpawnedAgents,
  setPersistedSpawnedAgents,
} from "./state-store";

let hydrated = false;
let hydrationPromise: Promise<void> | null = null;

export async function ensureAgentSpawnerHydrated(): Promise<void> {
  if (hydrated) return;
  if (hydrationPromise) return await hydrationPromise;

  hydrationPromise = (async () => {
    const persisted = await getPersistedSpawnedAgents();
    for (const snapshot of persisted) {
      agentSpawner.restore(snapshot);
    }
    hydrated = true;
    hydrationPromise = null;
  })().catch((err) => {
    hydrationPromise = null;
    throw err;
  });

  await hydrationPromise;
}

export async function persistAgentSpawner(): Promise<void> {
  const snapshots: SerializedSpawnedAgent[] = agentSpawner
    .list()
    .map((a) => serializeForStorage(a));
  await setPersistedSpawnedAgents(snapshots);
}
