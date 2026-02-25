import type { AgentAction, LoopStatus } from "./agent-loop";
import { agentLoop } from "./agent-loop";
import type { ChildServerStatus, SpawnedAgent } from "./agent-spawner";
import { agentSpawner } from "./agent-spawner";
import type { ConsensusGuardrailReason } from "./consensus-weighting";
import { config } from "./config";

const PROCESS_STARTED_AT = Date.now();
const MAX_WINDOW_ACTIONS = 500;

const ACTION_TYPES: AgentAction["type"][] = [
  "research",
  "prediction",
  "bet",
  "resolution",
  "discovery",
  "error",
  "debate",
  "market_creation",
  "runtime",
  "defi_signal",
  "defi_swap",
];

const RUNTIME_STATUS: ChildServerStatus[] = ["starting", "running", "stopping", "dead"];

const CONSENSUS_GUARDRAILS: ConsensusGuardrailReason[] = [
  "insufficient_peer_count",
  "insufficient_peer_weight",
  "delta_clamped",
];

export interface AgentMetricsSnapshot {
  generatedAt: number;
  uptimeSeconds: number;
  loop: Pick<
    LoopStatus,
    | "isRunning"
    | "tickCount"
    | "lastTickAt"
    | "activeAgentCount"
    | "intervalMs"
    | "onChainEnabled"
    | "aiEnabled"
    | "signerMode"
  >;
  actions: {
    windowSize: number;
    byType: Record<AgentAction["type"], number>;
    errorRate: number;
  };
  consensus: {
    sampleCount: number;
    appliedCount: number;
    blockedCount: number;
    guardrailCounts: Record<ConsensusGuardrailReason, number>;
    avgPeerCount: number;
    avgPeerWeight: number;
    avgAbsDeltaPct: number;
    autotuneSampleCount: number;
    avgAutotuneDrift: number;
    avgAutotuneNormalizedDrift: number;
  };
  runtime: {
    childAgents: number;
    activeRuntimes: number;
    byStatus: Record<ChildServerStatus, number>;
    events: {
      provisioned: number;
      heartbeatRecovered: number;
      failedOver: number;
      terminated: number;
      heartbeatError: number;
    };
    maxFailoverCount: number;
    quarantinedRegionCount: number;
    quarantinedRegions: Array<{
      region: string;
      latestFailedAt: number;
      activeUntil: number;
      remainingSecs: number;
      impactedAgents: number;
    }>;
  };
}

function toFixedNumber(value: number, digits = 4): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(digits));
}

