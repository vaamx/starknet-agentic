/**
 * Market Discovery — Suggests new markets from real-world data sources.
 */

import { fetchPolymarketData } from "./data-sources/polymarket";
import { fetchCryptoPrices } from "./data-sources/crypto-prices";
import { fetchNewsData } from "./data-sources/news-search";
import { fetchRssFeeds } from "./data-sources/rss-feeds";
import { fetchEspnScores } from "./data-sources/espn-live";
import type { DataPoint } from "./data-sources";
import {
  categorizeMarket,
  estimateEngagementScore,
  type MarketCategory,
} from "./categories";

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

function buildSportsQuestionFromEspn(result: {
  summary: string;
  data: DataPoint[];
}): string | null {
  const teamRows = result.data.filter((point) =>
    /\(home\)|\(away\)/i.test(point.label)
  );
  if (teamRows.length < 2) return null;

  const teamNames = teamRows
    .map((point) => point.label.replace(/\s+\((home|away)\)/i, "").trim())
    .filter(Boolean);
  if (teamNames.length < 2) return null;

  const [teamA, teamB] = teamNames;
  const summary = result.summary.toLowerCase();
  if (summary.includes("final:")) return null;
  if (summary.includes("live:")) {
    return normalizeQuestion(`Will ${teamA} beat ${teamB} in this NFL game`);
  }
  return normalizeQuestion(`Will ${teamA} beat ${teamB} in their next NFL matchup`);
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
  const requestedCategory = (category ?? "").trim().toLowerCase();

  const pushSuggestion = (suggestion: SuggestedMarket) => {
    const question = normalizeQuestion(suggestion.question);
    const key = question.toLowerCase();
    if (seen.has(key)) return;
    if (
      requestedCategory &&
      requestedCategory !== "all" &&
      suggestion.category !== requestedCategory
    ) {
      return;
    }
    seen.add(key);
    suggestions.push({
      ...suggestion,
      question,
    });
  };

  // Polymarket-driven suggestions (real external markets)
  try {
    const poly = await fetchPolymarketData(category ?? "trending");
    for (const item of poly.data) {
      const question = normalizeQuestion(String(item.label));
      const cat = categorizeMarket(question);
      pushSuggestion({
        question,
        category: cat,
        suggestedResolutionDays: 30,
        sourceUrl: item.url,
        estimatedProbability: item.confidence,
        reasoning: poly.summary,
      });
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
        pushSuggestion({
          question,
          category: "crypto",
          suggestedResolutionDays: 60,
          reasoning: `Derived from live ${token} price data.`,
        });
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
        const cat = categorizeMarket(question);
        pushSuggestion({
          question,
          category: cat,
          suggestedResolutionDays: 14,
          sourceUrl: item.url,
          reasoning: news.summary,
        });
      }
    } catch {
      // Ignore if news unavailable
    }
  }

  // Sports suggestions from live/upcoming ESPN data.
  if (!category || category === "sports") {
    try {
      const espn = await fetchEspnScores("NFL live games");
      const question = buildSportsQuestionFromEspn(espn);
      if (question) {
        pushSuggestion({
          question,
          category: "sports",
          suggestedResolutionDays: 7,
          reasoning: espn.summary,
        });
      }
    } catch {
      // Ignore ESPN failures.
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
        pushSuggestion({
          question,
          category: categorizeMarket(question),
          suggestedResolutionDays: 21,
          sourceUrl: item.url,
          reasoning: rss.summary,
        });
      }
    } catch {
      // Ignore if RSS unavailable
    }
  }

  // Score for engagement and reduce crypto saturation in mixed mode.
  const scored = suggestions
    .map((suggestion) => {
      const resolutionTime =
        Math.floor(Date.now() / 1000) +
        Math.max(1, suggestion.suggestedResolutionDays) * 86_400;
      let score = estimateEngagementScore(suggestion.question, resolutionTime);
      if (!requestedCategory && suggestion.category === "crypto") {
        score -= 0.08;
      }
      if (
        suggestion.category === "politics" ||
        suggestion.category === "sports" ||
        suggestion.category === "tech"
      ) {
        score += 0.04;
      }
      return { suggestion, score };
    })
    .sort((a, b) => b.score - a.score);

  // Preserve topic diversity by alternating highest-ranked non-crypto with any.
  if (!requestedCategory) {
    const nonCrypto = scored.filter((entry) => entry.suggestion.category !== "crypto");
    const remaining = scored.slice();
    const selected: SuggestedMarket[] = [];
    while (selected.length < limit && remaining.length > 0) {
      const pickFromNonCrypto =
        selected.filter((s) => s.category === "crypto").length >=
        Math.floor(selected.length / 2);
      let pickedIdx = -1;
      if (pickFromNonCrypto && nonCrypto.length > 0) {
        const candidate = nonCrypto.find((entry) =>
          !selected.some((s) => s.question.toLowerCase() === entry.suggestion.question.toLowerCase())
        );
        if (candidate) {
          pickedIdx = remaining.findIndex(
            (entry) => entry.suggestion.question === candidate.suggestion.question
          );
        }
      }
      if (pickedIdx < 0) pickedIdx = 0;
      const [picked] = remaining.splice(pickedIdx, 1);
      if (!picked) break;
      selected.push(picked.suggestion);
    }
    return selected.slice(0, limit);
  }

  return scored.map((entry) => entry.suggestion).slice(0, limit);
}

/**
 * Get all available categories.
 */
export function getCategories(): string[] {
  return ["crypto", "politics", "sports", "tech", "other"];
}
