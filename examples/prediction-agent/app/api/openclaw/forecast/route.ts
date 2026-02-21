/**
 * OpenClaw A2A Inbound Forecast Submission
 * POST /api/openclaw/forecast
 *
 * External agents submit forecasts to our markets.
 * Validated, stored in-memory, optionally logged to Huginn.
 */

import { NextRequest } from "next/server";
import { MARKET_QUESTIONS } from "@/lib/market-reader";
import { logThoughtOnChain } from "@/lib/huginn-executor";

export interface ExternalForecast {
  agentName: string;
  agentCardUrl?: string;
  probability: number;
  reasoning?: string;
  thoughtHash?: string;
  receivedAt: number;
}

// In-memory store: marketId → array of external forecasts
const externalForecasts = new Map<number, ExternalForecast[]>();

/** Get stored external forecasts for a market (for consensus use). */
export function getExternalForecasts(marketId: number): ExternalForecast[] {
  return externalForecasts.get(marketId) ?? [];
}

/** Compute a simple average of external forecasts for a market. */
export function getExternalConsensus(marketId: number): number | null {
  const forecasts = externalForecasts.get(marketId);
  if (!forecasts || forecasts.length === 0) return null;
  return forecasts.reduce((sum, f) => sum + f.probability, 0) / forecasts.length;
}

export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { question, probability, agentName, agentCardUrl, reasoning } = body as {
    question?: string;
    probability?: number;
    agentName?: string;
    agentCardUrl?: string;
    reasoning?: string;
  };

  // Validate probability
  if (typeof probability !== "number" || probability < 0 || probability > 1) {
    return new Response(
      JSON.stringify({ error: "probability must be a number in [0, 1]" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!agentName) {
    return new Response(
      JSON.stringify({ error: "agentName is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Fuzzy-match question to a market ID
  let matchedMarketId: number | null = null;
  if (question) {
    const questionLower = question.toLowerCase();
    let bestScore = 0;

    for (const [id, mq] of Object.entries(MARKET_QUESTIONS)) {
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
        matchedMarketId = Number(id);
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
    agentName,
    agentCardUrl,
    probability,
    reasoning,
    thoughtHash,
    receivedAt: Date.now(),
  };

  if (matchedMarketId !== null) {
    const existing = externalForecasts.get(matchedMarketId) ?? [];
    // Deduplicate by agentName — keep only latest from each agent
    const filtered = existing.filter((f) => f.agentName !== agentName);
    externalForecasts.set(matchedMarketId, [...filtered, forecast]);
  }

  // Compute weighted consensus (simple average across all sources)
  const weightedConsensus =
    matchedMarketId !== null
      ? getExternalConsensus(matchedMarketId)
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
