import { NextRequest } from "next/server";
import { agentLoop } from "@/lib/agent-loop";
import { z } from "zod";
import { config } from "@/lib/config";
import { enforceRateLimit, getRequestSecret, jsonError } from "@/lib/api-guard";
import { ensureAgentSpawnerHydrated } from "@/lib/agent-persistence";
import { evaluateAndDispatchMetricAlerts } from "@/lib/agent-alerting";

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

  if (
    config.HEARTBEAT_SECRET &&
    (action === "start" || action === "stop")
  ) {
    const provided = getRequestSecret(request);
    if (provided !== config.HEARTBEAT_SECRET) {
      return jsonError("Unauthorized", 401);
    }
  }

  if (action === "tick") {
    // Client-driven tick: run one agent on one market and return results
    try {
      const actions = await agentLoop.singleTick();
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
      return jsonError("Tick failed", 500, err?.message ?? String(err));
    }
  }

  if (action === "start") {
    agentLoop.start(intervalMs);
    return Response.json({
      ok: true,
      message: "Agent loop started",
      status: agentLoop.getStatus(),
    });
  }

  if (action === "stop") {
    agentLoop.stop();
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
    const status = agentLoop.getStatus();
    const actions = agentLoop.getActionLog(50);
    return Response.json({ status, actions });
  } catch (err: any) {
    return jsonError("Failed to fetch loop status", 500, err?.message ?? String(err));
  }
}
