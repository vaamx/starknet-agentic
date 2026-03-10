/**
 * Polymarket Sync Engine
 *
 * Fetches markets from Polymarket's Gamma API and upserts them into
 * our MarketCache (PostgreSQL) so they appear as native markets in
 * the HiveCaster UI alongside on-chain Starknet markets.
 *
 * ID space: Polymarket markets use IDs 100_000+ to avoid collision
 * with on-chain Starknet markets (0–999) and featured seeds (900+).
 *
 * ID derivation: stable hash of Polymarket condition_id → integer in [100_000, 999_999].
 *
 * Category assignment: Uses our own `categorizeMarket()` regex engine on the question
 * text rather than relying on Polymarket's sparse tag system.
 */

import { getPrismaClient, usePrismaRuntime } from "@/lib/prisma";
import { categorizeMarket } from "@/lib/categories";

const GAMMA_API = "https://gamma-api.polymarket.com";
const ID_OFFSET = 100_000;
const ID_RANGE = 900_000; // 100_000 → 999_999

// ── Stable ID from Polymarket condition_id ───────────────────────────────────

function stableId(conditionId: string): number {
  let hash = 0;
  for (let i = 0; i < conditionId.length; i++) {
    hash = ((hash << 5) - hash + conditionId.charCodeAt(i)) | 0;
  }
  return ID_OFFSET + (((hash >>> 0) % ID_RANGE));
}

// ── Parse helpers ────────────────────────────────────────────────────────────

