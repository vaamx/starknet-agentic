import { NextRequest } from "next/server";
import { z } from "zod";
import { enforceRateLimit, jsonError } from "@/lib/api-guard";
import {
  getPersistedNetworkAgent,
  touchPersistedNetworkAgentHeartbeat,
} from "@/lib/state-store";
import {
  isStarknetAddress,
  normalizeWalletAddress,
} from "@/lib/agent-network";
import {
  type NetworkAuthEnvelope,
  verifyNetworkAuthEnvelope,
} from "@/lib/network-auth";
import {
  getNetworkPresencePolicy,
  resolveNetworkAgentPresence,
} from "@/lib/network-presence";

export const runtime = "nodejs";

const heartbeatSchema = z.object({
  agentId: z.string().trim().min(3).max(180),
  walletAddress: z.string().trim().min(4).max(120),
  active: z.boolean().optional(),
  endpointUrl: z.string().url().max(500).optional(),
  runtime: z
    .object({
      nodeId: z.string().trim().min(1).max(120).optional(),
      provider: z.string().trim().min(1).max(80).optional(),
      region: z.string().trim().min(1).max(48).optional(),
      scheduler: z.string().trim().min(1).max(80).optional(),
      intervalMs: z.number().int().positive().max(86_400_000).optional(),
      version: z.string().trim().min(1).max(80).optional(),
      endpointUrl: z.string().url().max(500).optional(),
      metadata: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
  auth: z.object({
    challengeId: z.string().trim().min(3).max(180),
    walletAddress: z.string().trim().min(4).max(120),
    signature: z.array(z.string().trim().min(1).max(5000)).min(1).max(8),
  }),
});

export async function POST(request: NextRequest) {
  const rateLimited = await enforceRateLimit(request, "network_heartbeat_post", {
    windowMs: 60_000,
    maxRequests: 240,
  });
  if (rateLimited) return rateLimited;

  let body: z.infer<typeof heartbeatSchema>;
  try {
    body = heartbeatSchema.parse(await request.json());
  } catch (err: any) {
    return jsonError("Invalid heartbeat payload", 400, err?.issues ?? err?.message);
  }

  const walletAddress = normalizeWalletAddress(body.walletAddress);
  if (!isStarknetAddress(walletAddress)) {
    return jsonError("walletAddress must be a valid 0x-prefixed Starknet address", 400);
  }

  const { auth, ...unsignedPayload } = body;
  const authResult = await verifyNetworkAuthEnvelope({
    action: "heartbeat_agent",
    payload: unsignedPayload,
    auth: auth as NetworkAuthEnvelope,
    expectedWalletAddress: walletAddress,
  });
  if (!authResult.ok) {
    return jsonError(authResult.error, authResult.status);
  }

  const existing = await getPersistedNetworkAgent(body.agentId);
  if (!existing) {
    return jsonError("Unknown agentId. Register agent first via /api/network/agents", 404);
  }
  if (existing.walletAddress !== walletAddress) {
    return jsonError("walletAddress does not match registered agent owner", 403);
  }

  const now = Date.now();
  const updated = await touchPersistedNetworkAgentHeartbeat({
    id: body.agentId,
    walletAddress,
    active: body.active,
    endpointUrl: body.endpointUrl,
    runtime: body.runtime,
    at: now,
  });
  if (!updated) {
    return jsonError("Failed to persist heartbeat", 409);
  }

  const presencePolicy = getNetworkPresencePolicy();
  const presence = resolveNetworkAgentPresence({
    agent: updated,
    now,
    onlineTtlMs: presencePolicy.onlineTtlMs,
    staleTtlMs: presencePolicy.staleTtlMs,
  });

  return Response.json({
    ok: true,
    acceptedAt: now,
    heartbeat: {
      agentId: updated.id,
      walletAddress: updated.walletAddress,
      heartbeatCount: updated.heartbeatCount ?? 0,
      lastHeartbeatAt: updated.lastHeartbeatAt ?? updated.lastSeenAt,
    },
    presence,
  });
}
