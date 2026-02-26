import { NextRequest } from "next/server";
import { z } from "zod";
import {
  agentSpawner,
  getBuiltInAgents,
  serializeAgent,
  type SpawnAgentConfig,
} from "@/lib/agent-spawner";
import { config } from "@/lib/config";
import { deployChildAgent } from "@/lib/child-spawner";
import { provisionChildServerRuntime } from "@/lib/child-runtime";
import {
  hasAgentSigningMaterial,
  hydrateAgentAccount,
  storeAgentPrivateKey,
} from "@/lib/agent-key-custody";
import {
  ensureAgentSpawnerHydrated,
  persistAgentSpawner,
} from "@/lib/agent-persistence";
import { requireWalletSession } from "@/lib/wallet-session";

export const runtime = "nodejs";

const spawnSchema = z.object({
  name: z.string().min(2).max(64).optional(),
  personaId: z.string().optional(),
  systemPrompt: z.string().optional(),
  budgetStrk: z.coerce.number().positive().max(1_000_000).optional(),
  maxBetStrk: z.coerce.number().positive().max(1_000_000).optional(),
  preferredSources: z.array(z.string()).optional(),
  sovereign: z.boolean().optional(),
  spawnServer: z.boolean().optional(),
  walletAddress: z.string().trim().optional(),
  walletPrivateKey: z.string().trim().optional(),
  walletAgentId: z.union([z.string(), z.number()]).optional(),
});

/**
 * Spawned Agents endpoint.
 * GET: List all agents (built-in + spawned) with stats.
 * POST: Spawn a new custom agent.
 */
export async function GET() {
  await ensureAgentSpawnerHydrated();
  const builtIn = getBuiltInAgents().map(serializeAgent);
  const spawned = agentSpawner.list().map(serializeAgent);
  const agents = [...builtIn, ...spawned];
  return Response.json({ agents, count: agents.length });
}

