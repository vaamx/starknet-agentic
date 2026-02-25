import { NextRequest, NextResponse } from "next/server";
import {
  getMarketById,
  getAgentPredictions,
  registerQuestion,
  getWeightedProbability,
  resolveMarketQuestion,
} from "@/lib/market-reader";
import { agentLoop } from "@/lib/agent-loop";
import {
  getPersistedLoopActions,
  getPersistedMarketSnapshots,
} from "@/lib/state-store";

export const runtime = "nodejs";

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timeoutId = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const marketId = parseInt(id, 10);

    const [cachedSnapshots, cachedActions] = await Promise.all([
      getPersistedMarketSnapshots(500),
      getPersistedLoopActions(500),
    ]);
    for (const snapshot of cachedSnapshots) {
      if (snapshot.question) {
        registerQuestion(snapshot.id, snapshot.question);
      }
    }
    for (const action of cachedActions) {
      if (
        action.type === "market_creation" &&
        typeof action.marketId === "number" &&
        Number.isFinite(action.marketId) &&
        action.question
      ) {
        registerQuestion(action.marketId, action.question);
      }
    }

    const market = await getMarketById(marketId);

    if (!market) {
      return NextResponse.json({ error: "Market not found" }, { status: 404 });
    }

    const [predictions, weightedProb] = await Promise.all([
      withTimeout(getAgentPredictions(marketId), 8_000, []),
      withTimeout(getWeightedProbability(marketId), 8_000, null),
    ]);

    const [inMemoryActions, persistedActions] = await Promise.all([
      Promise.resolve(agentLoop.getActionLog(200)),
      getPersistedLoopActions(200),
    ]);
    const deduped = new Map<string, any>();
    for (const action of [...persistedActions, ...inMemoryActions]) {
      deduped.set(action.id, action);
    }
    const recentActions = Array.from(deduped.values()).sort(
      (a, b) => a.timestamp - b.timestamp
    );

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
        question: resolveMarketQuestion(marketId, market.questionHash),
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
