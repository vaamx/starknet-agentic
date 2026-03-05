import type { AgentPersona } from "./agent-personas";
import type { SpawnedAgent } from "./agent-spawner";

export interface TickAgentActor {
  persona: AgentPersona;
  spawned?: SpawnedAgent;
}

/**
 * Build the set of agents eligible for a single autonomous tick.
 * Built-ins always come first for deterministic ordering; spawned agents follow.
 */
export function buildTickAgentActors(
  personas: AgentPersona[],
  spawnedAgents: SpawnedAgent[]
): TickAgentActor[] {
  const builtInActors: TickAgentActor[] = personas.map((persona) => ({
    persona,
  }));

  const spawnedActors: TickAgentActor[] = spawnedAgents
    .filter((agent) => agent.status === "running")
    .map((agent) => ({
      persona: agent.persona,
      spawned: agent,
    }));

  return [...builtInActors, ...spawnedActors];
}

/**
 * Deterministically pick the next agent from the rotation.
 * Returns null when no actors are available.
 */
export function selectTickAgentActor(
  actors: TickAgentActor[],
  rotationIndex: number
): { actor: TickAgentActor; nextIndex: number } | null {
  const selected = selectTickAgentActors(actors, rotationIndex, 1);
  if (!selected) return null;
  return {
    actor: selected.actors[0],
    nextIndex: selected.nextIndex,
  };
}

/**
 * Deterministically select a batch of agents from the rotation.
 * The nextIndex advances by the number of actors returned.
 */
export function selectTickAgentActors(
  actors: TickAgentActor[],
  rotationIndex: number,
  count: number
): { actors: TickAgentActor[]; nextIndex: number } | null {
  if (actors.length === 0) return null;

  const normalizedIndex =
    Number.isFinite(rotationIndex) && rotationIndex >= 0
      ? Math.floor(rotationIndex)
      : 0;
  const safeCount = Number.isFinite(count) ? Math.floor(count) : 1;
  const take = Math.max(1, Math.min(actors.length, safeCount));

  const selected: TickAgentActor[] = [];
  for (let offset = 0; offset < take; offset += 1) {
    const pickIndex = (normalizedIndex + offset) % actors.length;
    selected.push(actors[pickIndex]);
  }

  return {
    actors: selected,
    nextIndex: normalizedIndex + take,
  };
}
