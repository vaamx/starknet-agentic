import { NextRequest, NextResponse } from "next/server";
import {
  getMarkets,
  getAgentPredictions,
  getWeightedProbability,
  isMarketFinalized,
  DEMO_QUESTIONS,
} from "@/lib/market-reader";
import { requireRole } from "@/lib/require-auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = requireRole(request, "viewer");
    if (!context) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const marketId = parseInt(id, 10);
    const markets = await getMarkets();
    const market = markets.find((m) => m.id === marketId);

    if (!market) {
      return NextResponse.json({ error: "Market not found" }, { status: 404 });
    }

    const [predictions, weightedProb, finalized] = await Promise.all([
      getAgentPredictions(marketId),
      getWeightedProbability(marketId),
      isMarketFinalized(marketId),
    ]);

    return NextResponse.json({
      market: {
        ...market,
        question: DEMO_QUESTIONS[marketId] ?? `Market #${marketId}`,
        totalPool: market.totalPool.toString(),
        yesPool: market.yesPool.toString(),
        noPool: market.noPool.toString(),
      },
      predictions,
      weightedProbability: weightedProb,
      finalized,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
