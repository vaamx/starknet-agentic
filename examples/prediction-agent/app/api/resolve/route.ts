/**
 * Resolution Oracle API
 * POST /api/resolve
 *
 * Attempts to auto-resolve a prediction market using AI oracle.
 * Strategy selected by market category (sports/crypto/general).
 * Reasoning is logged on-chain in Huginn Registry for provenance.
 */

import { NextRequest } from "next/server";
import { tryResolveMarket } from "@/lib/resolution-oracle";

// Oracle involves an Anthropic API call + on-chain transactions — needs extended timeout.
export const maxDuration = 60;

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

  const { marketId, marketAddress, question } = body as {
    marketId?: number;
    marketAddress?: string;
    question?: string;
  };

  if (typeof marketId !== "number" || !marketAddress || !question) {
    return new Response(
      JSON.stringify({ error: "marketId (number), marketAddress, and question are required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  let result;
  try {
    result = await tryResolveMarket(marketId, marketAddress, question);
  } catch (err: any) {
    // tryResolveMarket is documented as "never throws", but starknet.js network
    // calls and the Anthropic SDK can both throw outside the internal catch blocks.
    const msg = err?.message ?? String(err);
    console.error("[resolve] Unexpected throw from tryResolveMarket:", msg);
    return new Response(
      JSON.stringify({ status: "error", error: msg }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const statusCode = result.status === "error" ? 500 : 200;

  return new Response(JSON.stringify(result, null, 2), {
    status: statusCode,
    headers: { "Content-Type": "application/json" },
  });
}
