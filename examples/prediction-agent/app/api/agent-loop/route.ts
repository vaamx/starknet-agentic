import { NextRequest } from "next/server";
import { z } from "zod";
import { agentLoop } from "@/lib/agent-loop";
import { z } from "zod";
import { config } from "@/lib/config";
import { enforceRateLimit, getRequestSecret, jsonError } from "@/lib/api-guard";
import { ensureAgentSpawnerHydrated } from "@/lib/agent-persistence";
import { evaluateAndDispatchMetricAlerts } from "@/lib/agent-alerting";
import {
  getPersistedLoopActions,
  getPersistedLoopRuntime,
} from "@/lib/state-store";
import { requireWalletSessionScope } from "@/lib/wallet-session";

export const runtime = "nodejs";

/**
 * Agent Loop control endpoint.
 * POST: Start/stop the autonomous loop, or trigger a single tick.
 * GET: Current loop status + recent action log.
 *
 * On Vercel serverless, use action="tick" from client-driven polling
 * instead of action="start" (which requires a long-lived process).
 */
export const maxDuration = 60;
const actionSchema = z.object({
  action: z.enum(["tick", "start", "stop"]),
  intervalMs: z.number().int().min(5000).max(3_600_000).optional(),
});

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(label)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function POST(request: NextRequest) {
  await ensureAgentSpawnerHydrated();
  const rateLimited = await enforceRateLimit(request, "agent_loop_control", {
    windowMs: 60_000,
    maxRequests: 90,
  });
  if (rateLimited) return rateLimited;

  let payload: z.infer<typeof actionSchema>;
  try {
    payload = actionSchema.parse(await request.json());
  } catch (err: any) {
    return jsonError("Invalid request body", 400, err?.issues ?? err?.message);
  }

  const { action, intervalMs } = payload;

  const hasHeartbeatSecret =
    !!config.HEARTBEAT_SECRET &&
    getRequestSecret(request) === config.HEARTBEAT_SECRET;
  if (!hasHeartbeatSecret) {
    const auth = requireWalletSessionScope(request, "tick");
    if (!auth.ok) return auth.response;
  }

  if (action === "tick") {
    // Client-driven tick: run one agent on one market and return results
    try {
      const persistedRuntime = await getPersistedLoopRuntime();
      agentLoop.hydrateRuntime(persistedRuntime);
      const actions = await withTimeout(
        agentLoop.singleTick(),
        config.agentLoopTickTimeoutMs,
        `Tick timed out after ${config.agentLoopTickTimeoutMs}ms`
      );
      let alerts:
        | Awaited<ReturnType<typeof evaluateAndDispatchMetricAlerts>>
        | undefined;
      try {
        alerts = await evaluateAndDispatchMetricAlerts({
          source: "agent-loop",
        });
      } catch (alertErr: any) {
        console.error(
          "[agent-loop] alert dispatch failed:",
          alertErr?.message ?? String(alertErr)
        );
      }
      return Response.json({
        ok: true,
        message: "Tick completed",
        actions,
        status: agentLoop.getStatus(),
        alerts: alerts
          ? {
              enabled: alerts.enabled,
              sent: alerts.sent,
              failed: alerts.failed,
              triggered: alerts.triggered,
              resolved: alerts.resolved,
            }
          : undefined,
      });
    } catch (err: any) {
      const message = err?.message ?? String(err);
      if (/timed out/i.test(message)) {
        const persistedActions = await getPersistedLoopActions(20);
        return Response.json({
          ok: true,
          partial: true,
          timeout: true,
          message:
            `${message}. Returning latest persisted actions while tick continues.`,
          status: agentLoop.getStatus(),
          actions: persistedActions,
        });
      }
      return jsonError("Tick failed", 500, err?.message ?? String(err));
    }
  }

  if (action === "start") {
    agentLoop.start(intervalMs);
    await recordAudit({
      organizationId: context.membership.organizationId,
      userId: context.user.id,
      action: "agent_loop.start",
      targetType: "system",
      metadata: { intervalMs: intervalMs ?? null },
    });
    return Response.json({
      ok: true,
      message: "Agent loop started",
      status: agentLoop.getStatus(),
    });
  }

  if (action === "stop") {
    agentLoop.stop();
    await recordAudit({
      organizationId: context.membership.organizationId,
      userId: context.user.id,
      action: "agent_loop.stop",
      targetType: "system",
    });
    return Response.json({
      ok: true,
      message: "Agent loop stopped",
      status: agentLoop.getStatus(),
    });
  }

  return jsonError("Invalid action. Use 'tick', 'start', or 'stop'.", 400);
}

export async function GET() {
  await ensureAgentSpawnerHydrated();
  try {
    const inMemoryStatus = agentLoop.getStatus();
    const persistedRuntime = await getPersistedLoopRuntime();
    const status =
      persistedRuntime &&
      !inMemoryStatus.lastTickAt &&
      inMemoryStatus.tickCount === 0
        ? {
            ...inMemoryStatus,
            tickCount: persistedRuntime.tickCount,
            lastTickAt: persistedRuntime.lastTickAt,
            intervalMs: persistedRuntime.intervalMs,
          }
        : inMemoryStatus;

    const [inMemoryActions, persistedActions] = await Promise.all([
      Promise.resolve(agentLoop.getActionLog(50)),
      getPersistedLoopActions(50),
    ]);
    const dedupedById = new Map<string, any>();
    for (const action of [...persistedActions, ...inMemoryActions]) {
      dedupedById.set(action.id, action);
    }
    const actions = Array.from(dedupedById.values())
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-50);
    return Response.json({ status, actions });
  } catch (err: any) {
    return jsonError("Failed to fetch loop status", 500, err?.message ?? String(err));
  }
}
