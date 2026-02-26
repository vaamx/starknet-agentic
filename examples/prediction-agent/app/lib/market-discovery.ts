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

const LEGACY_SUFFIX_REGEX = /\s+\d+d\s+[0-9a-f]{4}$/i;
const GARBLED_SUFFIX_REGEX = /\s+[a-z]?\d[a-z0-9]{2,}$/i;
const TRAILING_TIME_HASH_REGEX = /\s+\d{1,3}d\s+[0-9a-f]{4,8}$/i;
const TRAILING_HASH_REGEX = /\s+[0-9a-f]{4,8}$/i;
const TRAILING_FRAGMENT_REGEX = /\s+(?:in|i|win|t|clo)$/i;
const GENERIC_PREDICATE_END_REGEX = /\b(?:win|lose|reach|hit|close|rise|fall)\?$/i;

function isValidMarketQuestion(question: string): boolean {
  const normalized = question.trim();
  if (normalized.length < 18 || normalized.length > 180) return false;
  if (!/[a-z]/i.test(normalized)) return false;
  if (!normalized.endsWith("?")) return false;
  if (normalized.startsWith("Market #")) return false;
  if (/^spread:/i.test(normalized)) return false;
  if (/\(-?\d+(?:\.\d+)?\)/.test(normalized)) return false;
  if (LEGACY_SUFFIX_REGEX.test(normalized)) return false;
  if (TRAILING_TIME_HASH_REGEX.test(normalized)) return false;
  if (/\bwin t\b/i.test(normalized)) return false;
  if (TRAILING_FRAGMENT_REGEX.test(normalized.replace(/\?$/, ""))) return false;
  if (GENERIC_PREDICATE_END_REGEX.test(normalized)) return false;
  if (GARBLED_SUFFIX_REGEX.test(normalized) && !/\d{4}/.test(normalized)) {
    return false;
  }
  const words = normalized.split(/\s+/);
  return words.length >= 4;
}

function normalizeQuestion(text: string): string {
  const cleaned = text
    .replace(LEGACY_SUFFIX_REGEX, "")
    .replace(TRAILING_TIME_HASH_REGEX, "")
    .replace(TRAILING_HASH_REGEX, "")
    .replace(/\bwin t\b/gi, "win")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  return cleaned.endsWith("?") ? cleaned : `${cleaned}?`;
}

function questionFingerprint(question: string): string {
  return normalizeQuestion(question)
    .toLowerCase()
    .replace(LEGACY_SUFFIX_REGEX, "")
    .replace(TRAILING_TIME_HASH_REGEX, "")
    .replace(TRAILING_HASH_REGEX, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bwill\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function headlineToQuestion(title: string): string {
  const cleaned = title.replace(/[.!]+$/, "").trim();
  if (/^will\b/i.test(cleaned)) return normalizeQuestion(cleaned);
  if (/^(who|which|what|when|how)\b/i.test(cleaned)) {
    return normalizeQuestion(cleaned);
  }
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

function getPolymarketQueries(
  requestedCategory: string
): string[] {
  if (requestedCategory === "politics") {
    return ["us election politics regulation"];
  }
  if (requestedCategory === "sports") {
    return ["sports championship odds"];
  }
  if (requestedCategory === "tech") {
    return ["ai technology earnings policy"];
  }
  if (requestedCategory === "crypto") {
    return ["crypto bitcoin ethereum"];
  }
  if (requestedCategory === "other") {
    return ["world economy geopolitics"];
  }
  return [
    "us politics election",
    "sports championship",
    "technology ai",
    "world economy geopolitics",
  ];
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
    if (!question || !isValidMarketQuestion(question)) return;
    const key = questionFingerprint(question);
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
  const polymarketQueries = getPolymarketQueries(requestedCategory);
  const polymarketResults = await Promise.allSettled(
    polymarketQueries.map((query) => fetchPolymarketData(query))
  );
  for (const settled of polymarketResults) {
    if (settled.status !== "fulfilled") continue;
    const poly = settled.value;
    for (const item of poly.data) {
      const question = normalizeQuestion(String(item.label));
      const cat = categorizeMarket(question);
      pushSuggestion({
        question,
        category: cat,
        suggestedResolutionDays:
          cat === "sports" ? 10 : cat === "politics" ? 21 : 30,
        sourceUrl: item.url,
        estimatedProbability: item.confidence,
        reasoning: poly.summary,
      });
    }
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
        if (!question) continue;
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
        if (!question) continue;
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

  // Preserve topic diversity by enforcing a non-crypto floor when category is auto.
  if (!requestedCategory) {
    const selected: SuggestedMarket[] = [];
    const selectedKeys = new Set<string>();

    const byCategory: Record<
      "politics" | "sports" | "tech" | "other" | "crypto",
      SuggestedMarket[]
    > = {
      politics: [],
      sports: [],
      tech: [],
      other: [],
      crypto: [],
    };
    for (const entry of scored) {
      const category = entry.suggestion.category === "all" ? "other" : entry.suggestion.category;
      byCategory[category].push(entry.suggestion);
    }

    const take = (candidate?: SuggestedMarket): boolean => {
      if (!candidate) return false;
      const key = questionFingerprint(candidate.question);
      if (!key || selectedKeys.has(key)) return false;
      selected.push(candidate);
      selectedKeys.add(key);
      return true;
    };

    const nonCryptoCategories: Array<"politics" | "sports" | "tech" | "other"> = [
      "politics",
      "sports",
      "tech",
      "other",
    ];
    const availableNonCrypto = nonCryptoCategories.reduce(
      (sum, cat) => sum + byCategory[cat].length,
      0
    );
    const nonCryptoFloor = Math.min(
      availableNonCrypto,
      Math.max(0, Math.ceil(limit * 0.7))
    );

    while (selected.length < nonCryptoFloor) {
      let added = false;
      for (const cat of nonCryptoCategories) {
        const candidate = byCategory[cat].shift();
        if (take(candidate)) {
          added = true;
          if (selected.length >= nonCryptoFloor) break;
        }
      }
      if (!added) break;
    }

    const remaining = scored.map((entry) => entry.suggestion);
    for (const candidate of remaining) {
      if (selected.length >= limit) break;
      take(candidate);
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
