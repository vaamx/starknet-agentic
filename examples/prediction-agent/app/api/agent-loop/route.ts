import { NextRequest } from "next/server";
import { agentLoop } from "@/lib/agent-loop";
import { requireRole } from "@/lib/require-auth";
import { recordAudit } from "@/lib/ops-store";

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

  const body = await request.json();
  const action = body.action as string;
  const intervalMs = body.intervalMs as number | undefined;

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
