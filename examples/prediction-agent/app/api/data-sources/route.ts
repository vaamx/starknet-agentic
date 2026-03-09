import { NextRequest } from "next/server";
import { z } from "zod";
import { quickResearch } from "@/lib/research-agent";
import type { DataSourceName } from "@/lib/data-sources/index";
import { categorizeMarket } from "@/lib/categories";
import { config } from "@/lib/config";
import { requireRole } from "@/lib/require-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  getSourceReliabilityProfile,
  type SourceReliabilityBacktestRow,
} from "@/lib/ops-store";

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
  // Auth is optional — unauthenticated users get a looser IP-based rate limit
  const context = requireRole(request, "viewer");

  const rateLimitKey = context
    ? `research:${context.membership.organizationId}:${context.user.id}`
    : `research:anon:${request.headers.get("x-forwarded-for") ?? "unknown"}`;

  const rateLimit = checkRateLimit(rateLimitKey, {
    windowMs: 60_000,
    max: context ? 30 : 10,
    blockMs: 60_000,
  });
  if (!rateLimit.allowed) {
    return Response.json(
      { error: "Rate limit exceeded for research requests" },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(rateLimit.retryAfterMs / 1000)),
        },
      }
    );
  }

  const question = request.nextUrl.searchParams.get("question");
  if (!question || question.trim().length < 5 || question.trim().length > 280) {
    return Response.json(
      { error: "Question must be between 5 and 280 characters" },
      { status: 400 }
    );
  }

  const sourcesParam = request.nextUrl.searchParams.get("sources");
  const parsedSources = sourcesParam ? toSourceList(sourcesParam) : [];
  const sources =
    parsedSources.length > 0 ? parsedSources : getDefaultSources(question);

  const orgId = context?.membership?.organizationId ?? "default";
  const [results, reliabilityProfile] = await Promise.all([
    quickResearch(question.trim(), sources),
    getSourceReliabilityProfile(orgId).catch(
      (): Record<string, SourceReliabilityBacktestRow> => ({})
    ),
  ]);

  const enriched = results.map((result) => ({
    ...result,
    backtest: reliabilityProfile[result.source.toLowerCase()] ?? null,
  }));

  return Response.json({
    question: question.trim(),
    timestamp: Date.now(),
    sourceCount: enriched.length,
    results: enriched,
  });
}
