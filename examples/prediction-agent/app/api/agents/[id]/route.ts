import { NextRequest } from "next/server";
import { z } from "zod";
import { agentSpawner, serializeAgent } from "@/lib/agent-spawner";
import { requireRole } from "@/lib/require-auth";
import { recordAudit } from "@/lib/ops-store";

const AgentActionSchema = z.object({
  action: z.enum(["stop", "pause", "resume"]),
});

/**
 * Single Agent endpoint.
 * GET: Agent detail.
 * POST: Control agent (stop/pause/resume).
 * DELETE: Remove agent.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!requireRole(request, "viewer")) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const agent = agentSpawner.getAgent(id);

  if (!agent) {
    return Response.json({ error: "Agent not found" }, { status: 404 });
  }

  return Response.json({ agent: serializeAgent(agent) });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const context = requireRole(request, "admin");
  if (!context) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = AgentActionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues.map((issue) => issue.message) },
      { status: 400 }
    );
  }
  const action = parsed.data.action;

  const agent = agentSpawner.getAgent(id);
  if (!agent) {
    return Response.json({ error: "Agent not found" }, { status: 404 });
  }

  switch (action) {
    case "stop":
      agentSpawner.stop(id);
      break;
    case "pause":
      agentSpawner.pause(id);
      break;
    case "resume":
      agentSpawner.resume(id);
      break;
    default:
      return Response.json(
        { error: "Invalid action. Use 'stop', 'pause', or 'resume'." },
        { status: 400 }
      );
  }

  await recordAudit({
    organizationId: context.membership.organizationId,
    userId: context.user.id,
    action: `agent.${action}`,
    targetType: "agent",
    targetId: id,
    metadata: {
      status: agentSpawner.getAgent(id)?.status ?? null,
    },
  });

  return Response.json({
    ok: true,
    agent: serializeAgent(agentSpawner.getAgent(id)!),
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const context = requireRole(request, "admin");
  if (!context) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const agent = agentSpawner.getAgent(id);

  if (!agent) {
    return Response.json({ error: "Agent not found" }, { status: 404 });
  }

  agentSpawner.remove(id);
  await recordAudit({
    organizationId: context.membership.organizationId,
    userId: context.user.id,
    action: "agent.remove",
    targetType: "agent",
    targetId: id,
    metadata: { name: agent.name },
  });
  return Response.json({ ok: true, message: `Agent "${agent.name}" removed` });
}
