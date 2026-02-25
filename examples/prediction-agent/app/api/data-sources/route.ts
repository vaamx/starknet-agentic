import { NextRequest } from "next/server";
import { quickResearch } from "@/lib/research-agent";
import type { DataSourceName } from "@/lib/data-sources/index";
import { categorizeMarket } from "@/lib/categories";
import { config } from "@/lib/config";

/**
 * Data Sources endpoint.
 * GET ?question=...&sources=polymarket,coingecko
 * Returns aggregated data from all requested sources.
 */

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

function toSourceList(raw: string): DataSourceName[] {
  const allowed = new Set<string>(ALL_SOURCES);
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part): part is DataSourceName => allowed.has(part));
}

function getDefaultSources(question: string): DataSourceName[] {
  const category = categorizeMarket(question);
  const sources: DataSourceName[] = ["polymarket", "news", "rss", "onchain"];

  if (category === "crypto") {
    sources.push("coingecko", "web");
  } else if (category === "sports") {
    sources.push("espn", "web");
  } else {
    sources.push("web", "social", "github");
  }

  if (config.TAVILY_API_KEY) {
    sources.push("tavily");
  }
  if (config.X_BEARER_TOKEN) {
    sources.push("x");
  }
  if (config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHANNELS) {
    sources.push("telegram");
  }

  return Array.from(new Set(sources));
}

export async function GET(request: NextRequest) {
  const question = request.nextUrl.searchParams.get("question");
  if (!question) {
    return Response.json(
      { error: "Missing 'question' query parameter" },
      { status: 400 }
    );
  }

  const sourcesParam = request.nextUrl.searchParams.get("sources");
  const parsedSources = sourcesParam ? toSourceList(sourcesParam) : [];
  const sources =
    parsedSources.length > 0 ? parsedSources : getDefaultSources(question);

  const results = await quickResearch(question, sources);

  return Response.json({
    question,
    timestamp: Date.now(),
    sourceCount: results.length,
    results,
  });
}
