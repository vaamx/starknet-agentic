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
  if (actors.length === 0) return null;

  const normalizedIndex =
    Number.isFinite(rotationIndex) && rotationIndex >= 0
      ? Math.floor(rotationIndex)
      : 0;

  const pickIndex = normalizedIndex % actors.length;
  return {
    actor: actors[pickIndex],
    nextIndex: normalizedIndex + 1,
  };
}