export function computeAgentMetrics(args: {
  loopStatus: LoopStatus;
  actions: AgentAction[];
  spawnedAgents: SpawnedAgent[];
  quarantineSecs: number;
  nowMs?: number;
}): AgentMetricsSnapshot {
  const now = args.nowMs ?? Date.now();
  const actions = (Array.isArray(args.actions) ? args.actions : []).slice(-MAX_WINDOW_ACTIONS);

  const actionCounts = ACTION_TYPES.reduce(
    (acc, type) => {
      acc[type] = 0;
      return acc;
    },
    {} as Record<AgentAction["type"], number>
  );
  for (const action of actions) {
    actionCounts[action.type] += 1;
  }
  const actionWindow = actions.length;
  const errorRate = actionWindow > 0 ? actionCounts.error / actionWindow : 0;

  const consensusEvents = actions
    .map((action) => action.consensusMeta)
    .filter((meta): meta is NonNullable<AgentAction["consensusMeta"]> => !!meta);
  const guardrailCounts = CONSENSUS_GUARDRAILS.reduce(
    (acc, reason) => {
      acc[reason] = 0;
      return acc;
    },
    {} as Record<ConsensusGuardrailReason, number>
  );
  let consensusPeerCountTotal = 0;
  let consensusPeerWeightTotal = 0;
  let consensusAbsDeltaTotal = 0;
  let consensusAppliedCount = 0;
  let autotuneSampleCount = 0;
  let autotuneDriftTotal = 0;
  let autotuneNormalizedDriftTotal = 0;
  for (const meta of consensusEvents) {
    if (meta.applied) consensusAppliedCount += 1;
    if (meta.guardrailReason) {
      guardrailCounts[meta.guardrailReason] += 1;
    }
    consensusPeerCountTotal += meta.peerCount;
    consensusPeerWeightTotal += meta.peerWeightTotal;
    consensusAbsDeltaTotal += Math.abs(meta.deltaFromLead);
    if (meta.autotune?.enabled) {
      autotuneSampleCount += 1;
      autotuneDriftTotal += meta.autotune.drift;
      autotuneNormalizedDriftTotal += meta.autotune.normalizedDrift;
    }
  }
  const consensusSampleCount = consensusEvents.length;

  const runtimeByStatus = RUNTIME_STATUS.reduce(
    (acc, status) => {
      acc[status] = 0;
      return acc;
    },
    {} as Record<ChildServerStatus, number>
  );

  const childAgents = args.spawnedAgents.filter((agent) => !agent.isBuiltIn);
  const runtimes = childAgents
    .map((agent) => agent.runtime)
    .filter((runtime): runtime is NonNullable<SpawnedAgent["runtime"]> => !!runtime);
  for (const runtime of runtimes) {
    runtimeByStatus[runtime.status] += 1;
  }

  const runtimeEvents = {
    provisioned: 0,
    heartbeatRecovered: 0,
    failedOver: 0,
    terminated: 0,
    heartbeatError: 0,
  };
  for (const action of actions) {
    const meta = action.runtimeMeta;
    if (!meta) continue;
    if (meta.event === "provisioned") runtimeEvents.provisioned += 1;
    if (meta.event === "heartbeat_recovered") runtimeEvents.heartbeatRecovered += 1;
    if (meta.event === "failed_over") runtimeEvents.failedOver += 1;
    if (meta.event === "terminated") runtimeEvents.terminated += 1;
    if (meta.event === "heartbeat_error") runtimeEvents.heartbeatError += 1;
  }

  const quarantineMs = Math.max(0, args.quarantineSecs) * 1000;
  const quarantineByRegion = new Map<
    string,
    { latestFailedAt: number; impactedAgents: Set<string> }
  >();
  let maxFailoverCount = 0;
  for (const agent of childAgents) {
    const runtime = agent.runtime;
    if (!runtime) continue;

    maxFailoverCount = Math.max(maxFailoverCount, runtime.failoverCount ?? 0);

    for (const entry of runtime.regionFailureLog ?? []) {
      if (!entry?.region || !Number.isFinite(entry.failedAt)) continue;
      if (quarantineMs > 0 && now - entry.failedAt >= quarantineMs) continue;

      const region = entry.region.trim().toLowerCase();
      if (!region) continue;

      const prev = quarantineByRegion.get(region);
      if (prev) {
        prev.latestFailedAt = Math.max(prev.latestFailedAt, entry.failedAt);
        prev.impactedAgents.add(agent.id);
      } else {
        quarantineByRegion.set(region, {
          latestFailedAt: entry.failedAt,
          impactedAgents: new Set([agent.id]),
        });
      }
    }
  }

  const quarantinedRegions = Array.from(quarantineByRegion.entries())
    .map(([region, value]) => {
      const activeUntil = value.latestFailedAt + quarantineMs;
      return {
        region,
        latestFailedAt: value.latestFailedAt,
        activeUntil,
        remainingSecs: Math.max(0, Math.ceil((activeUntil - now) / 1000)),
        impactedAgents: value.impactedAgents.size,
      };
    })
    .sort((a, b) => b.latestFailedAt - a.latestFailedAt);

  return {
    generatedAt: now,
    uptimeSeconds: Math.max(0, Math.floor((now - PROCESS_STARTED_AT) / 1000)),
    loop: {
      isRunning: args.loopStatus.isRunning,
      tickCount: args.loopStatus.tickCount,
      lastTickAt: args.loopStatus.lastTickAt,
      activeAgentCount: args.loopStatus.activeAgentCount,
      intervalMs: args.loopStatus.intervalMs,
      onChainEnabled: args.loopStatus.onChainEnabled,
      aiEnabled: args.loopStatus.aiEnabled,
      signerMode: args.loopStatus.signerMode,
    },
    actions: {
      windowSize: actionWindow,
      byType: actionCounts,
      errorRate: toFixedNumber(errorRate),
    },
    consensus: {
      sampleCount: consensusSampleCount,
      appliedCount: consensusAppliedCount,
      blockedCount: Math.max(0, consensusSampleCount - consensusAppliedCount),
      guardrailCounts,
      avgPeerCount: toFixedNumber(
        consensusSampleCount > 0 ? consensusPeerCountTotal / consensusSampleCount : 0
      ),
      avgPeerWeight: toFixedNumber(
        consensusSampleCount > 0 ? consensusPeerWeightTotal / consensusSampleCount : 0
      ),
      avgAbsDeltaPct: toFixedNumber(
        consensusSampleCount > 0
          ? (consensusAbsDeltaTotal / consensusSampleCount) * 100
          : 0
      ),
      autotuneSampleCount,
      avgAutotuneDrift: toFixedNumber(
        autotuneSampleCount > 0 ? autotuneDriftTotal / autotuneSampleCount : 0
      ),
      avgAutotuneNormalizedDrift: toFixedNumber(
        autotuneSampleCount > 0
          ? autotuneNormalizedDriftTotal / autotuneSampleCount
          : 0
      ),
    },
    runtime: {
      childAgents: childAgents.length,
      activeRuntimes: runtimes.length,
      byStatus: runtimeByStatus,
      events: runtimeEvents,
      maxFailoverCount,
      quarantinedRegionCount: quarantinedRegions.length,
      quarantinedRegions,
    },
  };
}

