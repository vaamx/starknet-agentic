import { describe, expect, it } from "vitest";
import { AGENT_PERSONAS } from "./agent-personas";
import type { SpawnedAgent } from "./agent-spawner";
import {
  buildTickAgentActors,
  selectTickAgentActor,
  selectTickAgentActors,
} from "./agent-loop-rotation";

function makeSpawnedAgent(
  id: string,
  status: SpawnedAgent["status"]
): SpawnedAgent {
  return {
    id,
    name: `Spawned-${id}`,
    persona: {
      ...AGENT_PERSONAS[0],
      id,
      name: `Spawned Persona ${id}`,
    },
    budget: {
      totalBudget: 100n,
      spent: 0n,
      maxBetSize: 10n,
    },
    createdAt: Date.now(),
    status,
    stats: {
      predictions: 0,
      bets: 0,
      pnl: 0n,
    },
  };
}

describe("agent-loop rotation", () => {
  it("includes running spawned agents and excludes paused/stopped", () => {
    const actors = buildTickAgentActors(AGENT_PERSONAS, [
      makeSpawnedAgent("spawned-running", "running"),
      makeSpawnedAgent("spawned-paused", "paused"),
      makeSpawnedAgent("spawned-stopped", "stopped"),
    ]);

    const actorIds = actors.map((a) => a.spawned?.id ?? a.persona.id);

    expect(actorIds).toContain("spawned-running");
    expect(actorIds).not.toContain("spawned-paused");
    expect(actorIds).not.toContain("spawned-stopped");
    expect(actorIds.length).toBe(AGENT_PERSONAS.length + 1);
  });

  it("returns null when no actors are available", () => {
    const selected = selectTickAgentActor([], 0);
    expect(selected).toBeNull();
  });

  it("rotates deterministically and wraps around actor length", () => {
    const actors = buildTickAgentActors(AGENT_PERSONAS.slice(0, 2), [
      makeSpawnedAgent("spawned-running", "running"),
    ]);

    const first = selectTickAgentActor(actors, 0);
    const second = selectTickAgentActor(actors, 1);
    const third = selectTickAgentActor(actors, 2);
    const wrapped = selectTickAgentActor(actors, 3);

    expect(first?.actor.persona.id).toBe(actors[0].persona.id);
    expect(second?.actor.persona.id).toBe(actors[1].persona.id);
    expect(third?.actor.spawned?.id).toBe("spawned-running");
    expect(wrapped?.actor.persona.id).toBe(actors[0].persona.id);
    expect(wrapped?.nextIndex).toBe(4);
  });

  it("selects a deterministic actor batch and advances rotation by batch size", () => {
    const actors = buildTickAgentActors(AGENT_PERSONAS.slice(0, 3), [
      makeSpawnedAgent("spawned-running", "running"),
    ]);

    const batch = selectTickAgentActors(actors, 2, 3);
    expect(batch).not.toBeNull();
    expect(batch?.actors).toHaveLength(3);
    expect(batch?.actors[0].persona.id).toBe(actors[2].persona.id);
    expect(batch?.actors[1].spawned?.id).toBe("spawned-running");
    expect(batch?.actors[2].persona.id).toBe(actors[0].persona.id);
    expect(batch?.nextIndex).toBe(5);
  });
});
