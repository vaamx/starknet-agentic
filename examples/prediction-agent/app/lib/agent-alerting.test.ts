import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  evaluateAndDispatchMetricAlerts,
  evaluateMetricsAlertRules,
  resetAgentAlertState,
  type AgentAlertPolicy,
} from "./agent-alerting";
import type { AgentMetricsSnapshot } from "./agent-metrics";

function makeSnapshot(overrides?: Partial<AgentMetricsSnapshot>): AgentMetricsSnapshot {
  return {
    generatedAt: 1700000000000,
    uptimeSeconds: 100,
    loop: {
      isRunning: true,
      tickCount: 10,
      lastTickAt: 1700000000000,
      activeAgentCount: 5,
      intervalMs: 60000,
      onChainEnabled: true,
      aiEnabled: true,
      signerMode: "owner",
    },
    actions: {
      windowSize: 200,
      byType: {
        research: 80,
        prediction: 40,
        bet: 20,
        discovery: 5,
        error: 10,
        debate: 10,
        market_creation: 3,
        runtime: 20,
        defi_signal: 6,
        defi_swap: 6,
      },
      errorRate: 0.05,
    },
    consensus: {
      sampleCount: 60,
      appliedCount: 52,
      blockedCount: 8,
      guardrailCounts: {
        insufficient_peer_count: 3,
        insufficient_peer_weight: 2,
        delta_clamped: 3,
      },
      avgPeerCount: 4,
      avgPeerWeight: 9.4,
      avgAbsDeltaPct: 4.2,
      autotuneSampleCount: 60,
      avgAutotuneDrift: 0.03,
      avgAutotuneNormalizedDrift: 0.45,
    },
    runtime: {
      childAgents: 2,
      activeRuntimes: 2,
      byStatus: {
        starting: 0,
        running: 2,
        stopping: 0,
        dead: 0,
      },
      events: {
        provisioned: 2,
        heartbeatRecovered: 4,
        failedOver: 1,
        terminated: 0,
        heartbeatError: 1,
      },
      maxFailoverCount: 1,
      quarantinedRegionCount: 1,
      quarantinedRegions: [
        {
          region: "sfo",
          latestFailedAt: 1700000000000,
          activeUntil: 1700000060000,
          remainingSecs: 60,
          impactedAgents: 1,
        },
      ],
    },
    ...(overrides ?? {}),
  };
}

function makePolicy(overrides?: Partial<AgentAlertPolicy>): AgentAlertPolicy {
  return {
    enabled: true,
    cooldownSecs: 600,
    actionWindow: 200,
    minConsensusSamples: 10,
    errorRateThreshold: 0.2,
    consensusBlockRateThreshold: 0.3,
    consensusClampRateThreshold: 0.3,
    failoverEventsThreshold: 3,
    heartbeatErrorsThreshold: 3,
    quarantinedRegionsThreshold: 2,
    requestTimeoutMs: 1000,
    ...(overrides ?? {}),
  };
}

