/**
 * Unified Data Sources — Aggregates real-world data for agent research.
 *
 * Each source fetches external data and returns empty results
 * when API keys are missing or requests fail.
 */

export interface DataPoint {
  label: string;
  value: string | number;
  url?: string;
  confidence?: number;
}

export interface SourceQuality {
  reliabilityScore: number;
  freshnessScore: number;
  confidenceScore: number;
  coverageScore: number;
  overallScore: number;
  latencyMs: number;
}

export interface DataSourceResult {
  source: string; // "polymarket" | "coingecko" | "news" | "social"
  query: string;
  timestamp: number;
  data: DataPoint[];
  summary: string;
  quality?: SourceQuality;
}

export type DataSourceName =
  | "polymarket"
  | "coingecko"
  | "news"
  | "web"
  | "tavily"
  | "social"
  | "espn"
  | "github"
  | "onchain"
  | "rss"
  | "x"
  | "telegram";

export { fetchPolymarketData } from "./polymarket";
export { fetchCryptoPrices } from "./crypto-prices";
export { fetchTavilySearch } from "./tavily";
export { fetchEspnScores } from "./espn-live";
export { fetchStarknetOnchain } from "./starknet-onchain";
import { fetchPolymarketData } from "./polymarket";
import { fetchCryptoPrices } from "./crypto-prices";
import { fetchNewsData } from "./news-search";
import { fetchWebSearch } from "./web-search";
import { fetchTavilySearch } from "./tavily";
import { fetchSocialTrends } from "./social-trends";
import { fetchEspnScores } from "./espn-live";
import { fetchGithubTrends } from "./github-trends";
import { fetchStarknetOnchain } from "./starknet-onchain";
import { fetchRssFeeds } from "./rss-feeds";
import { fetchXTrends } from "./x-trends";
import { fetchTelegramTrends } from "./telegram-trends";

const SOURCE_FETCHERS: Record<
  DataSourceName,
  (question: string) => Promise<DataSourceResult>
> = {
  polymarket: fetchPolymarketData,
  coingecko: fetchCryptoPrices,
  news: fetchNewsData,
  web: fetchWebSearch,
  tavily: fetchTavilySearch,
  social: fetchSocialTrends,
  espn: fetchEspnScores,
  github: fetchGithubTrends,
  onchain: fetchStarknetOnchain,
  rss: fetchRssFeeds,
  x: fetchXTrends,
  telegram: fetchTelegramTrends,
};

const ALL_SOURCES: DataSourceName[] = [
  "polymarket",
  "coingecko",
  "news",
  "web",
  "tavily",
  "social",
  "espn",
  "github",
  "onchain",
  "rss",
  "x",
  "telegram",
];

const SOURCE_BASELINE_RELIABILITY: Record<DataSourceName, number> = {
  polymarket: 0.82,
  coingecko: 0.87,
  news: 0.68,
  web: 0.64,
  tavily: 0.72,
  social: 0.58,
  espn: 0.84,
  github: 0.79,
  onchain: 0.86,
  rss: 0.66,
  x: 0.57,
  telegram: 0.52,
};

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function scoreConfidence(points: DataPoint[]): number {
  const confidences = points
    .map((point) => point.confidence)
    .filter((value): value is number => typeof value === "number");
  if (confidences.length === 0) return 0.55;
  return clampUnit(
    confidences.reduce((sum, value) => sum + clampUnit(value), 0) /
      confidences.length
  );
}

function scoreCoverage(points: DataPoint[]): number {
  return clampUnit(Math.min(1, points.length / 5));
}

function scoreFreshness(timestamp: number): number {
  const ageMs = Math.max(0, Date.now() - timestamp);
  // 1h half-life style decay for live-market relevance.
  return clampUnit(1 / (1 + ageMs / (60 * 60 * 1000)));
}

function enrichWithQuality(
  source: DataSourceName,
  result: DataSourceResult,
  latencyMs: number
): DataSourceResult {
  const reliabilityScore = SOURCE_BASELINE_RELIABILITY[source];
  const freshnessScore = scoreFreshness(result.timestamp);
  const confidenceScore = scoreConfidence(result.data);
  const coverageScore = scoreCoverage(result.data);
  const overallScore = clampUnit(
    reliabilityScore * 0.4 +
      freshnessScore * 0.25 +
      confidenceScore * 0.2 +
      coverageScore * 0.15
  );

  return {
    ...result,
    quality: {
      reliabilityScore,
      freshnessScore,
      confidenceScore,
      coverageScore,
      overallScore,
      latencyMs,
    },
  };
}

export function averageResearchQuality(results: DataSourceResult[]): number {
  if (results.length === 0) return 0.5;
  const scores = results
    .map((result) => result.quality?.overallScore)
    .filter((value): value is number => typeof value === "number");
  if (scores.length === 0) return 0.5;
  return (
    scores.reduce((sum, score) => sum + clampUnit(score), 0) / scores.length
  );
}

/**
 * Gather research from multiple data sources in parallel.
 * Returns results from all requested sources (defaults to all).
 */
export async function gatherResearch(
  question: string,
  sources?: DataSourceName[]
): Promise<DataSourceResult[]> {
  const selectedSources = sources ?? ALL_SOURCES;

  const results = await Promise.allSettled(
    selectedSources.map(async (source) => {
      const fetcher = SOURCE_FETCHERS[source];
      const startedAt = Date.now();
      const result = await fetcher(question);
      return enrichWithQuality(source, result, Date.now() - startedAt);
    })
  );

  return results
    .filter(
      (r): r is PromiseFulfilledResult<DataSourceResult> =>
        r.status === "fulfilled"
    )
    .map((r) => r.value);
}

/**
 * Build a concise research brief from data source results for injection into Claude prompts.
 */
export function buildResearchBrief(results: DataSourceResult[]): string {
  if (results.length === 0) return "";

  const sections = results.map((r) => {
    const quality = r.quality;
    const qualityLine = quality
      ? `Quality ${(quality.overallScore * 100).toFixed(0)}% (reliability ${(quality.reliabilityScore * 100).toFixed(0)}%, freshness ${(quality.freshnessScore * 100).toFixed(0)}%, confidence ${(quality.confidenceScore * 100).toFixed(0)}%)`
      : "Quality unavailable";
    const points = r.data
      .slice(0, 5)
      .map((d) => `  - ${d.label}: ${d.value}`)
      .join("\n");
    return `### ${r.source.toUpperCase()} Data\n${qualityLine}\n${r.summary}\n${points}`;
  });

  return `## Real-World Research Data (gathered ${new Date().toISOString()})\n\n${sections.join("\n\n")}`;
}
