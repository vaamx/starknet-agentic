/**
 * Polymarket Data Source — Fetches prediction market data from Polymarket.
 *
 * Uses both the Gamma events API (for tag-based category discovery)
 * and the markets API (for keyword search).
 *
 * Events API: tag_slug filtering → grouped markets with volume/liquidity data
 * Markets API: text search → flat market list (fallback)
 */

import type { DataSourceResult, DataPoint } from "./index";

const GAMMA_API = "https://gamma-api.polymarket.com";

// ── Polymarket tag → our category mapping ────────────────────────────────────

export const POLYMARKET_TAG_MAP: Record<string, string[]> = {
  politics: [
    "politics", "us-politics", "regulation", "supreme-court", "congress",
    "white-house", "executive-orders", "legislation",
  ],
  elections: [
    "elections", "us-elections", "2026-elections", "2028-elections",
    "presidential-election", "midterms", "primaries", "senate-races",
    "gubernatorial", "polls",
  ],
  geopolitics: [
    "geopolitics", "ukraine", "russia", "china", "taiwan", "middle-east",
    "israel", "gaza", "iran", "north-korea", "nato", "war", "sanctions",
    "ceasefire", "peace-talks", "conflict", "diplomacy",
  ],
  sports: [
    "sports", "nfl", "nba", "mlb", "nhl", "mls", "soccer", "football",
    "premier-league", "champions-league", "la-liga", "serie-a", "bundesliga",
    "ligue-1", "liga-mx", "copa-america", "euro", "world-cup",
    "tennis", "atp", "wta", "grand-slam", "wimbledon",
    "mma", "ufc", "boxing", "pfl",
    "f1", "formula-1", "nascar", "indycar",
    "golf", "pga", "lpga", "masters",
    "cricket", "ipl", "rugby", "six-nations",
    "olympics", "ncaa", "march-madness", "college-football",
    "esports", "league-of-legends", "dota", "valorant",
    "horse-racing", "kentucky-derby",
    "cycling", "tour-de-france",
    "swimming", "athletics", "track-and-field",
  ],
  crypto: [
    "crypto", "cryptocurrency", "bitcoin", "ethereum", "solana", "cardano",
    "defi", "nft", "stablecoin", "altcoin", "memecoin", "layer-2",
    "starknet", "arbitrum", "optimism", "polygon", "base", "avalanche",
    "sec-crypto", "etf", "binance", "coinbase",
  ],
  finance: [
    "finance", "stocks", "markets", "fed", "interest-rates", "ipo",
    "mergers", "acquisitions", "bonds", "treasury", "forex",
    "commodities", "oil", "gold", "silver", "real-estate",
    "hedge-funds", "wall-street", "sp500", "nasdaq", "dow-jones",
  ],
  earnings: [
    "earnings", "business", "quarterly-results", "revenue",
    "apple-earnings", "nvidia-earnings", "tesla-earnings",
    "microsoft-earnings", "amazon-earnings", "google-earnings",
    "meta-earnings", "netflix-earnings", "bank-earnings",
  ],
  tech: [
    "tech", "ai", "artificial-intelligence", "technology", "science",
    "space", "spacex", "nasa", "openai", "google-ai", "apple",
    "microsoft", "nvidia", "semiconductor", "quantum", "robotics",
    "autonomous-vehicles", "cybersecurity",
  ],
  economy: [
    "economy", "inflation", "cpi", "jobs", "gdp", "recession",
    "unemployment", "consumer-spending", "housing", "trade",
    "federal-reserve", "central-bank", "debt-ceiling",
  ],
  climate: [
    "climate", "environment", "energy", "weather", "hurricane",
    "wildfire", "renewable-energy", "solar", "ev", "electric-vehicle",
    "carbon", "nuclear-energy", "fusion",
    "space-exploration", "nasa-mission", "gene-therapy", "crispr",
  ],
  culture: [
    "pop-culture", "entertainment", "music", "movies", "celebrities",
    "streaming", "netflix", "disney", "awards", "oscars", "grammys",
    "emmys", "box-office", "gaming", "video-games", "esports",
    "social-media", "tiktok", "youtube", "podcast",
    "k-pop", "anime", "fashion", "art",
    "taylor-swift", "beyonce", "drake", "bad-bunny",
  ],
  world: [
    "world", "global", "international", "humanitarian",
    "pandemic", "who", "disaster", "earthquake", "tsunami",
    "refugee", "migration", "poverty", "development",
    "g7", "g20", "united-nations",
  ],
};

/**
 * Fetch events from Polymarket by tag slug.
 * Returns nested markets grouped by event.
 */
