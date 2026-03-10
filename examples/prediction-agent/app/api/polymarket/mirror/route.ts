import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { enforceRateLimit, jsonError } from "@/lib/api-guard";
import { requireRole } from "@/lib/require-auth";
import { createMarket } from "@/lib/starknet-executor";
import { getPolymarketMarketById, setMirrorAddress } from "@/lib/polymarket-reader";
import { registerQuestion } from "@/lib/market-reader";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const maxDuration = 30;

const MirrorSchema = z.object({
  marketId: z.number().int().min(100_000),
});

/**
 * POST /api/polymarket/mirror
 * Deploy an on-chain Starknet mirror market for a Polymarket question.
 * Users can then bet on it with STRK using the same prediction market contract.
 */
export async function POST(request: NextRequest) {
  const rateLimited = await enforceRateLimit(request, "polymarket_mirror", { windowMs: 60_000, maxRequests: 3 });
  if (rateLimited) return rateLimited;

  const context = await requireRole(request, "admin");
  if (!context) return jsonError("Forbidden — admin role required", 403);

  let marketId: number;
  try {
    const body = MirrorSchema.parse(await request.json());
    marketId = body.marketId;
  } catch (err: any) {
    return NextResponse.json(
      { error: "Invalid request body", details: err?.issues ?? err?.message },
      { status: 400 }
    );
  }

  // Fetch the Polymarket market
  const polyMarket = await getPolymarketMarketById(marketId);
  if (!polyMarket) {
    return NextResponse.json({ error: "Polymarket market not found" }, { status: 404 });
  }

  // Already mirrored?
  if (polyMarket.mirrorAddress && polyMarket.mirrorAddress !== "0x0") {
    return NextResponse.json({
      marketId,
      mirrorAddress: polyMarket.mirrorAddress,
      alreadyExists: true,
    });
  }

  // Compute resolution time — use Polymarket's end date or default 30 days
  let resolutionTime = polyMarket.resolutionTime;
  if (!resolutionTime || resolutionTime <= Math.floor(Date.now() / 1000)) {
    resolutionTime = Math.floor(Date.now() / 1000) + 30 * 86400;
  }

  // Deploy mirror market on-chain via factory
  const result = await createMarket(
    polyMarket.question,
    resolutionTime - Math.floor(Date.now() / 1000), // duration in seconds
    200, // 2% fee
    config.AGENT_ADDRESS || undefined, // oracle = agent address
  );

  if (result.status !== "success" || !result.marketAddress) {
    return NextResponse.json(
      {
        error: result.error ?? "Failed to deploy mirror market",
        errorCode: result.errorCode,
        txHash: result.txHash,
      },
      { status: 500 }
    );
  }

  // Register the question text for the new on-chain market
  if (result.marketId !== undefined) {
    registerQuestion(result.marketId, polyMarket.question);
  }

  // Store the mirror address in the Polymarket cache
  const stored = await setMirrorAddress(marketId, result.marketAddress);

  return NextResponse.json({
    marketId,
    mirrorAddress: result.marketAddress,
    mirrorMarketId: result.marketId,
    txHash: result.txHash,
    stored,
    alreadyExists: false,
  });
}
