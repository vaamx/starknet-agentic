import { NextResponse } from "next/server";
import { getMarkets, resolveMarketQuestion } from "@/lib/market-reader";
import { config } from "@/lib/config";
import { getOnChainActivityCounts } from "@/lib/event-indexer";
import {
  getPersistedMarketSnapshots,
  setPersistedMarketSnapshots,
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

export async function GET() {
  const factoryAddress = config.MARKET_FACTORY_ADDRESS ?? "0x0";
  const factoryConfigured = factoryAddress !== "0x0" && factoryAddress !== "";
  const cachedSnapshots = await getPersistedMarketSnapshots(500);

  try {
    const markets = await withTimeout(getMarkets(), 10_000, []);
    if (factoryConfigured && cachedSnapshots.length > 0 && markets.length === 0) {
      throw new Error("On-chain market fetch returned empty set");
    }

    const addresses = markets
      .map((m) => m.address)
      .filter((a) => a !== "0x0" && !a.startsWith("0xpending"));
    const tradeCounts =
      addresses.length > 0
        ? await withTimeout(getOnChainActivityCounts(addresses), 6_000, {})
        : {};

    const enriched = markets.map((m) => ({
      ...m,
      question: resolveMarketQuestion(m.id, m.questionHash),
      totalPool: m.totalPool.toString(),
      yesPool: m.yesPool.toString(),
      noPool: m.noPool.toString(),
      tradeCount: tradeCounts[m.address] ?? 0,
    }));
    await setPersistedMarketSnapshots(
      enriched.map((m) => ({
        id: m.id,
        address: m.address,
        questionHash: m.questionHash,
        question: m.question,
        resolutionTime: m.resolutionTime,
        oracle: m.oracle,
        collateralToken: m.collateralToken,
        feeBps: m.feeBps,
        status: m.status,
        totalPool: m.totalPool,
        yesPool: m.yesPool,
        noPool: m.noPool,
        impliedProbYes: m.impliedProbYes,
        impliedProbNo: m.impliedProbNo,
        winningOutcome: m.winningOutcome,
        tradeCount: m.tradeCount,
        updatedAt: Date.now(),
      }))
    );

    return NextResponse.json({
      markets: enriched,
      factoryConfigured,
      factoryAddress,
      stale: false,
      source: "onchain",
    });
  } catch (err: any) {
    if (cachedSnapshots.length > 0) {
      const markets = cachedSnapshots.map((snapshot) => ({
        id: snapshot.id,
        address: snapshot.address,
        questionHash: snapshot.questionHash,
        question: snapshot.question,
        resolutionTime: snapshot.resolutionTime,
        oracle: snapshot.oracle,
        collateralToken: snapshot.collateralToken,
        feeBps: snapshot.feeBps,
        status: snapshot.status,
        totalPool: snapshot.totalPool,
        yesPool: snapshot.yesPool,
        noPool: snapshot.noPool,
        impliedProbYes: snapshot.impliedProbYes,
        impliedProbNo: snapshot.impliedProbNo,
        winningOutcome: snapshot.winningOutcome,
        tradeCount: snapshot.tradeCount ?? 0,
      }));
      return NextResponse.json({
        markets,
        factoryConfigured,
        factoryAddress,
        stale: true,
        source: "cache",
        warning: err?.message ?? "on-chain fetch failed",
      });
    }

    return NextResponse.json(
      {
        error: err?.message ?? "Failed to load markets",
        factoryConfigured,
        factoryAddress,
      },
      { status: 500 }
    );
  }
}