export function getAgentMetricsSnapshot(args?: {
  actionLimit?: number;
  nowMs?: number;
}): AgentMetricsSnapshot {
  const actionLimit = Math.max(1, Math.min(args?.actionLimit ?? 200, MAX_WINDOW_ACTIONS));
  return computeAgentMetrics({
    loopStatus: agentLoop.getStatus(),
    actions: agentLoop.getActionLog(actionLimit),
    spawnedAgents: agentSpawner.list(),
    quarantineSecs: config.childServerRegionQuarantineSecs,
    nowMs: args?.nowMs,
  });
}

export function formatMetricsPrometheus(
  snapshot: AgentMetricsSnapshot
): string {
  const lines: string[] = [];
  const push = (line: string) => lines.push(line);

  push("# TYPE prediction_agent_uptime_seconds gauge");
  push(`prediction_agent_uptime_seconds ${snapshot.uptimeSeconds}`);
  push("# TYPE prediction_agent_loop_tick_count gauge");
  push(`prediction_agent_loop_tick_count ${snapshot.loop.tickCount}`);
  push("# TYPE prediction_agent_actions_window gauge");
  push(`prediction_agent_actions_window ${snapshot.actions.windowSize}`);
  push("# TYPE prediction_agent_actions_by_type gauge");
  for (const type of ACTION_TYPES) {
    push(`prediction_agent_actions_by_type{type="${type}"} ${snapshot.actions.byType[type]}`);
  }
  push("# TYPE prediction_agent_actions_error_rate gauge");
  push(`prediction_agent_actions_error_rate ${snapshot.actions.errorRate}`);

  push("# TYPE prediction_agent_consensus_samples gauge");
  push(`prediction_agent_consensus_samples ${snapshot.consensus.sampleCount}`);
  push("# TYPE prediction_agent_consensus_applied gauge");
  push(`prediction_agent_consensus_applied ${snapshot.consensus.appliedCount}`);
  push("# TYPE prediction_agent_consensus_guardrail gauge");
  for (const reason of CONSENSUS_GUARDRAILS) {
    push(
      `prediction_agent_consensus_guardrail{reason="${reason}"} ${snapshot.consensus.guardrailCounts[reason]}`
    );
  }
  push("# TYPE prediction_agent_consensus_avg_abs_delta_pct gauge");
  push(`prediction_agent_consensus_avg_abs_delta_pct ${snapshot.consensus.avgAbsDeltaPct}`);
  push("# TYPE prediction_agent_consensus_autotune_samples gauge");
  push(
    `prediction_agent_consensus_autotune_samples ${snapshot.consensus.autotuneSampleCount}`
  );
  push("# TYPE prediction_agent_consensus_autotune_avg_drift gauge");
  push(
    `prediction_agent_consensus_autotune_avg_drift ${snapshot.consensus.avgAutotuneDrift}`
  );
  push("# TYPE prediction_agent_consensus_autotune_avg_normalized_drift gauge");
  push(
    `prediction_agent_consensus_autotune_avg_normalized_drift ${snapshot.consensus.avgAutotuneNormalizedDrift}`
  );

  push("# TYPE prediction_agent_runtime_runtimes gauge");
  push(`prediction_agent_runtime_runtimes ${snapshot.runtime.activeRuntimes}`);
  push("# TYPE prediction_agent_runtime_by_status gauge");
  for (const status of RUNTIME_STATUS) {
    push(`prediction_agent_runtime_by_status{status="${status}"} ${snapshot.runtime.byStatus[status]}`);
  }
  push("# TYPE prediction_agent_runtime_events gauge");
  push(
    `prediction_agent_runtime_events{event="provisioned"} ${snapshot.runtime.events.provisioned}`
  );
  push(
    `prediction_agent_runtime_events{event="heartbeat_recovered"} ${snapshot.runtime.events.heartbeatRecovered}`
  );
  push(
    `prediction_agent_runtime_events{event="failed_over"} ${snapshot.runtime.events.failedOver}`
  );
  push(
    `prediction_agent_runtime_events{event="terminated"} ${snapshot.runtime.events.terminated}`
  );
  push(
    `prediction_agent_runtime_events{event="heartbeat_error"} ${snapshot.runtime.events.heartbeatError}`
  );
  push("# TYPE prediction_agent_runtime_quarantined_regions gauge");
  push(
    `prediction_agent_runtime_quarantined_regions ${snapshot.runtime.quarantinedRegionCount}`
  );

  return `${lines.join("\n")}\n`;
}
