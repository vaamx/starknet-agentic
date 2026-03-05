import { NextRequest } from "next/server";
import { z } from "zod";
import { agentLoop } from "@/lib/agent-loop";
import { requireRole } from "@/lib/require-auth";
import { recordAudit } from "@/lib/ops-store";
import { checkRateLimit } from "@/lib/rate-limit";

const AgentLoopActionSchema = z.object({
  action: z.enum(["start", "stop"]),
  intervalMs: z.number().int().min(5_000).max(3_600_000).optional(),
});

/**
 * Agent Loop control endpoint.
 * POST: Start/stop the autonomous loop.
 * GET: Current loop status + recent action log.
 */
export async function POST(request: NextRequest) {
  const context = requireRole(request, "admin");
  if (!context) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const rateLimit = checkRateLimit(
    `agent_loop:${context.membership.organizationId}:${context.user.id}`,
    {
      windowMs: 60_000,
      max: 20,
      blockMs: 60_000,
    }
  );
  if (!rateLimit.allowed) {
    return Response.json(
      { error: "Rate limit exceeded for agent-loop control actions" },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(rateLimit.retryAfterMs / 1000)),
        },
      }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = AgentLoopActionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues }, { status: 400 });
  }
  const { action, intervalMs } = parsed.data;

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

  return Response.json({ error: "Invalid action. Use 'start' or 'stop'." }, { status: 400 });
}

export async function GET(request: NextRequest) {
  const context = requireRole(request, "viewer");
  if (!context) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const status = agentLoop.getStatus();
  const actions = agentLoop.getActionLog(50);
  return Response.json({ status, actions });
}
