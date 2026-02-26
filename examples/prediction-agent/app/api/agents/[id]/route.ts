import { NextRequest } from "next/server";
import { z } from "zod";
import { agentSpawner, serializeAgent } from "@/lib/agent-spawner";
import {
  provisionChildServerRuntime,
  terminateChildServerRuntime,
} from "@/lib/child-runtime";
import {
  ensureAgentSpawnerHydrated,
  persistAgentSpawner,
} from "@/lib/agent-persistence";
import { hasAgentSigningMaterial } from "@/lib/agent-key-custody";
import { requireWalletSessionScope } from "@/lib/wallet-session";

export const runtime = "nodejs";

const controlSchema = z.object({
  action: z.enum(["stop", "pause", "resume", "provision_runtime"]),
});

/**
 * Single Agent endpoint.
 * GET: Agent detail.
 * POST: Control agent (stop/pause/resume/provision_runtime).
 * DELETE: Remove agent.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureAgentSpawnerHydrated();
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
  await ensureAgentSpawnerHydrated();
  const auth = requireWalletSessionScope(request, "spawn");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  let payload: z.infer<typeof controlSchema>;
  try {
    payload = controlSchema.parse(await request.json());
  } catch (err: any) {
    return Response.json(
      {
        error: "Invalid control action",
        details: err?.issues ?? err?.message ?? "Malformed payload",
      },
      { status: 400 }
    );
  }
  const { action } = payload;

  const agent = agentSpawner.getAgent(id);
  if (!agent) {
    return Response.json({ error: "Agent not found" }, { status: 404 });
  }

  const warnings: string[] = [];

  switch (action) {
    case "stop":
      if (agent.runtime) {
        const termination = await terminateChildServerRuntime(agent);
        if (termination.status === "error") {
          warnings.push(
            `Runtime termination failed (${termination.machineId ?? "unknown"}): ${termination.error}`
          );
        }
      }
      agentSpawner.stop(id);
      break;
    case "pause":
      agentSpawner.pause(id);
      break;
    case "resume":
      agentSpawner.resume(id);
      break;
    case "provision_runtime":
      if (!agent.walletAddress || !hasAgentSigningMaterial(agent)) {
        return Response.json(
          {
            error:
              "Agent has no wallet signing credentials, cannot provision runtime",
          },
          { status: 400 }
        );
      }
      {
        const provision = await provisionChildServerRuntime(agent);
        if (provision.status === "error") {
          warnings.push(`Runtime provisioning failed: ${provision.error}`);
        } else if (provision.status === "skipped") {
          warnings.push(`Runtime provisioning skipped: ${provision.reason}`);
        }
      }
      break;
  }

  await persistAgentSpawner();

  return Response.json({
    ok: true,
    agent: serializeAgent(agentSpawner.getAgent(id)!),
    warnings: warnings.length > 0 ? warnings : undefined,
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureAgentSpawnerHydrated();
  const auth = requireWalletSessionScope(request, "spawn");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const agent = agentSpawner.getAgent(id);

  if (!agent) {
    return Response.json({ error: "Agent not found" }, { status: 404 });
  }

  if (agent.runtime) {
    await terminateChildServerRuntime(agent);
  }

  agentSpawner.remove(id);
  await persistAgentSpawner();
  return Response.json({ ok: true, message: `Agent "${agent.name}" removed` });
}
