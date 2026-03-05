import { describe, expect, it } from "vitest";
import type { AgentAction, LoopStatus } from "./agent-loop";
import type { SpawnedAgent } from "./agent-spawner";
import { computeAgentMetrics, formatMetricsPrometheus } from "./agent-metrics";

function makeLoopStatus(overrides?: Partial<LoopStatus>): LoopStatus {
  return {
    isRunning: true,
    tickCount: 42,
    lastTickAt: 1700000000000,
    nextTickAt: 1700000060000,
    activeAgentCount: 5,
    intervalMs: 60000,
    onChainEnabled: true,
    aiEnabled: true,
    signerMode: "owner",
    sessionKeyConfigured: false,
    autoResolveEnabled: true,
    defiEnabled: false,
    defiAutoTrade: false,
    debateEnabled: true,
    ...overrides,
  };
}

function makeAction(overrides?: Partial<AgentAction>): AgentAction {
  return {
    id: "action-1",
    timestamp: 1700000000000,
    agentId: "agent-a",
    agentName: "Agent A",
    type: "research",
    detail: "ok",
    ...overrides,
  };
}

function makeChildAgent(overrides?: Partial<SpawnedAgent>): SpawnedAgent {
  return {
    id: "child-1",
    name: "Child One",
    persona: {
      id: "child-persona",
      name: "Child Persona",
      model: "claude-sonnet-4-6",
      systemPrompt: "forecast",
      preferredSources: ["news"],
    } as SpawnedAgent["persona"],
    budget: {
      totalBudget: 10n,
      spent: 0n,
      maxBetSize: 5n,
    },
    createdAt: 1700000000000,
    status: "running",
    stats: {
      predictions: 0,
      bets: 0,
      pnl: 0n,
    },
    ...overrides,
  };
}

describe("agent-metrics", () => {
  it("computes consensus guardrail metrics from structured action metadata", () => {
    const snapshot = computeAgentMetrics({
      loopStatus: makeLoopStatus(),
      quarantineSecs: 600,
      nowMs: 1700000600000,
      spawnedAgents: [],
      actions: [
        makeAction({
          id: "pred-1",
          type: "prediction",
          consensusMeta: {
            enabled: true,
            applied: true,
            guardrailReason: "delta_clamped",
            leadProbability: 0.52,
            finalProbability: 0.67,
            deltaFromLead: 0.15,
            peerCount: 4,
            peerWeightTotal: 14.2,
            minPeersUsed: 2,
            minPeerPredictionCountUsed: 4,
            minTotalPeerWeightUsed: 4,
            maxShiftUsed: 0.12,
            autotune: {
              enabled: true,
              sampleCount: 12,
              drift: 0.03,
              normalizedDrift: 0.5,
            },
          },
        }),
        makeAction({
          id: "pred-2",
          type: "prediction",
          consensusMeta: {
            enabled: true,
            applied: false,
            guardrailReason: "insufficient_peer_count",
            leadProbability: 0.49,
            finalProbability: 0.49,
            deltaFromLead: 0,
            peerCount: 0,
            peerWeightTotal: 0,
            minPeersUsed: 1,
            minPeerPredictionCountUsed: 3,
            minTotalPeerWeightUsed: 2,
            maxShiftUsed: 0.15,
            autotune: {
              enabled: true,
              sampleCount: 12,
              drift: 0.03,
              normalizedDrift: 0.5,
            },
          },
        }),
        makeAction({ id: "err-1", type: "error" }),
      ],
    });

    expect(snapshot.actions.windowSize).toBe(3);
    expect(snapshot.actions.byType.prediction).toBe(2);
    expect(snapshot.actions.byType.error).toBe(1);
    expect(snapshot.consensus.sampleCount).toBe(2);
    expect(snapshot.consensus.appliedCount).toBe(1);
    expect(snapshot.consensus.blockedCount).toBe(1);
    expect(snapshot.consensus.guardrailCounts.delta_clamped).toBe(1);
    expect(snapshot.consensus.guardrailCounts.insufficient_peer_count).toBe(1);
    expect(snapshot.consensus.avgPeerCount).toBe(2);
  });

  it("computes runtime event and quarantine metrics", () => {
    const now = 1700000000000;

    const snapshot = computeAgentMetrics({
      loopStatus: makeLoopStatus(),
      quarantineSecs: 300,
      nowMs: now,
      spawnedAgents: [
        makeChildAgent({
          runtime: {
            provider: "bitsage-cloud",
            machineId: "m-1",
            flyMachineId: "f-1",
            tier: "nano",
            region: "iad",
            preferredRegions: ["iad", "sfo", "fra"],
            regionFailureLog: [
              { region: "sfo", failedAt: now - 90_000 },
              { region: "fra", failedAt: now - 700_000 },
            ],
            status: "running",
            createdAt: now - 300_000,
            lastHeartbeatAt: now - 30_000,
            consecutiveHeartbeatFailures: 0,
            failoverCount: 3,
            lastFailoverAt: now - 90_000,
          },
        }),
      ],
      actions: [
        makeAction({
          type: "runtime",
          runtimeMeta: { event: "provisioned", machineId: "m-1", region: "iad" },
        }),
        makeAction({
          type: "runtime",
          runtimeMeta: {
            event: "failed_over",
            previousMachineId: "m-0",
            machineId: "m-1",
            previousRegion: "sfo",
            region: "iad",
          },
        }),
        makeAction({
          type: "error",
          runtimeMeta: { event: "heartbeat_error", machineId: "m-1" },
        }),
        makeAction({
          type: "error",
          runtimeMeta: { event: "terminated", machineId: "m-1" },
        }),
      ],
    });

    expect(snapshot.runtime.childAgents).toBe(1);
    expect(snapshot.runtime.activeRuntimes).toBe(1);
    expect(snapshot.runtime.byStatus.running).toBe(1);
    expect(snapshot.runtime.events.provisioned).toBe(1);
    expect(snapshot.runtime.events.failedOver).toBe(1);
    expect(snapshot.runtime.events.heartbeatError).toBe(1);
    expect(snapshot.runtime.events.terminated).toBe(1);
    expect(snapshot.runtime.maxFailoverCount).toBe(3);
    expect(snapshot.runtime.quarantinedRegionCount).toBe(1);
    expect(snapshot.runtime.quarantinedRegions[0]?.region).toBe("sfo");
  });

  it("formats prometheus output", () => {
    const snapshot = computeAgentMetrics({
      loopStatus: makeLoopStatus(),
      quarantineSecs: 600,
      nowMs: 1700000000000,
      spawnedAgents: [],
      actions: [makeAction({ type: "prediction" })],
    });

    const output = formatMetricsPrometheus(snapshot);
    expect(output).toContain("prediction_agent_uptime_seconds");
    expect(output).toContain('prediction_agent_actions_by_type{type="prediction"}');
    expect(output).toContain('prediction_agent_runtime_events{event="failed_over"}');
  });
});
