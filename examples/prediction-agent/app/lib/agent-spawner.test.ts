import { describe, expect, it } from "vitest";
import { AGENT_PERSONAS } from "./agent-personas";
import {
  agentSpawner,
  serializeForStorage,
  type SerializedSpawnedAgent,
  type SpawnedAgent,
} from "./agent-spawner";

describe("agent-spawner storage serialization", () => {
  it("preserves sovereign wallet and runtime metadata", () => {
    const agent: SpawnedAgent = {
      id: "spawned_test",
      name: "Spawned Test",
      persona: AGENT_PERSONAS[0],
      budget: {
        totalBudget: 300n * 10n ** 18n,
        spent: 20n * 10n ** 18n,
        maxBetSize: 10n * 10n ** 18n,
      },
      createdAt: Date.now(),
      status: "running",
      stats: {
        predictions: 3,
        bets: 1,
        pnl: 0n,
      },
      walletAddress: "0xabc123",
      agentId: 42n,
      runtime: {
        provider: "bitsage-cloud",
        machineId: "machine_1",
        flyMachineId: "fly_1",
        tier: "nano",
        region: "iad",
        preferredRegions: ["iad", "sfo"],
        status: "running",
        createdAt: Date.now(),
        lastHeartbeatAt: Date.now(),
        failoverCount: 1,
      },
    };

    const serialized = serializeForStorage(agent);
    expect(serialized.walletAddress).toBe("0xabc123");
    expect(serialized.agentId).toBe("42");
    expect(serialized.runtime?.provider).toBe("bitsage-cloud");
    expect(serialized.runtime?.machineId).toBe("machine_1");
    expect(serialized.runtime?.tier).toBe("nano");
    expect(serialized.runtime?.region).toBe("iad");
    expect(serialized.runtime?.preferredRegions).toEqual(["iad", "sfo"]);
    expect(serialized.runtime?.status).toBe("running");
    expect(serialized.runtime?.failoverCount).toBe(1);
  });

  it("restores persisted spawned agent with stable id and runtime", () => {
    const snapshot: SerializedSpawnedAgent = {
      id: "spawned_restore_1",
      name: "Restored",
      personaId: "alpha",
      agentType: "quant-forecaster",
      model: "claude-sonnet-4-6",
      preferredSources: ["news", "social"],
      budgetStrk: 250,
      maxBetStrk: 8,
      createdAt: Date.now() - 1_000,
      status: "paused",
      walletAddress: "0xrestored",
      agentId: "7",
      runtime: {
        provider: "bitsage-cloud",
        machineId: "machine-restored",
        flyMachineId: "fly-restored",
        tier: "micro",
        region: "sfo",
        preferredRegions: ["iad", "sfo", "fra"],
        status: "running",
        createdAt: Date.now() - 900,
        lastHeartbeatAt: Date.now() - 10,
        failoverCount: 2,
      },
    };

    const restored = agentSpawner.restore(snapshot);
    expect(restored.id).toBe("spawned_restore_1");
    expect(restored.name).toBe("Restored");
    expect(restored.status).toBe("paused");
    expect(restored.walletAddress).toBe("0xrestored");
    expect(restored.agentId).toBe(7n);
    expect(restored.runtime?.machineId).toBe("machine-restored");
    expect(restored.runtime?.flyMachineId).toBe("fly-restored");
    expect(restored.runtime?.tier).toBe("micro");
    expect(restored.runtime?.region).toBe("sfo");
    expect(restored.runtime?.preferredRegions).toEqual(["iad", "sfo", "fra"]);
    expect(restored.runtime?.failoverCount).toBe(2);
    agentSpawner.remove("spawned_restore_1");
  });
});
