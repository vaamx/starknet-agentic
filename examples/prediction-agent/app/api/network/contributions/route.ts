import { NextRequest } from "next/server";
import { z } from "zod";
import { enforceRateLimit, jsonError } from "@/lib/api-guard";
import {
  appendPersistedNetworkContribution,
  getPersistedNetworkAgent,
  listPersistedNetworkContributions,
  upsertPersistedExternalForecast,
  type PersistedNetworkContributionKind,
} from "@/lib/state-store";
import {
  buildContributionId,
  isStarknetAddress,
  normalizeWalletAddress,
} from "@/lib/agent-network";
import { config } from "@/lib/config";
import { registerQuestion } from "@/lib/market-reader";
import {
  type NetworkAuthEnvelope,
  verifyNetworkAuthEnvelope,
} from "@/lib/network-auth";

export const runtime = "nodejs";

const kindSchema = z.enum([
  "forecast",
  "market",
  "comment",
  "debate",
  "research",
  "bet",
] as const);

const contributionSchema = z.object({
  id: z.string().trim().min(3).max(200).optional(),
  actorType: z.enum(["agent", "human"]).default("agent"),
  agentId: z.string().trim().min(3).max(180).optional(),
  actorName: z.string().trim().min(2).max(120),
  walletAddress: z.string().trim().max(120).optional(),
  kind: kindSchema,
  marketId: z.number().int().nonnegative().optional(),
  question: z.string().trim().min(3).max(500).optional(),
  content: z.string().trim().min(1).max(12_000).optional(),
  probability: z.number().min(0).max(1).optional(),
  outcome: z.enum(["YES", "NO"]).optional(),
  amountStrk: z.number().nonnegative().max(1_000_000).optional(),
  sources: z.array(z.string().trim().min(1).max(300)).max(24).optional(),
  txHash: z.string().trim().min(6).max(120).optional(),
  proofId: z.string().trim().min(3).max(200).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  signature: z.string().trim().max(5000).optional(),
  auth: z.object({
    challengeId: z.string().trim().min(3).max(180),
    walletAddress: z.string().trim().min(4).max(120),
    signature: z.array(z.string().trim().min(1).max(5000)).min(1).max(8),
  }),
});

function toActivityKind(kind: PersistedNetworkContributionKind): string {
  if (kind === "forecast") return "prediction";
  if (kind === "market") return "market_creation";
  if (kind === "bet") return "bet";
  return "debate";
}

export async function GET(request: NextRequest) {
  const rateLimited = await enforceRateLimit(request, "network_contrib_get", {
    windowMs: 60_000,
    maxRequests: 240,
  });
  if (rateLimited) return rateLimited;

  const limitRaw = request.nextUrl.searchParams.get("limit");
  const marketIdRaw = request.nextUrl.searchParams.get("marketId");
  const kindRaw = request.nextUrl.searchParams.get("kind");
  const actorIdRaw = request.nextUrl.searchParams.get("agentId");
  const sinceRaw = request.nextUrl.searchParams.get("since");

  const limit = Number.parseInt(limitRaw ?? "200", 10);
  const marketId = marketIdRaw ? Number.parseInt(marketIdRaw, 10) : undefined;
  const since = sinceRaw ? Number.parseInt(sinceRaw, 10) : undefined;
  const kind = kindRaw
    ? kindSchema.safeParse(kindRaw).success
      ? (kindRaw as PersistedNetworkContributionKind)
      : undefined
    : undefined;

  const contributions = await listPersistedNetworkContributions({
    limit: Number.isFinite(limit) ? limit : 200,
    marketId: Number.isFinite(marketId) ? marketId : undefined,
    kind,
    actorId: actorIdRaw ?? undefined,
    since: Number.isFinite(since) ? since : undefined,
  });

  return Response.json({
    ok: true,
    contributions,
    count: contributions.length,
  });
}

export async function POST(request: NextRequest) {
  const rateLimited = await enforceRateLimit(request, "network_contrib_post", {
    windowMs: 60_000,
    maxRequests: 120,
  });
  if (rateLimited) return rateLimited;

  let body: z.infer<typeof contributionSchema>;
  try {
    body = contributionSchema.parse(await request.json());
  } catch (err: any) {
    return jsonError("Invalid contribution payload", 400, err?.issues ?? err?.message);
  }

  if (body.actorType === "agent" && !body.agentId) {
    return jsonError("agentId is required for actorType=agent", 400);
  }

  if (body.kind === "forecast" && typeof body.probability !== "number") {
    return jsonError("forecast contributions require probability", 400);
  }

  if (body.kind === "market" && !body.question) {
    return jsonError("market contributions require question", 400);
  }

  const walletAddress = body.walletAddress
    ? normalizeWalletAddress(body.walletAddress)
    : undefined;
  if (walletAddress && !isStarknetAddress(walletAddress)) {
    return jsonError("walletAddress must be a valid 0x-prefixed Starknet address", 400);
  }

  const { auth, ...unsignedPayload } = body;
  const authResult = await verifyNetworkAuthEnvelope({
    action: "post_contribution",
    payload: unsignedPayload,
    auth: auth as NetworkAuthEnvelope,
    expectedWalletAddress: walletAddress,
  });
  if (!authResult.ok) {
    return jsonError(authResult.error, authResult.status);
  }
  const effectiveWalletAddress = walletAddress ?? authResult.walletAddress;

  if (body.agentId) {
    const agent = await getPersistedNetworkAgent(body.agentId);
    if (!agent && body.actorType === "agent") {
      return jsonError("Unknown agentId. Register agent first via /api/network/agents", 404);
    }
    if (agent && agent.walletAddress !== effectiveWalletAddress) {
      return jsonError("walletAddress does not match registered agent owner", 403);
    }
  }

  const now = Date.now();
  const id =
    body.id?.trim() ||
    buildContributionId({
      actorName: body.actorName,
      walletAddress: effectiveWalletAddress,
      marketId: body.marketId,
      kind: body.kind,
      createdAt: now,
      content: body.content ?? body.question,
    });

  const contribution = await appendPersistedNetworkContribution(
    {
      id,
      actorType: body.actorType,
      agentId: body.agentId,
      actorName: body.actorName.trim(),
      walletAddress: effectiveWalletAddress,
      kind: body.kind,
      marketId: body.marketId,
      question: body.question?.trim(),
      content: body.content?.trim(),
      probability: body.probability,
      outcome: body.outcome,
      amountStrk: body.amountStrk,
      sources: body.sources?.map((source) => source.trim()).filter(Boolean),
      txHash: body.txHash?.trim(),
      proofId: body.proofId?.trim(),
      metadata: body.metadata,
      signature: body.signature?.trim(),
      createdAt: now,
    },
    10_000
  );

  if (
    contribution.kind === "forecast" &&
    typeof contribution.marketId === "number" &&
    Number.isFinite(contribution.marketId) &&
    typeof contribution.probability === "number"
  ) {
    await upsertPersistedExternalForecast(
      contribution.marketId,
      {
        agentName: contribution.actorName,
        probability: contribution.probability,
        reasoning: contribution.content,
        receivedAt: contribution.createdAt,
      },
      config.openclawForecastTtlHours
    );
  }

  if (
    contribution.kind === "market" &&
    typeof contribution.marketId === "number" &&
    contribution.question
  ) {
    registerQuestion(contribution.marketId, contribution.question);
  }

  return Response.json({
    ok: true,
    contribution,
    activityType: toActivityKind(contribution.kind),
  });
}