function safeJsonParse<T>(val: unknown, fallback: T): T {
  if (!val || typeof val !== "string") return fallback;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

function formatPoolWei(volumeUsd: number): string {
  const scaledWei = BigInt(Math.round(volumeUsd * 1e18));
  return scaledWei.toString();
}

// ── Gamma API types ──────────────────────────────────────────────────────────

interface GammaMarket {
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  outcomes: string;
  outcomePrices: string;
  volume: string;
  volumeNum?: number;
  endDate: string;
  closed: boolean;
  active: boolean;
  acceptingOrders: boolean;
  oneDayPriceChange?: number;
  image?: string;
  icon?: string;
  description?: string;
  // Event-level fields when fetched from /markets endpoint
  groupItemTitle?: string;
  eventSlug?: string;
}

interface GammaEvent {
  id: string;
  title: string;
  slug: string;
  description: string;
  image?: string;
  icon?: string;
  active: boolean;
  closed: boolean;
  volume: string;
  volume24hr?: number;
  liquidity?: number;
  endDate?: string;
  tags: Array<{ id?: number; label?: string; slug?: string }>;
  markets: GammaMarket[];
}

// ── Fetch functions ──────────────────────────────────────────────────────────

/**
 * Fetch individual markets from the /markets endpoint.
 * This returns more diverse results than /events.
 */
async function fetchGammaMarkets(
  limit: number,
  offset: number
): Promise<GammaMarket[]> {
  const params = new URLSearchParams({
    active: "true",
    closed: "false",
    limit: String(limit),
    offset: String(offset),
    order: "volume24hr",
    ascending: "false",
  });

  const url = `${GAMMA_API}/markets?${params}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });

  if (!res.ok) throw new Error(`Gamma API ${res.status}: ${url}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

/**
 * Fetch events with optional tag filter.
 */
async function fetchGammaEvents(
  tagSlug: string | null,
  limit: number,
  offset: number
): Promise<GammaEvent[]> {
  const params = new URLSearchParams({
    active: "true",
    closed: "false",
    limit: String(limit),
    offset: String(offset),
    order: "volume24hr",
    ascending: "false",
  });
  if (tagSlug) params.set("tag_slug", tagSlug);

  const url = `${GAMMA_API}/events?${params}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });

  if (!res.ok) throw new Error(`Gamma API ${res.status}: ${url}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

// ── Main sync function ───────────────────────────────────────────────────────

export interface PolySyncResult {
  synced: number;
  skipped: number;
  errors: number;
  categories: Record<string, number>;
  durationMs: number;
}

/**
 * Sync Polymarket markets into our MarketCache.
 *
 * Strategy:
 * 1. Fetch top markets from /markets endpoint (paginated) — best diversity
 * 2. Fetch events from tag-specific queries for targeted categories
 * 3. Categorize ALL markets using our regex engine (not Polymarket tags)
 *
 * @param maxTotal — max total markets to sync
 */
export async function syncPolymarketMarkets(
  maxTotal = 300,
  _categories?: string[] | null
): Promise<PolySyncResult> {
  const start = Date.now();
  const result: PolySyncResult = {
    synced: 0,
    skipped: 0,
    errors: 0,
    categories: {},
    durationMs: 0,
  };

  if (!usePrismaRuntime()) {
    console.warn("[polymarket-sync] Prisma not configured, skipping sync");
    result.durationMs = Date.now() - start;
    return result;
  }

  const prisma = await getPrismaClient();
  if (!prisma) {
    result.durationMs = Date.now() - start;
    return result;
  }

  const seenConditionIds = new Set<string>();
  const usedIds = new Set<number>();

  async function upsertMarket(
    m: GammaMarket,
    eventContext?: {
      volume24hr?: number;
      liquidity?: number;
      image?: string;
      icon?: string;
      eventSlug?: string;
      description?: string;
      endDate?: string;
    }
  ): Promise<boolean> {
    if (!m.conditionId || !m.question) return false;
    if (m.closed) return false;
    if (seenConditionIds.has(m.conditionId)) return false;
    seenConditionIds.add(m.conditionId);

    // Generate stable ID
    let id = stableId(m.conditionId);
    while (usedIds.has(id)) id++;
    usedIds.add(id);

    // Parse prices
    const prices = safeJsonParse<number[]>(m.outcomePrices, [0.5, 0.5]);
    const probYes = Math.max(0.001, Math.min(0.999, prices[0] ?? 0.5));
    const probNo = 1 - probYes;

    // Parse volume
    const volumeNum = m.volumeNum ?? (parseFloat(m.volume) || 0);
    const volume24h = eventContext?.volume24hr ?? 0;
    const liquidity = eventContext?.liquidity ?? 0;

    // Pool simulation
    const totalPoolWei = formatPoolWei(Math.max(volumeNum, 1));
    const yesWei = formatPoolWei(volumeNum * probYes);
    const noWei = formatPoolWei(volumeNum * probNo);

    // Resolution time
    const endDate = m.endDate ?? eventContext?.endDate;
    const resolutionTime = endDate
      ? Math.floor(new Date(endDate).getTime() / 1000)
      : Math.floor(Date.now() / 1000) + 30 * 24 * 3600;

    // Category — use our own regex engine on the question text
    const category = categorizeMarket(m.question);

    // Polymarket URL
    const slug = m.slug ?? m.eventSlug ?? eventContext?.eventSlug;
    const polyUrl = slug
      ? `https://polymarket.com/event/${slug}`
      : null;

    const image = m.image ?? m.icon ?? eventContext?.image ?? eventContext?.icon ?? null;
    const description = m.description ?? eventContext?.description ?? null;

    try {
      await prisma.marketCache.upsert({
        where: { id },
        update: {
          question: m.question,
          impliedProbYes: probYes,
          impliedProbNo: probNo,
          totalPool: totalPoolWei,
          yesPool: yesWei,
          noPool: noWei,
          resolutionTime,
          status: 0,
          tradeCount: Math.round(volumeNum / 10),
          volume24h,
          liquidity,
          oneDayChange: m.oneDayPriceChange ?? null,
          category,
          updatedAt: BigInt(Date.now()),
        },
        create: {
          id,
          question: m.question,
          questionHash: m.conditionId.slice(0, 20),
          address: `poly_${m.conditionId.slice(0, 16)}`,
          oracle: "polymarket_uma",
          collateralToken: "USDC",
          feeBps: 0,
          status: 0,
          impliedProbYes: probYes,
          impliedProbNo: probNo,
          totalPool: totalPoolWei,
          yesPool: yesWei,
          noPool: noWei,
          resolutionTime,
          tradeCount: Math.round(volumeNum / 10),
          updatedAt: BigInt(Date.now()),
          source: "polymarket",
          category,
          slug: m.slug ?? eventContext?.eventSlug,
          imageUrl: image,
          externalId: m.conditionId,
          volume24h,
          liquidity,
          description: typeof description === "string" ? description.slice(0, 2000) : null,
          endDate: endDate ?? null,
          outcomes: m.outcomes ?? '["Yes","No"]',
          oneDayChange: m.oneDayPriceChange ?? null,
          polymarketUrl: polyUrl,
        },
      });
      result.synced++;
      result.categories[category] = (result.categories[category] ?? 0) + 1;
      return true;
    } catch {
      result.errors++;
      return false;
    }
  }

  // ── Phase 1: Fetch from /markets endpoint (paginated for diversity) ──

  const PAGE_SIZE = 50;
  const maxPages = Math.ceil(maxTotal / PAGE_SIZE);

  for (let page = 0; page < maxPages; page++) {
    try {
      const markets = await fetchGammaMarkets(PAGE_SIZE, page * PAGE_SIZE);
      if (markets.length === 0) break;

      for (const m of markets) {
        if (result.synced >= maxTotal) break;
        await upsertMarket(m);
      }

      if (result.synced >= maxTotal) break;
    } catch (err: any) {
      console.error(`[polymarket-sync] /markets page ${page} failed:`, err.message);
      result.errors++;
    }
  }

  // ── Phase 2: Targeted tag fetches for underrepresented categories ──

  const TARGET_TAGS: Array<{ tag: string; category: string }> = [
    { tag: "crypto", category: "crypto" },
    { tag: "cryptocurrency", category: "crypto" },
    { tag: "bitcoin", category: "crypto" },
    { tag: "ethereum", category: "crypto" },
    { tag: "ai", category: "tech" },
    { tag: "technology", category: "tech" },
    { tag: "science", category: "tech" },
    { tag: "pop-culture", category: "culture" },
    { tag: "entertainment", category: "culture" },
    { tag: "music", category: "culture" },
    { tag: "movies", category: "culture" },
    { tag: "gaming", category: "culture" },
    { tag: "climate", category: "climate" },
    { tag: "environment", category: "climate" },
    { tag: "energy", category: "climate" },
    { tag: "weather", category: "climate" },
    { tag: "geopolitics", category: "geopolitics" },
    { tag: "ukraine", category: "geopolitics" },
    { tag: "china", category: "geopolitics" },
    { tag: "iran", category: "geopolitics" },
    { tag: "world", category: "world" },
    { tag: "global", category: "world" },
    { tag: "humanitarian", category: "world" },
    { tag: "earnings", category: "earnings" },
    { tag: "business", category: "earnings" },
    { tag: "quarterly-results", category: "earnings" },
  ];

  for (const { tag } of TARGET_TAGS) {
    if (result.synced >= maxTotal) break;
    try {
      const events = await fetchGammaEvents(tag, 20, 0);
      for (const event of events) {
        for (const m of event.markets ?? []) {
          if (result.synced >= maxTotal) break;
          await upsertMarket(m, {
            volume24hr: event.volume24hr,
            liquidity: event.liquidity,
            image: event.image,
            icon: event.icon,
            eventSlug: event.slug,
            description: event.description,
            endDate: event.endDate,
          });
        }
      }
    } catch {
      // Ignore — targeted tag fetch is best-effort
    }
  }

  result.durationMs = Date.now() - start;
  console.log(
    `[polymarket-sync] Done: ${result.synced} synced, ${result.skipped} skipped, ${result.errors} errors in ${result.durationMs}ms`,
    `| Categories:`, JSON.stringify(result.categories)
  );

  return result;
}

/**
 * Quick count of how many Polymarket markets are cached.
 */
export async function getPolymarketCount(): Promise<number> {
  if (!usePrismaRuntime()) return 0;
  const prisma = await getPrismaClient();
  if (!prisma) return 0;
  return prisma.marketCache.count({ where: { source: "polymarket" } });
}
