import { NextRequest, NextResponse } from "next/server";
import {
  getMarketById,
  getAgentPredictions,
  registerQuestion,
  getWeightedProbability,
  resolveMarketQuestion,
  seedKnownQuestions,
} from "@/lib/market-reader";
import { agentLoop } from "@/lib/agent-loop";
import {
  getPersistedLoopActions,
  getPersistedMarketSnapshots,
} from "@/lib/state-store";
import {
  getMarketByIdFromDb,
  getPredictionsFromDb,
  getWeightedProbFromDb,
  getLatestAgentTakeFromDb,
  upsertPredictions,
  upsertWeightedProb,
  upsertAgentTake,
} from "@/lib/market-db";

export const runtime = "nodejs";

seedKnownQuestions();

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
  const { id } = await params;
  const marketId = parseInt(id, 10);
  try {

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

    const market = await withTimeout(getMarketById(marketId), 3_000, null);

    if (!market) {
      // Try SQLite before returning 404
      try {
        const dbMarket = getMarketByIdFromDb(marketId);
        if (dbMarket) {
          return NextResponse.json({
            market: {
              ...dbMarket,
              totalPool: dbMarket.totalPool,
              yesPool: dbMarket.yesPool,
              noPool: dbMarket.noPool,
            },
            predictions: getPredictionsFromDb(marketId),
            weightedProbability: getWeightedProbFromDb(marketId),
            latestAgentTake: getLatestAgentTakeFromDb(marketId),
            stale: true,
            source: "db",
          });
        }
      } catch { /* SQLite unavailable */ }
      return NextResponse.json({ error: "Market not found" }, { status: 404 });
    }

    const [onChainPredictions, weightedProb] = await Promise.all([
      withTimeout(getAgentPredictions(marketId), 4_000, []),
      withTimeout(getWeightedProbability(marketId), 4_000, null),
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

    const predictionMap = new Map<string, (typeof onChainPredictions)[number]>();
    for (const prediction of onChainPredictions) {
      predictionMap.set(prediction.agent.toLowerCase(), prediction);
    }
    for (const action of [...recentActions].reverse()) {
      if (
        action.type !== "prediction" ||
        action.marketId !== marketId ||
        typeof action.probability !== "number" ||
        !Number.isFinite(action.probability)
      ) {
        continue;
      }
      const agentLabel =
        typeof action.agentName === "string" && action.agentName.trim().length > 0
          ? action.agentName.trim()
          : typeof action.agentId === "string" && action.agentId.trim().length > 0
            ? action.agentId.trim()
            : "agent";
      const key = agentLabel.toLowerCase();
      if (predictionMap.has(key)) continue;
      predictionMap.set(key, {
        agent: agentLabel,
        marketId,
        predictedProb: Math.max(0, Math.min(1, action.probability)),
        brierScore: 0.25,
        predictionCount: 1,
      });
    }
    const predictions = Array.from(predictionMap.values());

    const latestAction = [...recentActions]
      .reverse()
      .find(
        (a) =>
          a.marketId === marketId &&
          a.type === "prediction" &&
          typeof a.probability === "number" &&
          Number.isFinite(a.probability)
      );
    const latestAgentTake = latestAction
      ? {
          agentName: latestAction.agentName,
          probability: latestAction.probability ?? 0,
          reasoning: latestAction.reasoning ?? latestAction.detail,
          timestamp: Math.floor(latestAction.timestamp / 1000),
        }
      : null;

    // Write-through to SQLite
    try {
      if (predictions.length > 0) upsertPredictions(marketId, predictions);
      if (weightedProb !== null) upsertWeightedProb(marketId, weightedProb);
      if (latestAgentTake) {
        upsertAgentTake({
          marketId,
          agentName: latestAgentTake.agentName,
          probability: latestAgentTake.probability,
          reasoning: latestAgentTake.reasoning ?? "",
          timestamp: latestAgentTake.timestamp,
        });
      }
    } catch { /* best-effort */ }

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
    // Try SQLite fallback before 500
    try {
      const dbMarket = getMarketByIdFromDb(marketId);
      if (dbMarket) {
        return NextResponse.json({
          market: {
            ...dbMarket,
            totalPool: dbMarket.totalPool,
            yesPool: dbMarket.yesPool,
            noPool: dbMarket.noPool,
          },
          predictions: getPredictionsFromDb(marketId),
          weightedProbability: getWeightedProbFromDb(marketId),
          latestAgentTake: getLatestAgentTakeFromDb(marketId),
          stale: true,
          source: "db",
          warning: err?.message ?? "on-chain fetch failed",
        });
      }
    } catch { /* SQLite also unavailable */ }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
