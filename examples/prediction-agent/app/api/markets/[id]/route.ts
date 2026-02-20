import { NextRequest, NextResponse } from "next/server";
import {
  getMarketById,
  getAgentPredictions,
  getWeightedProbability,
  MARKET_QUESTIONS,
} from "@/lib/market-reader";
import { agentLoop } from "@/lib/agent-loop";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const marketId = parseInt(id, 10);
    const market = await getMarketById(marketId);

    if (!market) {
      return NextResponse.json({ error: "Market not found" }, { status: 404 });
    }

    const [predictions, weightedProb] = await Promise.all([
      getAgentPredictions(marketId),
      getWeightedProbability(marketId),
    ]);

    const recentActions = agentLoop.getActionLog(200);
    const latestAction = [...recentActions]
      .reverse()
      .find(
        (a) =>
          a.marketId === marketId &&
          a.type === "prediction" &&
          !!a.txHash
      );
    const latestAgentTake = latestAction
      ? {
          agentName: latestAction.agentName,
          probability: latestAction.probability ?? 0,
          reasoning: latestAction.reasoning ?? latestAction.detail,
          timestamp: Math.floor(latestAction.timestamp / 1000),
        }
      : null;

    return NextResponse.json({
      market: {
        ...market,
        question: MARKET_QUESTIONS[marketId] ?? `Market #${marketId}`,
        totalPool: market.totalPool.toString(),
        yesPool: market.yesPool.toString(),
        noPool: market.noPool.toString(),
      },
      predictions,
      weightedProbability: weightedProb,
      latestAgentTake,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
