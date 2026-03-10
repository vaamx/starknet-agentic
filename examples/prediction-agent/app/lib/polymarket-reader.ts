/**
 * Polymarket Reader — reads synced Polymarket markets from MarketCache (PostgreSQL).
 */

import { getPrismaClient, usePrismaRuntime } from "@/lib/prisma";

export interface PolymarketCachedMarket {
  id: number;
  question: string;
  questionHash: string;
  address: string;
  oracle: string;
  collateralToken: string;
  feeBps: number;
  status: number;
  impliedProbYes: number;
  impliedProbNo: number;
  totalPool: string;
  yesPool: string;
  noPool: string;
  resolutionTime: number;
  tradeCount: number;
  winningOutcome?: number;
  // Polymarket-specific
  source: string;
  category?: string | null;
  slug?: string | null;
  imageUrl?: string | null;
  volume24h?: number | null;
  liquidity?: number | null;
  description?: string | null;
  outcomes?: string | null;
  oneDayChange?: number | null;
  polymarketUrl?: string | null;
  mirrorAddress?: string | null;
}

/**
 * Fetch Polymarket markets from MarketCache.
 * Returns up to `limit` markets sorted by volume (descending).
 */
export async function getPolymarketMarkets(
  limit = 200
): Promise<PolymarketCachedMarket[]> {
  if (!usePrismaRuntime()) return [];

  const prisma = await getPrismaClient();
  if (!prisma) return [];

  const rows = await prisma.marketCache.findMany({
    where: { source: "polymarket" },
    orderBy: { volume24h: "desc" },
    take: limit,
  });

  return rows.map((r: any) => ({
    id: r.id,
    question: r.question,
    questionHash: r.questionHash ?? "0x0",
    address: r.address ?? `poly_${r.id}`,
    oracle: r.oracle ?? "polymarket_uma",
    collateralToken: r.collateralToken ?? "USDC",
    feeBps: r.feeBps ?? 0,
    status: r.status ?? 0,
    impliedProbYes: r.impliedProbYes ?? 0.5,
    impliedProbNo: r.impliedProbNo ?? 0.5,
    totalPool: r.totalPool ?? "0",
    yesPool: r.yesPool ?? "0",
    noPool: r.noPool ?? "0",
    resolutionTime: r.resolutionTime ?? 0,
    tradeCount: r.tradeCount ?? 0,
    winningOutcome: r.winningOutcome ?? undefined,
    source: r.source ?? "polymarket",
    category: r.category,
    slug: r.slug,
    imageUrl: r.imageUrl,
    volume24h: r.volume24h,
    liquidity: r.liquidity,
    description: r.description,
    outcomes: r.outcomes,
    oneDayChange: r.oneDayChange,
    polymarketUrl: r.polymarketUrl,
    mirrorAddress: r.mirrorAddress ?? null,
  }));
}

/**
 * Fetch a single Polymarket market by its stable ID.
 */
export async function getPolymarketMarketById(
  id: number
): Promise<PolymarketCachedMarket | null> {
  if (!usePrismaRuntime()) return null;

  const prisma = await getPrismaClient();
  if (!prisma) return null;

  const r: any = await prisma.marketCache.findUnique({
    where: { id },
  });
  if (!r || r.source !== "polymarket") return null;

  return {
    id: r.id,
    question: r.question,
    questionHash: r.questionHash ?? "0x0",
    address: r.address ?? `poly_${r.id}`,
    oracle: r.oracle ?? "polymarket_uma",
    collateralToken: r.collateralToken ?? "USDC",
    feeBps: r.feeBps ?? 0,
    status: r.status ?? 0,
    impliedProbYes: r.impliedProbYes ?? 0.5,
    impliedProbNo: r.impliedProbNo ?? 0.5,
    totalPool: r.totalPool ?? "0",
    yesPool: r.yesPool ?? "0",
    noPool: r.noPool ?? "0",
    resolutionTime: r.resolutionTime ?? 0,
    tradeCount: r.tradeCount ?? 0,
    winningOutcome: r.winningOutcome ?? undefined,
    source: r.source ?? "polymarket",
    category: r.category,
    slug: r.slug,
    imageUrl: r.imageUrl,
    volume24h: r.volume24h,
    liquidity: r.liquidity,
    description: r.description,
    outcomes: r.outcomes,
    oneDayChange: r.oneDayChange,
    polymarketUrl: r.polymarketUrl,
    mirrorAddress: r.mirrorAddress ?? null,
  };
}

/**
 * Fetch Polymarket markets filtered by category.
 */
