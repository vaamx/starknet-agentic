import { NextRequest } from "next/server";
import { z } from "zod";
import { enforceRateLimit, jsonError } from "@/lib/api-guard";
import {
  getPersistedNetworkAgent,
  listPersistedNetworkAgents,
  upsertPersistedNetworkAgent,
} from "@/lib/state-store";
import {
  buildNetworkAgentId,
  isStarknetAddress,
  normalizeWalletAddress,
  slugifyHandle,
} from "@/lib/agent-network";
import {
  type NetworkAuthEnvelope,
  verifyNetworkAuthEnvelope,
} from "@/lib/network-auth";

export const runtime = "nodejs";

const registerSchema = z.object({
  id: z.string().trim().min(3).max(180).optional(),
  walletAddress: z.string().trim().min(4).max(120),
  x402Address: z.string().trim().min(4).max(120).optional(),
  name: z.string().trim().min(2).max(80),
  handle: z.string().trim().min(2).max(48).optional(),
  description: z.string().trim().max(500).optional(),
  model: z.string().trim().max(120).optional(),
  endpointUrl: z.string().url().max(500).optional(),
  agentCardUrl: z.string().url().max(500).optional(),
  budgetStrk: z.number().nonnegative().max(1_000_000).optional(),
  maxBetStrk: z.number().nonnegative().max(1_000_000).optional(),
  topics: z.array(z.string().trim().min(1).max(48)).max(12).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  proofUrl: z.string().url().max(500).optional(),
  signature: z.string().trim().max(5000).optional(),
  active: z.boolean().optional(),
  auth: z.object({
    challengeId: z.string().trim().min(3).max(180),
    walletAddress: z.string().trim().min(4).max(120),
    signature: z.array(z.string().trim().min(1).max(5000)).min(1).max(8),
  }),
});

export async function GET(request: NextRequest) {
  const rateLimited = await enforceRateLimit(request, "network_agents_get", {
    windowMs: 60_000,
    maxRequests: 180,
  });
  if (rateLimited) return rateLimited;

  const limitRaw = request.nextUrl.searchParams.get("limit");
  const walletRaw = request.nextUrl.searchParams.get("wallet");
  const activeRaw = request.nextUrl.searchParams.get("active");
  const limit = Number.parseInt(limitRaw ?? "200", 10);
  const normalizedWallet = walletRaw ? normalizeWalletAddress(walletRaw) : "";
  const onlyActive = activeRaw === "true";

  const profiles = await listPersistedNetworkAgents(Number.isFinite(limit) ? limit : 200);
  const filtered = profiles.filter((profile) => {
    if (normalizedWallet && profile.walletAddress !== normalizedWallet) return false;
    if (onlyActive && !profile.active) return false;
    return true;
  });

  return Response.json({
    ok: true,
    agents: filtered,
    count: filtered.length,
  });
}

export async function POST(request: NextRequest) {
  const rateLimited = await enforceRateLimit(request, "network_agents_post", {
    windowMs: 60_000,
    maxRequests: 60,
  });
  if (rateLimited) return rateLimited;

  let body: z.infer<typeof registerSchema>;
  try {
    body = registerSchema.parse(await request.json());
  } catch (err: any) {
    return jsonError("Invalid registration payload", 400, err?.issues ?? err?.message);
  }

  const walletAddress = normalizeWalletAddress(body.walletAddress);
  if (!isStarknetAddress(walletAddress)) {
    return jsonError("walletAddress must be a valid 0x-prefixed Starknet address", 400);
  }

  const x402Address = body.x402Address
    ? normalizeWalletAddress(body.x402Address)
    : walletAddress;
  if (x402Address && !isStarknetAddress(x402Address)) {
    return jsonError("x402Address must be a valid 0x-prefixed Starknet address", 400);
  }

  const handle = body.handle ? slugifyHandle(body.handle) : slugifyHandle(body.name);
  const id = body.id?.trim() || buildNetworkAgentId(walletAddress, handle || body.name);
  const now = Date.now();
  const existing = await getPersistedNetworkAgent(id);

  if (existing && existing.walletAddress !== walletAddress) {
    return jsonError("agent id already exists under a different wallet", 409);
  }

  const { auth, ...unsignedPayload } = body;
  const authResult = await verifyNetworkAuthEnvelope({
    action: existing ? "update_agent" : "register_agent",
    payload: unsignedPayload,
    auth: auth as NetworkAuthEnvelope,
    expectedWalletAddress: walletAddress,
  });
  if (!authResult.ok) {
    return jsonError(authResult.error, authResult.status);
  }

  const profile = await upsertPersistedNetworkAgent({
    id,
    walletAddress,
    x402Address,
    name: body.name.trim(),
    handle: handle || undefined,
    description: body.description?.trim(),
    model: body.model?.trim(),
    endpointUrl: body.endpointUrl,
    agentCardUrl: body.agentCardUrl,
    budgetStrk: body.budgetStrk,
    maxBetStrk: body.maxBetStrk,
    topics: body.topics?.map((topic) => topic.trim()).filter(Boolean),
    metadata: body.metadata,
    proofUrl: body.proofUrl,
    signature: body.signature?.trim(),
    active: body.active ?? true,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastSeenAt: now,
  });

  return Response.json({
    ok: true,
    agent: profile,
    existed: !!existing,
  });
}
