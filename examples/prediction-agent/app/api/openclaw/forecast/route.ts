/**
 * OpenClaw A2A Inbound Forecast Submission
 * POST /api/openclaw/forecast
 *
 * External agents submit forecasts to our markets.
 * Validated, persisted in local state store, optionally logged to Huginn.
 */

import { NextRequest } from "next/server";
import {
  MARKET_QUESTIONS,
  getMarkets,
  resolveMarketQuestion,
} from "@/lib/market-reader";
import { logThoughtOnChain } from "@/lib/huginn-executor";
import { config } from "@/lib/config";
import { z } from "zod";
import { enforceRateLimit, jsonError } from "@/lib/api-guard";
import {
  getPersistedExternalForecasts,
  upsertPersistedExternalForecast,
} from "@/lib/state-store";

export const runtime = "nodejs";

export interface ExternalForecast {
  agentName: string;
  agentCardUrl?: string;
  probability: number;
  reasoning?: string;
  thoughtHash?: string;
  receivedAt: number;
}

const inboundForecastSchema = z.object({
  question: z.string().trim().min(3).max(500).optional(),
  probability: z.number().min(0).max(1),
  agentName: z.string().trim().min(1).max(80),
  agentCardUrl: z.string().url().optional(),
  reasoning: z.string().trim().min(3).max(5000).optional(),
});

/** Get stored external forecasts for a market (for consensus use). */
export async function getExternalForecasts(
  marketId: number
): Promise<ExternalForecast[]> {
  return await getPersistedExternalForecasts(
    marketId,
    config.openclawForecastTtlHours
  );
}

/** Compute a simple average of external forecasts for a market. */
export async function getExternalConsensus(
  marketId: number
): Promise<number | null> {
  const forecasts = await getExternalForecasts(marketId);
  if (!forecasts || forecasts.length === 0) return null;
  return forecasts.reduce((sum, f) => sum + f.probability, 0) / forecasts.length;
}

export async function POST(request: NextRequest) {
  const rateLimited = await enforceRateLimit(request, "openclaw_forecast", {
    windowMs: 60_000,
    maxRequests: 60,
  });
  if (rateLimited) return rateLimited;

  let body: z.infer<typeof inboundForecastSchema>;
  try {
    body = inboundForecastSchema.parse(await request.json());
  } catch {
    return jsonError("Invalid JSON body", 400);
  }
  const { question, probability, agentName, agentCardUrl, reasoning } = body;

  // Fuzzy-match question to a market ID
  let matchedMarketId: number | null = null;
  if (question) {
    const questionByMarketId = new Map<number, string>();
    for (const [id, mq] of Object.entries(MARKET_QUESTIONS)) {
      questionByMarketId.set(Number(id), mq);
    }
    try {
      const markets = await getMarkets();
      for (const market of markets) {
        questionByMarketId.set(
          market.id,
          resolveMarketQuestion(market.id, market.questionHash)
        );
      }
    } catch {
      // Best-effort hydration only.
    }

    const questionLower = question.toLowerCase();
    let bestScore = 0;

    for (const [id, mq] of questionByMarketId.entries()) {
      const mqLower = mq.toLowerCase();
      // Count matching words of 3+ chars (>= 3 captures tickers like ETH, BTC, NFL, NBA
      // that would be missed by the previous > 3 filter).
      const qWords = new Set(questionLower.split(/\W+/).filter((w) => w.length >= 3));
      const mqWords = mqLower.split(/\W+/).filter((w) => w.length >= 3);
      const overlap = mqWords.filter((w) => qWords.has(w)).length;
      // Require at least 2 matching words to avoid false positives from single
      // common words ("the", "will", "will") accidentally matching a market.
      if (overlap >= 2 && overlap > bestScore) {
        bestScore = overlap;
        matchedMarketId = id;
      }
    }
  }

  // Optionally log reasoning to Huginn
  let thoughtHash: string | undefined;
  if (reasoning) {
    try {
      const huginnResult = await logThoughtOnChain(reasoning);
      if (huginnResult.thoughtHash) {
        thoughtHash = huginnResult.thoughtHash;
      }
    } catch {
      // Non-blocking
    }
  }

  const forecast: ExternalForecast = {
    agentName: agentName.trim(),
    agentCardUrl,
    probability,
    reasoning,
    thoughtHash,
    receivedAt: Date.now(),
  };

  if (matchedMarketId !== null) {
    await upsertPersistedExternalForecast(
      matchedMarketId,
      forecast,
      config.openclawForecastTtlHours
    );
  }

  // Compute weighted consensus (simple average across all sources)
  const weightedConsensus =
    matchedMarketId !== null
      ? await getExternalConsensus(matchedMarketId)
      : null;

  return new Response(
    JSON.stringify({
      status: "accepted",
      matchedMarketId,
      probability,
      thoughtHash,
      weightedConsensus,
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}

// Handle CORS preflight
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
