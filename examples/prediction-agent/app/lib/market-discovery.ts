/**
 * Market Discovery — Suggests new markets from real-world data sources.
 */

import { fetchPolymarketData } from "./data-sources/polymarket";
import { fetchCryptoPrices } from "./data-sources/crypto-prices";
import { fetchNewsData } from "./data-sources/news-search";
import { fetchRssFeeds } from "./data-sources/rss-feeds";
import { categorizeMarket, type MarketCategory } from "./categories";

export interface SuggestedMarket {
  question: string;
  category: MarketCategory;
  suggestedResolutionDays: number;
  sourceUrl?: string;
  estimatedProbability?: number;
  reasoning?: string;
}

function normalizeQuestion(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  return trimmed.endsWith("?") ? trimmed : `${trimmed}?`;
}

function headlineToQuestion(title: string): string {
  const cleaned = title.replace(/[.!]+$/, "").trim();
  if (/^will\\b/i.test(cleaned)) return normalizeQuestion(cleaned);
  return normalizeQuestion(`Will ${cleaned}`);
}

function extractUsdPrice(value: string): number | null {
  const match = value.match(/\$([\d,]+(?:\.\d+)?)/);
  if (!match) return null;
  const num = parseFloat(match[1].replace(/,/g, ""));
  return isNaN(num) ? null : num;
}

/**
 * Discover suggested markets. Returns a real-data-only set.
 */
export async function discoverMarkets(
  category?: string,
  limit = 8
): Promise<SuggestedMarket[]> {
  const suggestions: SuggestedMarket[] = [];
  const seen = new Set<string>();

  // Polymarket-driven suggestions (real external markets)
  try {
    const poly = await fetchPolymarketData(category ?? "trending");
    for (const item of poly.data) {
      const question = normalizeQuestion(String(item.label));
      if (seen.has(question.toLowerCase())) continue;
      const cat = categorizeMarket(question);
      if (category && cat !== category) continue;
      suggestions.push({
        question,
        category: cat,
        suggestedResolutionDays: 30,
        sourceUrl: item.url,
        estimatedProbability: item.confidence,
        reasoning: poly.summary,
      });
      seen.add(question.toLowerCase());
    }
  } catch {
    // Ignore if Polymarket is unavailable
  }

  // Crypto price-based suggestions (real prices → new questions)
  if (!category || category === "crypto") {
    try {
      const prices = await fetchCryptoPrices("BTC ETH STRK");
      for (const point of prices.data) {
        if (!String(point.label).toLowerCase().includes("price")) continue;
        const price = extractUsdPrice(String(point.value));
        if (!price) continue;
        const token = String(point.label).replace(/\s+Price/i, "").trim();
        const target = Math.round(price * 1.2);
        const question = normalizeQuestion(
          `Will ${token} be above $${target.toLocaleString()} in 60 days`
        );
        if (seen.has(question.toLowerCase())) continue;
        suggestions.push({
          question,
          category: "crypto",
          suggestedResolutionDays: 60,
          reasoning: `Derived from live ${token} price data.`,
        });
        seen.add(question.toLowerCase());
      }
    } catch {
      // Ignore if price data unavailable
    }
  }

  // News-driven suggestions (real headlines)
  if (!category || category === "politics" || category === "tech" || category === "other") {
    try {
      const news = await fetchNewsData(category ?? "breaking news");
      for (const item of news.data) {
        const title = String(item.label || item.value || "").trim();
        if (!title) continue;
        const question = headlineToQuestion(title);
        if (seen.has(question.toLowerCase())) continue;
        const cat = categorizeMarket(question);
        if (category && cat !== category) continue;
        suggestions.push({
          question,
          category: cat,
          suggestedResolutionDays: 14,
          sourceUrl: item.url,
          reasoning: news.summary,
        });
        seen.add(question.toLowerCase());
      }
    } catch {
      // Ignore if news unavailable
    }
  }

  // RSS-driven suggestions (configured feeds)
  if (!category || category === "other") {
    try {
      const rss = await fetchRssFeeds(category ?? "rss");
      for (const item of rss.data) {
        const title = String(item.value || item.label || "").trim();
        if (!title) continue;
        const question = headlineToQuestion(title);
        if (seen.has(question.toLowerCase())) continue;
        suggestions.push({
          question,
          category: categorizeMarket(question),
          suggestedResolutionDays: 21,
          sourceUrl: item.url,
          reasoning: rss.summary,
        });
        seen.add(question.toLowerCase());
      }
    } catch {
      // Ignore if RSS unavailable
    }
  }

  return suggestions.slice(0, limit);
}

/**
 * Get all available categories.
 */
export function getCategories(): string[] {
  return ["crypto", "politics", "sports", "tech", "other"];
}
