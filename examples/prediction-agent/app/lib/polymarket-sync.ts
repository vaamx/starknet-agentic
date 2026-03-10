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
 */

import { getPrismaClient, usePrismaRuntime } from "@/lib/prisma";
import { POLYMARKET_TAG_MAP } from "@/lib/data-sources/polymarket";

const GAMMA_API = "https://gamma-api.polymarket.com";
const ID_OFFSET = 100_000;
const ID_RANGE = 900_000; // 100_000 → 999_999

// ── Category mapping (Polymarket tag → our category) ─────────────────────────

const TAG_TO_CATEGORY: Record<string, string> = {};
for (const [category, tags] of Object.entries(POLYMARKET_TAG_MAP)) {
  for (const tag of tags) {
    TAG_TO_CATEGORY[tag.toLowerCase()] = category;
  }
}

function inferCategory(tags: Array<{ slug?: string; label?: string }>): string {
  for (const tag of tags) {
    const slug = (tag.slug ?? tag.label ?? "").toLowerCase();
    if (TAG_TO_CATEGORY[slug]) return TAG_TO_CATEGORY[slug];
  }
  // Fallback: check label text
  for (const tag of tags) {
    const label = (tag.label ?? "").toLowerCase();
    for (const [category, slugs] of Object.entries(POLYMARKET_TAG_MAP)) {
      if (slugs.some((s) => label.includes(s) || s.includes(label))) {
        return category;
      }
    }
  }
  return "world"; // default catch-all
}

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
  // Convert USD volume to a simulated pool size in wei (18 decimals)
  // This is a display heuristic — Polymarket uses USDC, not STRK
  const scaledWei = BigInt(Math.round(volumeUsd * 1e18));
  return scaledWei.toString();
}

// ── Fetch a page of events from Gamma API ────────────────────────────────────

interface GammaMarket {
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  outcomes: string; // JSON stringified
  outcomePrices: string; // JSON stringified
  volume: string;
  volumeNum?: number;
  endDate: string;
  closed: boolean;
  active: boolean;
  acceptingOrders: boolean;
  bestBid?: number;
  bestAsk?: number;
  lastTradePrice?: number;
  oneDayPriceChange?: number;
  spread?: number;
  groupItemTitle?: string;
  clobTokenIds?: string[];
  competitive?: number;
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
  commentCount?: number;
  startDate?: string;
  endDate?: string;
  tags: Array<{ id?: number; label?: string; slug?: string }>;
  markets: GammaMarket[];
}

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
 * Sync Polymarket events into our MarketCache.
 *
 * @param maxPerCategory — max events to fetch per category tag
 * @param categories — which categories to sync (null = all)
 */
export async function syncPolymarketMarkets(
  maxPerCategory = 30,
  categories?: string[] | null
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

  // Determine which tag slugs to fetch
  // We pick the primary tag for each category
  const PRIMARY_TAGS: Record<string, string> = {
    politics: "politics",
    elections: "elections",
    geopolitics: "geopolitics",
    sports: "sports",
    crypto: "crypto",
    finance: "finance",
    earnings: "earnings",
    tech: "ai",
    economy: "economy",
    climate: "climate",
    culture: "pop-culture",
    world: "world",
  };

  const catsToSync = categories ?? Object.keys(PRIMARY_TAGS);
  const seenConditionIds = new Set<string>();
  const usedIds = new Set<number>();

  // Also fetch trending (no tag filter) for "breaking" / "all"
  const fetchPlan: Array<{ tag: string | null; category: string; limit: number }> = [
    { tag: null, category: "trending", limit: Math.min(maxPerCategory, 50) },
  ];
  for (const cat of catsToSync) {
    const tag = PRIMARY_TAGS[cat];
    if (tag) {
      fetchPlan.push({ tag, category: cat, limit: maxPerCategory });
    }
  }

  for (const plan of fetchPlan) {
    try {
      const events = await fetchGammaEvents(plan.tag, plan.limit, 0);
      let catCount = 0;

      for (const event of events) {
        const markets = event.markets ?? [];
        if (markets.length === 0) continue;

        const category = plan.category === "trending"
          ? inferCategory(event.tags ?? [])
          : plan.category;

        for (const m of markets) {
          if (!m.conditionId || !m.question) continue;
          if (m.closed) continue;
          if (seenConditionIds.has(m.conditionId)) continue;
          seenConditionIds.add(m.conditionId);

          // Generate stable ID
          let id = stableId(m.conditionId);
          // Handle collision
          while (usedIds.has(id)) id++;
          usedIds.add(id);

          // Parse prices
          const prices = safeJsonParse<number[]>(
            m.outcomePrices,
            [0.5, 0.5]
          );
          const probYes = Math.max(0.001, Math.min(0.999, prices[0] ?? 0.5));
          const probNo = 1 - probYes;

          // Parse volume
          const volumeNum = m.volumeNum ?? (parseFloat(m.volume) || 0);
          const volume24h = event.volume24hr ?? 0;
          const liquidity = event.liquidity ?? 0;

          // Pool simulation (scaled from USD volume)
          const totalPoolWei = formatPoolWei(Math.max(volumeNum, 1));
          const yesWei = formatPoolWei(volumeNum * probYes);
          const noWei = formatPoolWei(volumeNum * probNo);

          // Resolution time
          const endDate = m.endDate ?? event.endDate;
          const resolutionTime = endDate
            ? Math.floor(new Date(endDate).getTime() / 1000)
            : Math.floor(Date.now() / 1000) + 30 * 24 * 3600;

          // Polymarket URL
          const polyUrl = event.slug
            ? `https://polymarket.com/event/${event.slug}`
            : m.slug
              ? `https://polymarket.com/event/${m.slug}`
              : null;

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
                status: 0, // open
                tradeCount: Math.round(volumeNum / 10), // rough heuristic
                volume24h,
                liquidity,
                oneDayChange: m.oneDayPriceChange ?? null,
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
                slug: m.slug ?? event.slug,
                imageUrl: event.image ?? event.icon ?? null,
                externalId: m.conditionId,
                volume24h,
                liquidity,
                description: event.description?.slice(0, 2000) ?? null,
                endDate: endDate ?? null,
                outcomes: m.outcomes ?? '["Yes","No"]',
                oneDayChange: m.oneDayPriceChange ?? null,
                polymarketUrl: polyUrl,
              },
            });
            result.synced++;
            catCount++;
          } catch (err: any) {
            result.errors++;
          }
        }
      }

      result.categories[plan.category] = catCount;
    } catch (err: any) {
      console.error(`[polymarket-sync] Failed to sync ${plan.tag ?? "trending"}:`, err.message);
      result.errors++;
    }
  }

  result.durationMs = Date.now() - start;
  console.log(
    `[polymarket-sync] Done: ${result.synced} synced, ${result.skipped} skipped, ${result.errors} errors in ${result.durationMs}ms`
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
