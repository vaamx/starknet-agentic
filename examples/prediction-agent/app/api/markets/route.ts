import { NextRequest, NextResponse } from "next/server";
import {
  getMarkets,
  registerQuestion,
  resolveMarketQuestion,
} from "@/lib/market-reader";
import { config } from "@/lib/config";
import { getOnChainActivityCounts } from "@/lib/event-indexer";
import {
  getPersistedMarketSnapshots,
  getPersistedLoopActions,
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

type StatusFilter = "open" | "all" | "resolved";

function parseStatusFilter(raw: string | null): StatusFilter {
  if (raw === "all" || raw === "resolved") return raw;
  return "open";
}

function parseLimit(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 20;
  return Math.min(parsed, 200);
}

function applyMarketWindow<T extends { id: number; status: number; resolutionTime: number }>(
  markets: T[],
  statusFilter: StatusFilter,
  limit: number
): T[] {
  const nowSec = Math.floor(Date.now() / 1000);
  let filtered = markets;
  if (statusFilter === "open") {
    filtered = markets.filter((m) => m.status === 0 && m.resolutionTime > nowSec);
  } else if (statusFilter === "resolved") {
    filtered = markets.filter((m) => m.status === 2 || m.resolutionTime <= nowSec);
  }

  return filtered.sort((a, b) => b.id - a.id).slice(0, limit);
}

export async function GET(request: NextRequest) {
  const statusFilter = parseStatusFilter(request.nextUrl.searchParams.get("status"));
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
  const factoryAddress = config.MARKET_FACTORY_ADDRESS ?? "0x0";
  const factoryConfigured = factoryAddress !== "0x0" && factoryAddress !== "";
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
        ? await withTimeout(getOnChainActivityCounts(addresses), 1_500, {})
        : {};

    const enriched = applyMarketWindow(
      markets.map((m) => ({
        ...m,
        question: resolveMarketQuestion(m.id, m.questionHash),
        totalPool: m.totalPool.toString(),
        yesPool: m.yesPool.toString(),
        noPool: m.noPool.toString(),
        tradeCount: tradeCounts[m.address] ?? 0,
      })),
      statusFilter,
      limit
    );

    const fullSnapshot = markets.map((m) => ({
      ...m,
      question: resolveMarketQuestion(m.id, m.questionHash),
      totalPool: m.totalPool.toString(),
      yesPool: m.yesPool.toString(),
      noPool: m.noPool.toString(),
      tradeCount: tradeCounts[m.address] ?? 0,
    }));
    await setPersistedMarketSnapshots(
      fullSnapshot.map((m) => ({
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
          const markets = applyMarketWindow(
        cachedSnapshots.map((snapshot) => ({
          id: snapshot.id,
          address: snapshot.address,
          questionHash: snapshot.questionHash,
          question: resolveMarketQuestion(snapshot.id, snapshot.questionHash),
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
        })),
        statusFilter,
        limit
      );
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