export async function fetchPolymarketEvents(
  tagSlug: string,
  limit = 10,
  order: "volume" | "startDate" | "liquidity" = "volume"
): Promise<DataSourceResult> {
  try {
    const url = `${GAMMA_API}/events?closed=false&active=true&limit=${limit}&order=${order}&ascending=false&tag_slug=${encodeURIComponent(tagSlug)}`;
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) throw new Error(`Polymarket events API ${response.status}`);

    const events = await response.json();
    if (!Array.isArray(events) || events.length === 0) {
      return emptyResult(tagSlug, "No matching events found.");
    }

    const data: DataPoint[] = [];
    for (const event of events.slice(0, 8)) {
      const markets = event.markets ?? [];
      const eventTitle = event.title ?? "Unknown event";
      const eventVolume = parseFloat(event.volume) || 0;
      const volume24h = event.volume24hr ?? 0;
      const commentCount = event.commentCount ?? 0;
      const tags = (event.tags ?? []).map((t: any) => t.label).join(", ");

      // Extract the top market from each event (highest volume)
      const topMarket = markets.sort(
        (a: any, b: any) => (parseFloat(b.volume) || 0) - (parseFloat(a.volume) || 0)
      )[0];

      if (topMarket) {
        const question = topMarket.question ?? topMarket.groupItemTitle ?? eventTitle;
        const odds = parseOdds(topMarket.outcomePrices);
        const endDate = topMarket.endDate ? new Date(topMarket.endDate) : null;
        const daysUntilEnd = endDate
          ? Math.ceil((endDate.getTime() - Date.now()) / 86_400_000)
          : null;
        const competitive = topMarket.competitive ?? null;
        const priceChange = topMarket.oneDayPriceChange ?? 0;

        data.push({
          label: question,
          value: `YES ${formatOdds(topMarket.outcomePrices)} | Vol: $${formatNumber(eventVolume)} | 24h: $${formatNumber(volume24h)}${daysUntilEnd ? ` | ${daysUntilEnd}d left` : ""}${priceChange ? ` | Δ${(priceChange * 100).toFixed(1)}%` : ""}`,
          url: event.slug
            ? `https://polymarket.com/event/${event.slug}`
            : topMarket.slug
              ? `https://polymarket.com/event/${topMarket.slug}`
              : undefined,
          confidence: odds,
        });
      }

      // For multi-market events, also include additional interesting markets
      if (markets.length > 1) {
        for (const m of markets.slice(1, 3)) {
          const q = m.question ?? m.groupItemTitle;
          if (!q) continue;
          const odds = parseOdds(m.outcomePrices);
          // Only include markets with meaningful odds (not near 0 or 1)
          if (odds > 0.05 && odds < 0.95) {
            data.push({
              label: q,
              value: `YES ${formatOdds(m.outcomePrices)} | Vol: $${formatNumber(parseFloat(m.volume) || 0)}`,
              url: m.slug ? `https://polymarket.com/event/${m.slug}` : undefined,
              confidence: odds,
            });
          }
        }
      }
    }

    const topEvent = events[0];
    const summary = `Found ${events.length} Polymarket events for "${tagSlug}". Top: "${topEvent.title}" ($${formatNumber(parseFloat(topEvent.volume) || 0)} volume, ${topEvent.commentCount ?? 0} comments).`;

    return {
      source: "polymarket",
      query: tagSlug,
      timestamp: Date.now(),
      data,
      summary,
    };
  } catch (err: any) {
    return emptyResult(tagSlug, err?.message ?? "request failed");
  }
}

/**
 * Search Polymarket markets by keyword (flat search, no tag filtering).
 * Useful when tag-based search misses niche topics.
 */
export async function fetchPolymarketData(
  question: string
): Promise<DataSourceResult> {
  const keywords = extractKeywords(question);

  try {
    const url = `${GAMMA_API}/markets?closed=false&active=true&limit=8&order=volume&ascending=false&_q=${encodeURIComponent(keywords)}`;

    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });

    if (!response.ok) throw new Error(`Polymarket API ${response.status}`);

    const markets = await response.json();

    if (Array.isArray(markets) && markets.length > 0) {
      const data: DataPoint[] = markets.slice(0, 8).map((m: any) => {
        const odds = parseOdds(m.outcomePrices);
        const volume24h = m.volume24hr ?? 0;
        const endDate = m.endDate ? new Date(m.endDate) : null;
        const daysLeft = endDate
          ? Math.ceil((endDate.getTime() - Date.now()) / 86_400_000)
          : null;
        const priceChange = m.oneDayPriceChange ?? 0;

        return {
          label: m.question ?? m.title ?? "Unknown market",
          value: `YES ${formatOdds(m.outcomePrices)} | Vol: $${formatNumber(m.volume)} | 24h: $${formatNumber(volume24h)}${daysLeft ? ` | ${daysLeft}d left` : ""}${priceChange ? ` | Δ${(priceChange * 100).toFixed(1)}%` : ""}`,
          url: m.slug
            ? `https://polymarket.com/event/${m.slug}`
            : undefined,
          confidence: odds,
        };
      });

      const topMarket = markets[0];
      const topOdds = parseOdds(topMarket.outcomePrices);
      const summary = `Found ${markets.length} related market(s). Top match: "${topMarket.question ?? topMarket.title}" at ${Math.round(topOdds * 100)}% YES with $${formatNumber(topMarket.volume)} volume.`;

      return {
        source: "polymarket",
        query: keywords,
        timestamp: Date.now(),
        data,
        summary,
      };
    }
  } catch (err: any) {
    return emptyResult(keywords, err?.message ?? "request failed");
  }

  return emptyResult(keywords, "no matches");
}

