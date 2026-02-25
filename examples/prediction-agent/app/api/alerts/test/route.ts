import { NextRequest } from "next/server";
import { z } from "zod";
import { config } from "@/lib/config";
import { enforceRateLimit, getRequestSecret, jsonError } from "@/lib/api-guard";
import {
  evaluateAndDispatchMetricAlerts,
  type AgentAlertSeverity,
} from "@/lib/agent-alerting";
import type { AgentMetricsSnapshot } from "@/lib/agent-metrics";

export const maxDuration = 60;

const requestSchema = z.object({
  mode: z.enum(["trigger", "resolve", "roundtrip"]).default("roundtrip"),
  severity: z.enum(["warning", "critical"]).default("warning"),
  dryRun: z.boolean().default(true),
  source: z.string().trim().min(1).max(64).optional(),
  secret: z.string().optional(),
});

function buildTriggeredSnapshot(args: {
  nowMs: number;
  severity: AgentAlertSeverity;
}): AgentMetricsSnapshot {
  const errorRate = args.severity === "critical" ? 0.5 : 0.4;

  return {
    generatedAt: args.nowMs,
    uptimeSeconds: 1,
    loop: {
      isRunning: true,
      tickCount: 1,
      lastTickAt: args.nowMs,
      activeAgentCount: 5,
      intervalMs: 60000,
      onChainEnabled: true,
      aiEnabled: true,
      signerMode: "owner",
    },
    actions: {
      windowSize: 200,
      byType: {
        research: 90,
        prediction: 40,
        bet: 20,
        discovery: 0,
        error: Math.round(errorRate * 200),
        debate: 10,
        market_creation: 0,
        runtime: 20,
        defi_signal: 10,
        defi_swap: 10,
      },
      errorRate,
    },
    consensus: {
      sampleCount: 0,
      appliedCount: 0,
      blockedCount: 0,
      guardrailCounts: {
        insufficient_peer_count: 0,
        insufficient_peer_weight: 0,
        delta_clamped: 0,
      },
      avgPeerCount: 0,
      avgPeerWeight: 0,
      avgAbsDeltaPct: 0,
      autotuneSampleCount: 0,
      avgAutotuneDrift: 0,
      avgAutotuneNormalizedDrift: 0,
    },
    runtime: {
      childAgents: 0,
      activeRuntimes: 0,
      byStatus: {
        starting: 0,
        running: 0,
        stopping: 0,
        dead: 0,
      },
      events: {
        provisioned: 0,
        heartbeatRecovered: 0,
        failedOver: 0,
        terminated: 0,
        heartbeatError: 0,
      },
      maxFailoverCount: 0,
      quarantinedRegionCount: 0,
      quarantinedRegions: [],
    },
  };
}

function buildResolvedSnapshot(nowMs: number): AgentMetricsSnapshot {
  return {
    generatedAt: nowMs,
    uptimeSeconds: 1,
    loop: {
      isRunning: true,
      tickCount: 1,
      lastTickAt: nowMs,
      activeAgentCount: 5,
      intervalMs: 60000,
      onChainEnabled: true,
      aiEnabled: true,
      signerMode: "owner",
    },
    actions: {
      windowSize: 200,
      byType: {
        research: 100,
        prediction: 40,
        bet: 20,
        discovery: 0,
        error: 0,
        debate: 10,
        market_creation: 0,
        runtime: 20,
        defi_signal: 5,
        defi_swap: 5,
      },
      errorRate: 0,
    },
    consensus: {
      sampleCount: 0,
      appliedCount: 0,
      blockedCount: 0,
      guardrailCounts: {
        insufficient_peer_count: 0,
        insufficient_peer_weight: 0,
        delta_clamped: 0,
      },
      avgPeerCount: 0,
      avgPeerWeight: 0,
      avgAbsDeltaPct: 0,
      autotuneSampleCount: 0,
      avgAutotuneDrift: 0,
      avgAutotuneNormalizedDrift: 0,
    },
    runtime: {
      childAgents: 0,
      activeRuntimes: 0,
      byStatus: {
        starting: 0,
        running: 0,
        stopping: 0,
        dead: 0,
      },
      events: {
        provisioned: 0,
        heartbeatRecovered: 0,
        failedOver: 0,
        terminated: 0,
        heartbeatError: 0,
      },
      maxFailoverCount: 0,
      quarantinedRegionCount: 0,
      quarantinedRegions: [],
    },
  };
}

function simulationPolicyForSeverity(severity: AgentAlertSeverity) {
  return {
    enabled: true,
    // Force simulation to focus on error-rate alert only.
    errorRateThreshold: severity === "critical" ? 0.2 : 0.35,
    consensusBlockRateThreshold: 1,
    consensusClampRateThreshold: 1,
    failoverEventsThreshold: 99999,
    heartbeatErrorsThreshold: 99999,
    quarantinedRegionsThreshold: 99999,
    minConsensusSamples: 1000,
  };
}

export async function POST(request: NextRequest) {
  const rateLimited = await enforceRateLimit(request, "alerts_test", {
    windowMs: 60_000,
    maxRequests: 8,
  });
  if (rateLimited) return rateLimited;

  let payload: z.infer<typeof requestSchema>;
  try {
    payload = requestSchema.parse(await request.json());
  } catch (err: any) {
    return jsonError("Invalid request body", 400, err?.issues ?? err?.message);
  }

  if (!config.agentAlertTestSecret) {
    return jsonError(
      "Alert test secret not configured. Set AGENT_ALERT_TEST_SECRET (or HEARTBEAT_SECRET).",
      503
    );
  }

  const provided = getRequestSecret(request) ?? payload.secret ?? null;
  if (provided !== config.agentAlertTestSecret) {
    return jsonError("Unauthorized", 401);
  }

  const source = payload.source ?? "alerts-test";
  const now = Date.now();
  const policy = simulationPolicyForSeverity(payload.severity);
  const sendJson = payload.dryRun
    ? (async () => undefined)
    : undefined;

  const results: Array<
    Awaited<ReturnType<typeof evaluateAndDispatchMetricAlerts>>
  > = [];

  if (payload.mode === "trigger" || payload.mode === "roundtrip") {
    results.push(
      await evaluateAndDispatchMetricAlerts({
        source,
        snapshot: buildTriggeredSnapshot({
          nowMs: now,
          severity: payload.severity,
        }),
        nowMs: now,
        policy,
        sendJson,
      })
    );
  }

  if (payload.mode === "resolve" || payload.mode === "roundtrip") {
    results.push(
      await evaluateAndDispatchMetricAlerts({
        source,
        snapshot: buildResolvedSnapshot(now + 1000),
        nowMs: now + 1000,
        policy,
        sendJson,
      })
    );
  }

  const summary = results.reduce(
    (acc, r) => {
      acc.sent += r.sent;
      acc.failed += r.failed;
      acc.triggered += r.triggered;
      acc.resolved += r.resolved;
      acc.errors.push(...r.errors);
      acc.events.push(...r.events);
      return acc;
    },
    {
      sent: 0,
      failed: 0,
      triggered: 0,
      resolved: 0,
      errors: [] as string[],
      events: [] as Array<{
        key: string;
        status: string;
        severity: string;
        title: string;
        message: string;
      }>,
    }
  );

  return Response.json({
    ok: true,
    mode: payload.mode,
    severity: payload.severity,
    dryRun: payload.dryRun,
    source,
    summary,
  });
}