describe("agent-alerting", () => {
  beforeEach(() => {
    resetAgentAlertState();
  });

  it("evaluates threshold breaches from metrics", () => {
    const snapshot = makeSnapshot({
      actions: {
        ...makeSnapshot().actions,
        errorRate: 0.4,
      },
      consensus: {
        ...makeSnapshot().consensus,
        sampleCount: 20,
        blockedCount: 12,
        guardrailCounts: {
          insufficient_peer_count: 2,
          insufficient_peer_weight: 1,
          delta_clamped: 10,
        },
      },
      runtime: {
        ...makeSnapshot().runtime,
        events: {
          ...makeSnapshot().runtime.events,
          failedOver: 4,
          heartbeatError: 5,
        },
        quarantinedRegionCount: 3,
      },
    });

    const rules = evaluateMetricsAlertRules({
      snapshot,
      policy: makePolicy(),
    });

    const triggeredKeys = rules.filter((rule) => rule.triggered).map((r) => r.key);
    expect(triggeredKeys).toContain("error_rate_high");
    expect(triggeredKeys).toContain("consensus_block_rate_high");
    expect(triggeredKeys).toContain("consensus_clamp_rate_high");
    expect(triggeredKeys).toContain("runtime_failovers_spike");
    expect(triggeredKeys).toContain("runtime_heartbeat_errors_spike");
    expect(triggeredKeys).toContain("runtime_quarantine_pressure");
  });

  it("applies cooldown and emits resolve notifications", async () => {
    const sendJson = vi.fn(async () => undefined);
    const channels = { webhookUrl: "https://example.com/webhook" };
    const policy = makePolicy({
      errorRateThreshold: 0.2,
      consensusBlockRateThreshold: 1,
      consensusClampRateThreshold: 1,
      failoverEventsThreshold: 999,
      heartbeatErrorsThreshold: 999,
      quarantinedRegionsThreshold: 999,
    });

    const highErrorSnapshot = makeSnapshot({
      actions: {
        ...makeSnapshot().actions,
        errorRate: 0.4,
      },
    });

    const first = await evaluateAndDispatchMetricAlerts({
      snapshot: highErrorSnapshot,
      source: "test",
      nowMs: 1000,
      policy,
      channels,
      sendJson,
    });
    expect(first.triggered).toBe(1);
    expect(first.resolved).toBe(0);
    expect(sendJson).toHaveBeenCalledTimes(1);

    const second = await evaluateAndDispatchMetricAlerts({
      snapshot: highErrorSnapshot,
      source: "test",
      nowMs: 1200,
      policy,
      channels,
      sendJson,
    });
    expect(second.triggered).toBe(0);
    expect(second.resolved).toBe(0);
    expect(sendJson).toHaveBeenCalledTimes(1);

    const recovered = await evaluateAndDispatchMetricAlerts({
      snapshot: makeSnapshot({
        actions: {
          ...makeSnapshot().actions,
          errorRate: 0.05,
        },
      }),
      source: "test",
      nowMs: 1300,
      policy,
      channels,
      sendJson,
    });
    expect(recovered.triggered).toBe(0);
    expect(recovered.resolved).toBe(1);
    expect(sendJson).toHaveBeenCalledTimes(2);
  });

  it("routes warning vs critical severity to configured channels", async () => {
    const sendJson = vi.fn(async () => undefined);
    const policy = makePolicy({
      errorRateThreshold: 0.2,
      consensusBlockRateThreshold: 1,
      consensusClampRateThreshold: 1,
      failoverEventsThreshold: 999,
      heartbeatErrorsThreshold: 999,
      quarantinedRegionsThreshold: 999,
    });

    const channels = {
      webhookUrl: "https://example.com/webhook",
      slackWebhookUrl: "https://example.com/slack",
      pagerDutyRoutingKey: "pd-key",
      webhookMinSeverity: "info" as const,
      slackMinSeverity: "warning" as const,
      pagerDutyMinSeverity: "critical" as const,
    };

    // Warning-only trigger (0.25 < 1.5 * 0.2 => warning).
    const warning = await evaluateAndDispatchMetricAlerts({
      snapshot: makeSnapshot({
        actions: {
          ...makeSnapshot().actions,
          errorRate: 0.25,
        },
      }),
      source: "test-routing",
      nowMs: 5000,
      policy,
      channels,
      sendJson,
    });
    expect(warning.triggered).toBe(1);
    // webhook + slack, but not pagerduty
    expect(sendJson).toHaveBeenCalledTimes(2);

    // Reset runtime state to re-trigger cleanly.
    resetAgentAlertState();
    sendJson.mockClear();

    // Critical trigger (0.5 >= 1.5 * 0.2 => critical).
    const critical = await evaluateAndDispatchMetricAlerts({
      snapshot: makeSnapshot({
        actions: {
          ...makeSnapshot().actions,
          errorRate: 0.5,
        },
      }),
      source: "test-routing",
      nowMs: 7000,
      policy,
      channels,
      sendJson,
    });
    expect(critical.triggered).toBe(1);
    // webhook + slack + pagerduty
    expect(sendJson).toHaveBeenCalledTimes(3);
  });
});
