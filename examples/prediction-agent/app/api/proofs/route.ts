import { NextRequest } from "next/server";
import { z } from "zod";
import { enforceRateLimit, jsonError } from "@/lib/api-guard";
import {
  createProofRecord,
  listProofRecords,
  type ProofKind,
} from "@/lib/proof-pipeline";

export const runtime = "nodejs";

const createProofSchema = z.object({
  id: z.string().trim().min(3).max(200).optional(),
  kind: z
    .enum([
      "prediction",
      "bet",
      "resolution",
      "market_creation",
      "defi_swap",
      "custom",
    ] as const)
    .default("custom"),
  txHash: z.string().trim().min(6).max(120).optional(),
  agentId: z.string().trim().max(120).optional(),
  agentName: z.string().trim().max(120).optional(),
  walletAddress: z.string().trim().max(120).optional(),
  marketId: z.number().int().nonnegative().optional(),
  question: z.string().trim().max(500).optional(),
  reasoningHash: z.string().trim().max(128).optional(),
  payload: z.unknown().optional(),
  tags: z.record(z.string(), z.string()).optional(),
  anchor: z.boolean().optional(),
});

export async function GET(request: NextRequest) {
  const rateLimited = await enforceRateLimit(request, "proofs_get", {
    windowMs: 60_000,
    maxRequests: 120,
  });
  if (rateLimited) return rateLimited;

  const limitRaw = request.nextUrl.searchParams.get("limit") ?? "50";
  const limit = Number.parseInt(limitRaw, 10);

  const proofs = await listProofRecords(Number.isFinite(limit) ? limit : 50);
  return Response.json({
    proofs,
    count: proofs.length,
  });
}

export async function POST(request: NextRequest) {
  const rateLimited = await enforceRateLimit(request, "proofs_post", {
    windowMs: 60_000,
    maxRequests: 60,
  });
  if (rateLimited) return rateLimited;

  let body: z.infer<typeof createProofSchema>;
  try {
    body = createProofSchema.parse(await request.json());
  } catch (err: any) {
    return jsonError("Invalid proof payload", 400, err?.issues ?? err?.message);
  }

  try {
    const proof = await createProofRecord({
      id: body.id,
      kind: body.kind as ProofKind,
      txHash: body.txHash,
      agentId: body.agentId,
      agentName: body.agentName,
      walletAddress: body.walletAddress,
      marketId: body.marketId,
      question: body.question,
      reasoningHash: body.reasoningHash,
      payload: body.payload,
      tags: body.tags,
      anchor: body.anchor,
    });

    return Response.json({
      ok: true,
      proof,
    });
  } catch (err: any) {
    return jsonError("Failed to create proof record", 500, err?.message ?? String(err));
  }
}