export async function getPolymarketMarketsByCategory(
  category: string,
  limit = 50
): Promise<PolymarketCachedMarket[]> {
  if (!usePrismaRuntime()) return [];

  const prisma = await getPrismaClient();
  if (!prisma) return [];

  const rows = await prisma.marketCache.findMany({
    where: { source: "polymarket", category },
    orderBy: { volume24h: "desc" },
    take: limit,
  });

  return rows.map((r: any) => ({
    id: r.id,
    question: r.question,
    questionHash: r.questionHash ?? "0x0",
    address: r.address ?? `poly_${r.id}`,
    oracle: r.oracle ?? "polymarket_uma",
    collateralToken: r.collateralToken ?? "USDC",
    feeBps: r.feeBps ?? 0,
    status: r.status ?? 0,
    impliedProbYes: r.impliedProbYes ?? 0.5,
    impliedProbNo: r.impliedProbNo ?? 0.5,
    totalPool: r.totalPool ?? "0",
    yesPool: r.yesPool ?? "0",
    noPool: r.noPool ?? "0",
    resolutionTime: r.resolutionTime ?? 0,
    tradeCount: r.tradeCount ?? 0,
    winningOutcome: r.winningOutcome ?? undefined,
    source: r.source ?? "polymarket",
    category: r.category,
    slug: r.slug,
    imageUrl: r.imageUrl,
    volume24h: r.volume24h,
    liquidity: r.liquidity,
    description: r.description,
    outcomes: r.outcomes,
    oneDayChange: r.oneDayChange,
    polymarketUrl: r.polymarketUrl,
    mirrorAddress: r.mirrorAddress ?? null,
  }));
}

/**
 * Fetch Polymarket markets with category diversity.
 * Fetches top `perCategory` markets from EACH category, then merges.
 * This ensures niche categories (culture, tech, geopolitics) aren't
 * crowded out by high-volume categories (politics, sports).
 */
export async function getPolymarketMarketsDiverse(
  perCategory = 30,
  statusFilter: "open" | "resolved" | "all" = "open"
): Promise<PolymarketCachedMarket[]> {
  if (!usePrismaRuntime()) return [];

  const prisma = await getPrismaClient();
  if (!prisma) return [];

  const nowSec = Math.floor(Date.now() / 1000);

  // Get all distinct categories
  const categories = await prisma.marketCache.groupBy({
    by: ["category"],
    where: { source: "polymarket" },
    _count: true,
  });

  // Fetch top N per category in parallel
  const perCatResults = await Promise.all(
    categories.map(async (cat: { category: string | null; _count: number }) => {
      const where: any = {
        source: "polymarket",
        category: cat.category,
      };
      // Apply status filter at DB level to avoid fetching markets that get filtered later
      if (statusFilter === "open") {
        where.status = 0;
        where.resolutionTime = { gt: nowSec };
      } else if (statusFilter === "resolved") {
        where.OR = [
          { status: 2 },
          { resolutionTime: { lte: nowSec } },
        ];
      }

      return prisma.marketCache.findMany({
        where,
        orderBy: { volume24h: "desc" },
        take: perCategory,
      });
    })
  );

  const rows = perCatResults.flat();

  return rows.map((r: any) => ({
    id: r.id,
    question: r.question,
    questionHash: r.questionHash ?? "0x0",
    address: r.address ?? `poly_${r.id}`,
    oracle: r.oracle ?? "polymarket_uma",
    collateralToken: r.collateralToken ?? "USDC",
    feeBps: r.feeBps ?? 0,
    status: r.status ?? 0,
    impliedProbYes: r.impliedProbYes ?? 0.5,
    impliedProbNo: r.impliedProbNo ?? 0.5,
    totalPool: r.totalPool ?? "0",
    yesPool: r.yesPool ?? "0",
    noPool: r.noPool ?? "0",
    resolutionTime: r.resolutionTime ?? 0,
    tradeCount: r.tradeCount ?? 0,
    winningOutcome: r.winningOutcome ?? undefined,
    source: r.source ?? "polymarket",
    category: r.category,
    slug: r.slug,
    imageUrl: r.imageUrl,
    volume24h: r.volume24h,
    liquidity: r.liquidity,
    description: r.description,
    outcomes: r.outcomes,
    oneDayChange: r.oneDayChange,
    polymarketUrl: r.polymarketUrl,
    mirrorAddress: r.mirrorAddress ?? null,
  }));
}

/**
 * Store the on-chain mirror address for a Polymarket market.
 */
export async function setMirrorAddress(
  marketId: number,
  mirrorAddress: string
): Promise<boolean> {
  if (!usePrismaRuntime()) return false;

  const prisma = await getPrismaClient();
  if (!prisma) return false;

  await prisma.marketCache.update({
    where: { id: marketId },
    data: { mirrorAddress },
  });
  return true;
}
