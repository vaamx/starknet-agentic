import { NextRequest, NextResponse } from "next/server";
import { getMarkets, resolveMarketQuestion, seedKnownQuestions } from "@/lib/market-reader";
import { getUserPosition } from "@/lib/market-reader";

export const runtime = "nodejs";

seedKnownQuestions();

/**
 * GET /api/portfolio?user=0x...
 *
 * Returns all markets where the user has a non-zero position,
 * along with bet amounts, market status, and payout estimates.
 */
export async function GET(request: NextRequest) {
  const userAddress = request.nextUrl.searchParams.get("user");
  if (!userAddress || !/^0x[0-9a-fA-F]+$/.test(userAddress)) {
    return NextResponse.json(
      { error: "user query param required (hex address)" },
      { status: 400 }
    );
  }

  try {
    const markets = await getMarkets();
    if (markets.length === 0) {
      return NextResponse.json({ positions: [], totalInvested: "0", totalPayout: "0" });
    }

    // Fetch positions in parallel (max 20 concurrent to avoid RPC spam)
    const BATCH_SIZE = 20;
    const positions: Array<{
      marketId: number;
      address: string;
      question: string;
      status: number;
      resolutionTime: number;
      winningOutcome?: number;
      yesBet: string;
      noBet: string;
      totalBet: string;
      totalPool: string;
      yesPool: string;
      noPool: string;
      impliedProbYes: number;
      feeBps: number;
    }> = [];

    for (let i = 0; i < markets.length; i += BATCH_SIZE) {
      const batch = markets.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (market) => {
          const pos = await getUserPosition(market.address, userAddress);
          if (pos.yesBet <= 0n && pos.noBet <= 0n) return null;
          return {
            marketId: market.id,
            address: market.address,
            question: resolveMarketQuestion(market.id, market.questionHash),
            status: market.status,
            resolutionTime: market.resolutionTime,
            winningOutcome: market.winningOutcome,
            yesBet: pos.yesBet.toString(),
            noBet: pos.noBet.toString(),
            totalBet: (pos.yesBet + pos.noBet).toString(),
            totalPool: market.totalPool.toString(),
            yesPool: market.yesPool.toString(),
            noPool: market.noPool.toString(),
            impliedProbYes: market.impliedProbYes,
            feeBps: market.feeBps,
          };
        })
      );

      for (const result of results) {
        if (result.status === "fulfilled" && result.value) {
          positions.push(result.value);
        }
      }
    }

    // Compute totals
    let totalInvested = 0n;
    for (const pos of positions) {
      totalInvested += BigInt(pos.totalBet);
    }

    return NextResponse.json({
      positions,
      totalInvested: totalInvested.toString(),
      marketCount: positions.length,
    });
  } catch (err: any) {
    console.warn("[portfolio] Error:", err?.message);
    return NextResponse.json(
      { error: err?.message ?? "Failed to fetch portfolio" },
      { status: 500 }
    );
  }
}
