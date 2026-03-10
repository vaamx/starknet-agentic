/**
 * Resolution Oracle API
 * POST /api/resolve
 *
 * Attempts to auto-resolve a prediction market using AI oracle.
 * Strategy selected by market category (sports/crypto/general).
 * Reasoning is logged on-chain in Huginn Registry for provenance.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { tryResolveMarket } from "@/lib/resolution-oracle";
import { requireAuth } from "@/lib/require-auth";

// Oracle involves an Anthropic API call + on-chain transactions — needs extended timeout.
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  // Require either a valid session or the heartbeat secret
  const secret = process.env.HEARTBEAT_SECRET;
  const authHeader = request.headers.get("authorization");
  const user = await requireAuth(request);
  const hasSecretAuth = secret && authHeader === `Bearer ${secret}`;
  if (!user && !hasSecretAuth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const resolveSchema = z.object({
    marketId: z.number().int().min(0),
    marketAddress: z.string().regex(/^0x[0-9a-fA-F]{1,64}$/).optional(),
    question: z.string().min(1).max(1000).optional(),
  });

  let marketId: number;
  let marketAddress: string | undefined;
  let question: string | undefined;
  try {
    const body = resolveSchema.parse(await request.json());
    marketId = body.marketId;
    marketAddress = body.marketAddress;
    question = body.question;
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: "Invalid request body", details: err?.issues ?? err?.message }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  let result;
  try {
    result = await tryResolveMarket(marketId, marketAddress ?? "", question ?? "");
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