export async function POST(request: NextRequest) {
  await ensureAgentSpawnerHydrated();
  const auth = requireWalletSession(request);
  if (!auth.ok) return auth.response;
  let payload: z.infer<typeof spawnSchema>;
  try {
    payload = spawnSchema.parse(await request.json());
  } catch (err: any) {
    return Response.json(
      {
        error: "Invalid spawn request",
        details: err?.issues ?? err?.message ?? "Malformed payload",
      },
      { status: 400 }
    );
  }

  const spawnConfig: SpawnAgentConfig = {
    name: payload.name ?? `Agent-${Date.now().toString(36)}`,
    personaId: payload.personaId,
    customSystemPrompt: payload.systemPrompt,
    budgetStrk: payload.budgetStrk ?? 300,
    maxBetStrk: payload.maxBetStrk ?? 10,
    preferredSources: payload.preferredSources,
  };

  const byoWalletMode = Boolean(payload.walletAddress);
  if (byoWalletMode) {
    const normalizedAddress = String(payload.walletAddress).trim().toLowerCase();
    if (!/^0x[0-9a-f]+$/i.test(normalizedAddress)) {
      return Response.json(
        {
          error:
            "walletAddress must be a valid 0x-prefixed Starknet address for BYO registration",
        },
        { status: 400 }
      );
    }

    const agent = agentSpawner.spawn(spawnConfig);
    agent.walletAddress = normalizedAddress;

    const warnings: string[] = [];
    if (payload.walletAgentId !== undefined) {
      try {
        agent.agentId = BigInt(payload.walletAgentId);
      } catch {
        warnings.push(
          `walletAgentId "${String(payload.walletAgentId)}" is invalid and was ignored`
        );
      }
    }

    if (payload.walletPrivateKey) {
      try {
        const storedKey = await storeAgentPrivateKey({
          agentId: agent.id,
          walletAddress: normalizedAddress,
          privateKey: payload.walletPrivateKey,
        });
        agent.keyRef = storedKey.keyRef;
        agent.keyCustodyProvider = storedKey.provider;
        agent.privateKey = payload.walletPrivateKey;
        agent.account = await hydrateAgentAccount(agent) ?? undefined;
      } catch (err: any) {
        return Response.json(
          {
            error: `Failed to store BYO wallet signing key: ${err?.message ?? String(err)}`,
          },
          { status: 500 }
        );
      }
    } else {
      warnings.push(
        "No walletPrivateKey provided. Agent can observe/forecast, but cannot place bets or sign on-chain writes."
      );
    }

    const shouldProvisionRuntime =
      payload.spawnServer === true ||
      (config.childServerEnabled && payload.spawnServer !== false);

    if (shouldProvisionRuntime) {
      if (hasAgentSigningMaterial(agent)) {
        const runtimeProvision = await provisionChildServerRuntime(agent);
        if (runtimeProvision.status === "error") {
          warnings.push(`Runtime provisioning failed: ${runtimeProvision.error}`);
        } else if (runtimeProvision.status === "skipped") {
          warnings.push(`Runtime provisioning skipped: ${runtimeProvision.reason}`);
        }
      } else {
        warnings.push(
          "Runtime provisioning skipped because wallet signing credentials are not registered."
        );
      }
    }

    await persistAgentSpawner();
    return Response.json({
      ok: true,
      message: `Agent "${agent.name}" registered with BYO wallet`,
      agent: serializeAgent(agent),
      deployment: {
        sovereign: false,
        byoWallet: true,
        walletAddress: normalizedAddress,
      },
      warnings: warnings.length > 0 ? warnings : undefined,
    });
  }

  // Default behavior: when child agents are enabled, /api/agents creates sovereign
  // agents unless explicitly opted out with { sovereign: false }.
  const sovereignMode =
    payload.sovereign === true ||
    (config.childAgentEnabled && payload.sovereign !== false);

  if (!sovereignMode) {
    const agent = agentSpawner.spawn(spawnConfig);
    await persistAgentSpawner();
    return Response.json({
      ok: true,
      message: `Agent "${agent.name}" spawned`,
      agent: serializeAgent(agent),
      deployment: {
        sovereign: false,
      },
    });
  }

  if (!config.childAgentEnabled) {
    return Response.json(
      {
        error:
          "Sovereign spawn requires CHILD_AGENT_ENABLED=true and owner wallet configuration",
      },
      { status: 400 }
    );
  }

  const deploy = await deployChildAgent({
    name: spawnConfig.name,
    model: "claude-sonnet-4-6",
    fundingStrk: spawnConfig.budgetStrk ?? 300,
  });

  if (deploy.error || !deploy.agentAddress) {
    return Response.json(
      {
        error: `Failed to deploy sovereign child agent: ${deploy.error ?? "unknown error"}`,
      },
      { status: 500 }
    );
  }

  const agent = agentSpawner.spawn(spawnConfig);
  agent.walletAddress = deploy.agentAddress;
  agent.privateKey = deploy.privateKey; // in-memory only
  agent.account = deploy.account;
  agent.agentId = deploy.agentId;
  try {
    const storedKey = await storeAgentPrivateKey({
      agentId: agent.id,
      walletAddress: deploy.agentAddress,
      privateKey: deploy.privateKey,
    });
    agent.keyRef = storedKey.keyRef;
    agent.keyCustodyProvider = storedKey.provider;
    agent.account = (await hydrateAgentAccount(agent)) ?? deploy.account;
  } catch (err: any) {
    return Response.json(
      {
        error: `Failed to persist sovereign child signing key: ${err?.message ?? String(err)}`,
      },
      { status: 500 }
    );
  }

  const shouldProvisionRuntime =
    payload.spawnServer === true ||
    (config.childServerEnabled && payload.spawnServer !== false);

  const warnings: string[] = [];
  let runtimeProvision:
    | Awaited<ReturnType<typeof provisionChildServerRuntime>>
    | undefined;

  if (shouldProvisionRuntime) {
    runtimeProvision = await provisionChildServerRuntime(agent);
    if (runtimeProvision.status === "error") {
      warnings.push(`Runtime provisioning failed: ${runtimeProvision.error}`);
    } else if (runtimeProvision.status === "skipped") {
      warnings.push(`Runtime provisioning skipped: ${runtimeProvision.reason}`);
    }
  }

  await persistAgentSpawner();

  return Response.json({
    ok: true,
    message: `Agent "${agent.name}" deployed`,
    agent: serializeAgent(agent),
    deployment: {
      sovereign: true,
      deployTxHash: deploy.txHash,
      childAddress: deploy.agentAddress,
      childAgentId: deploy.agentId.toString(),
      runtimeProvision:
        runtimeProvision?.status === "success"
          ? {
              status: "success",
              machineId: runtimeProvision.runtime.machineId,
              tier: runtimeProvision.runtime.tier,
              region: runtimeProvision.runtime.region,
            }
          : runtimeProvision
            ? {
                status: runtimeProvision.status,
                reason:
                  runtimeProvision.status === "skipped"
                    ? runtimeProvision.reason
                    : runtimeProvision.error,
              }
            : undefined,
    },
    warnings: warnings.length > 0 ? warnings : undefined,
  });
}