/**
 * Fetch trending Polymarket markets (highest 24h volume).
 */
export async function fetchPolymarketTrending(
  limit = 10
): Promise<DataSourceResult> {
  try {
    const url = `${GAMMA_API}/events?closed=false&active=true&limit=${limit}&order=volume24hr&ascending=false`;
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) throw new Error(`Polymarket trending API ${response.status}`);

    const events = await response.json();
    if (!Array.isArray(events) || events.length === 0) {
      return emptyResult("trending", "No trending events found.");
    }

    const data: DataPoint[] = events.slice(0, limit).flatMap((event: any) => {
      const markets = event.markets ?? [];
      const topMarket = markets[0];
      if (!topMarket) return [];
      const question = topMarket.question ?? event.title;
      const odds = parseOdds(topMarket.outcomePrices);
      const volume24h = event.volume24hr ?? 0;

      return [{
        label: question,
        value: `YES ${formatOdds(topMarket.outcomePrices)} | 24h Vol: $${formatNumber(volume24h)}`,
        url: event.slug ? `https://polymarket.com/event/${event.slug}` : undefined,
        confidence: odds,
      }];
    });

    return {
      source: "polymarket",
      query: "trending",
      timestamp: Date.now(),
      data,
      summary: `Top ${data.length} trending Polymarket events by 24h volume.`,
    };
  } catch (err: any) {
    return emptyResult("trending", err?.message ?? "request failed");
  }
}

/**
 * Fetch newly created Polymarket markets.
 */
export async function fetchPolymarketNew(
  limit = 8
): Promise<DataSourceResult> {
  try {
    const url = `${GAMMA_API}/events?closed=false&active=true&limit=${limit}&order=startDate&ascending=false`;
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) throw new Error(`Polymarket new API ${response.status}`);

    const events = await response.json();
    if (!Array.isArray(events) || events.length === 0) {
      return emptyResult("new", "No new events found.");
    }

    const data: DataPoint[] = events.slice(0, limit).flatMap((event: any) => {
      const markets = event.markets ?? [];
      const topMarket = markets[0];
      if (!topMarket) return [];

      return [{
        label: topMarket.question ?? event.title,
        value: `YES ${formatOdds(topMarket.outcomePrices)} | Vol: $${formatNumber(event.volume)}`,
        url: event.slug ? `https://polymarket.com/event/${event.slug}` : undefined,
        confidence: parseOdds(topMarket.outcomePrices),
      }];
    });

    return {
      source: "polymarket",
      query: "new",
      timestamp: Date.now(),
      data,
      summary: `${data.length} newest Polymarket events.`,
    };
  } catch (err: any) {
    return emptyResult("new", err?.message ?? "request failed");
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function emptyResult(query: string, reason: string): DataSourceResult {
  return {
    source: "polymarket",
    query,
    timestamp: Date.now(),
    data: [],
    summary: `No Polymarket data (${reason}).`,
  };
}

function extractKeywords(question: string): string {
  const stopWords = new Set([
    "will", "the", "a", "an", "by", "be", "is", "are", "was", "were",
    "to", "of", "in", "for", "on", "at", "this", "that", "it", "its",
    "above", "below", "reach", "hit", "surpass", "exceed",
  ]);
  return question
    .replace(/[?!.,]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !stopWords.has(w.toLowerCase()))
    .slice(0, 6)
    .join(" ");
}

function formatOdds(outcomePrices: any): string {
  if (!outcomePrices) return "N/A";
  try {
    const prices =
      typeof outcomePrices === "string"
        ? JSON.parse(outcomePrices)
        : outcomePrices;
    if (Array.isArray(prices) && prices.length >= 1) {
      return `${Math.round(parseFloat(prices[0]) * 100)}%`;
    }
  } catch {
    // ignore
  }
  return "N/A";
}

function parseOdds(outcomePrices: any): number {
  try {
    const prices =
      typeof outcomePrices === "string"
        ? JSON.parse(outcomePrices)
        : outcomePrices;
    if (Array.isArray(prices) && prices.length >= 1) {
      return parseFloat(prices[0]);
    }
  } catch {
    // ignore
  }
  return 0.5;
}

function formatNumber(n: any): string {
  const num = parseFloat(n);
  if (isNaN(num)) return "0";
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toFixed(0);
}
