import { NextRequest, NextResponse } from "next/server";
import {
  getMarkets,
  registerQuestion,
  resolveMarketQuestion,
  seedKnownQuestions,
} from "@/lib/market-reader";
import { config } from "@/lib/config";
import { getOnChainActivityCounts } from "@/lib/event-indexer";
import {
  getPersistedMarketSnapshots,
  getPersistedLoopActions,
  setPersistedMarketSnapshots,
} from "@/lib/state-store";

export const runtime = "nodejs";

// Seed known question texts before any API calls
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

const LEGACY_TIME_HASH_SUFFIX_REGEX = /\s+\d{1,3}d\s+[0-9a-f]{4,8}\??$/i;
const TRAILING_SHORT_HEX_SUFFIX_REGEX = /\s+[0-9a-f]{4,8}\??$/i;
const TRAILING_FRAGMENT_SUFFIX_REGEX = /\s+(?:in|i|win|t|clo)\??$/i;
const GENERIC_PREDICATE_END_SUFFIX_REGEX = /\b(?:win|lose|reach|hit|close|rise|fall)\?$/i;

function normalizeQuestionKey(value: string): string {
  const cleaned = value
    .trim()
    .replace(LEGACY_TIME_HASH_SUFFIX_REGEX, "")
    .replace(TRAILING_SHORT_HEX_SUFFIX_REGEX, "")
    .replace(/\bwin t\b/gi, "win")
    .replace(TRAILING_FRAGMENT_SUFFIX_REGEX, "");

  if (!cleaned) return "";

  return cleaned
    .toLowerCase()
    .replace(/\bwill\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isMalformedQuestion(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) return true;
  if (normalized.length < 15) return true;
  if (normalized.startsWith("Market #")) return true;
  if (/\bwin t\b/i.test(normalized)) return true;
  if (LEGACY_TIME_HASH_SUFFIX_REGEX.test(normalized)) return true;
  if (TRAILING_FRAGMENT_SUFFIX_REGEX.test(normalized)) return true;
  if (GENERIC_PREDICATE_END_SUFFIX_REGEX.test(normalized)) return true;
  if (
    TRAILING_SHORT_HEX_SUFFIX_REGEX.test(normalized) &&
    !/\b(19|20)\d{2}\b/.test(normalized)
  ) {
    return true;
  }

  return value
    .replace(/\0/g, "")
    .trim()
    .length < 15;
}

function parsePool(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function dedupeQuestionClones<
  T extends { id: number; question: string; totalPool: string; tradeCount: number }
>(markets: T[]): T[] {
  const bestByQuestion = new Map<string, T>();

  for (const market of markets) {
    const key = normalizeQuestionKey(market.question);
    if (!key) {
      bestByQuestion.set(`__id__${market.id}`, market);
      continue;
    }

    const existing = bestByQuestion.get(key);
    if (!existing) {
      bestByQuestion.set(key, market);
      continue;
    }

    const existingScore = [
      existing.tradeCount,
      parsePool(existing.totalPool),
      existing.id,
    ] as const;
    const incomingScore = [
      market.tradeCount,
      parsePool(market.totalPool),
      market.id,
    ] as const;

    const incomingBetter =
      incomingScore[0] > existingScore[0] ||
      (incomingScore[0] === existingScore[0] &&
        incomingScore[1] > existingScore[1]) ||
      (incomingScore[0] === existingScore[0] &&
        incomingScore[1] === existingScore[1] &&
        incomingScore[2] > existingScore[2]);

    if (incomingBetter) {
      bestByQuestion.set(key, market);
    }
  }

  return Array.from(bestByQuestion.values()).sort((a, b) => b.id - a.id);
}

/**
 * Filter out junk/empty markets:
 * - Open markets with zero pool + zero trades
 * - Resolved markets with zero pool + zero trades
 * - Garbled short labels / unresolved "Market #id" placeholders
 */
function filterEmptyMarkets<
  T extends {
    id: number;
    totalPool: string;
    status: number;
    question: string;
    tradeCount: number;
    resolutionTime: number;
  }
>(
  markets: T[],
  options?: { keepRecentMarketIds?: Set<number> }
): T[] {
  const nowSec = Math.floor(Date.now() / 1000);
  const keepRecentMarketIds = options?.keepRecentMarketIds ?? new Set<number>();

  return markets.filter((m) => {
    const hasPool = m.totalPool !== "0";
    const hasTrades = m.tradeCount > 0;
    const isOpen = m.status === 0 && m.resolutionTime > nowSec;
    const keepRecent = keepRecentMarketIds.has(m.id);

    // Drop malformed/junk labels even if they are "recent".
    if (isMalformedQuestion(m.question)) return false;

    // Filter legacy truncated labels that end mid-phrase and have no activity.
    const truncatedLegacy =
      !hasTrades &&
      m.question.length >= 24 &&
      m.question.length <= 31 &&
      !/[?)]$/.test(m.question) &&
      /( in| i| win| t)$/i.test(m.question);
    if (truncatedLegacy) return false;

    // Keep freshly created open markets even before first bet lands.
    if (!hasPool && !hasTrades) {
      if (keepRecent) return true;
      if (isOpen && m.question.length >= 20 && /[?)]$/.test(m.question)) {
        return true;
      }
      return false;
    }

    // Drop only clearly synthetic/truncated seeded markets with no trades.
    if (hasPool && !hasTrades && /^will\s+/i.test(m.question) && !/[?)]$/.test(m.question)) {
      const likelySynthetic =
        m.question.length <= 24 ||
        /( in| i| win| t| clo| 30d| [0-9a-f]{4})$/i.test(m.question);
      if (likelySynthetic && !keepRecent) return false;
    }

    return true;
  });
}

export async function GET(request: NextRequest) {
  const statusFilter = parseStatusFilter(request.nextUrl.searchParams.get("status"));
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
  const hideEmpty = request.nextUrl.searchParams.get("hideEmpty") !== "false";
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
  const keepRecentMarketIds = new Set<number>(
    cachedActions
      .filter(
        (action) =>
          action.type === "market_creation" &&
          typeof action.marketId === "number" &&
          Number.isFinite(action.marketId) &&
          Date.now() - action.timestamp <= 7 * 24 * 60 * 60 * 1000
      )
      .map((action) => action.marketId as number)
  );

  try {
    const markets = await withTimeout(getMarkets(), 7_000, []);
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

    const allEnriched = markets.map((m) => ({
      ...m,
      question: resolveMarketQuestion(m.id, m.questionHash),
      totalPool: m.totalPool.toString(),
      yesPool: m.yesPool.toString(),
      noPool: m.noPool.toString(),
      tradeCount: tradeCounts[m.address] ?? 0,
    }));
    const filtered = hideEmpty
      ? filterEmptyMarkets(allEnriched, { keepRecentMarketIds })
      : allEnriched;
    const deduped = dedupeQuestionClones(filtered);
    const enriched = applyMarketWindow(deduped, statusFilter, limit);

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
      const cachedEnriched = cachedSnapshots.map((snapshot) => ({
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
      }));
      const cachedFiltered = hideEmpty
        ? filterEmptyMarkets(cachedEnriched, { keepRecentMarketIds })
        : cachedEnriched;
      const cachedDeduped = dedupeQuestionClones(cachedFiltered);
      const markets = applyMarketWindow(cachedDeduped, statusFilter, limit);
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
