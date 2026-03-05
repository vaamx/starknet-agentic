import { NextRequest } from "next/server";
import { z } from "zod";
import { quickResearch } from "@/lib/research-agent";
import type { DataSourceName } from "@/lib/data-sources/index";
import { requireRole } from "@/lib/require-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  getSourceReliabilityProfile,
  type SourceReliabilityBacktestRow,
} from "@/lib/ops-store";

const SourcesSchema = z.array(
  z.enum(["polymarket", "coingecko", "news", "social"])
);

/**
 * Data Sources endpoint.
 * GET ?question=...&sources=polymarket,coingecko
 * Returns aggregated data from all requested sources.
 */
export async function GET(request: NextRequest) {
  const context = requireRole(request, "viewer");
  if (!context) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const rateLimit = checkRateLimit(
    `research:${context.membership.organizationId}:${context.user.id}`,
    {
      windowMs: 60_000,
      max: 30,
      blockMs: 60_000,
    }
  );
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
  let sources: DataSourceName[] | undefined;
  if (sourcesParam) {
    const parsedSources = SourcesSchema.safeParse(
      sourcesParam
        .split(",")
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => entry.length > 0)
    );
    if (!parsedSources.success) {
      return Response.json(
        { error: "Invalid source list. Allowed sources: polymarket, coingecko, news, social" },
        { status: 400 }
      );
    }
    sources = parsedSources.data as DataSourceName[];
  }

  const [results, reliabilityProfile] = await Promise.all([
    quickResearch(question.trim(), sources),
    getSourceReliabilityProfile(context.membership.organizationId).catch(
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
