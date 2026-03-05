import { NextRequest } from "next/server";
import { z } from "zod";
import {
  agentSpawner,
  serializeAgent,
  type SpawnAgentConfig,
} from "@/lib/agent-spawner";
import { requireRole } from "@/lib/require-auth";
import { recordAudit } from "@/lib/ops-store";

const SpawnAgentSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  personaId: z.string().trim().min(1).max(64).optional(),
  systemPrompt: z.string().max(8_000).optional(),
  budgetStrk: z.coerce.number().positive().max(1_000_000).optional(),
  maxBetStrk: z.coerce.number().positive().max(1_000_000).optional(),
  preferredSources: z.array(z.string().trim().min(1).max(64)).max(12).optional(),
});

/**
 * Spawned Agents endpoint.
 * GET: List all spawned agents with stats.
 * POST: Spawn a new custom agent.
 */
export async function GET(request: NextRequest) {
  if (!requireRole(request, "viewer")) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const agents = agentSpawner.list().map(serializeAgent);
  return Response.json({ agents, count: agents.length });
}

export async function POST(request: NextRequest) {
  const context = requireRole(request, "admin");
  if (!context) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = SpawnAgentSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues.map((issue) => issue.message) },
      { status: 400 }
    );
  }
  const payload = parsed.data;

  const config: SpawnAgentConfig = {
    name: payload.name ?? `Agent-${Date.now().toString(36)}`,
    personaId: payload.personaId,
    customSystemPrompt: payload.systemPrompt,
    budgetStrk: payload.budgetStrk ?? 1000,
    maxBetStrk: payload.maxBetStrk ?? 100,
    preferredSources: payload.preferredSources,
  };

  if (!config.name || config.name.length < 2) {
    return Response.json(
      { error: "Agent name must be at least 2 characters" },
      { status: 400 }
    );
  }

  const agent = agentSpawner.spawn(config);
  await recordAudit({
    organizationId: context.membership.organizationId,
    userId: context.user.id,
    action: "agent.spawn",
    targetType: "agent",
    targetId: agent.id,
    metadata: {
      name: agent.name,
      personaId: config.personaId ?? "custom",
      budgetStrk: config.budgetStrk ?? 1000,
      maxBetStrk: config.maxBetStrk ?? 100,
      preferredSources: config.preferredSources ?? [],
    },
  });

  return Response.json({
    ok: true,
    message: `Agent "${agent.name}" spawned`,
    agent: serializeAgent(agent),
  });
}
