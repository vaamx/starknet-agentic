import { NextRequest } from "next/server";
import { z } from "zod";
import { enforceRateLimit, jsonError } from "@/lib/api-guard";
import {
  issueNetworkAuthChallenge,
} from "@/lib/network-auth";
import {
  type PersistedNetworkAuthAction,
} from "@/lib/state-store";

export const runtime = "nodejs";

const challengeSchema = z.object({
  action: z.enum(["register_agent", "update_agent", "post_contribution"] as const),
  walletAddress: z.string().trim().min(4).max(120),
  payload: z.unknown(),
  ttlSecs: z.number().int().min(30).max(600).optional(),
});

export async function POST(request: NextRequest) {
  const rateLimited = await enforceRateLimit(request, "network_auth_challenge", {
    windowMs: 60_000,
    maxRequests: 90,
  });
  if (rateLimited) return rateLimited;

  let body: z.infer<typeof challengeSchema>;
  try {
    body = challengeSchema.parse(await request.json());
  } catch (err: any) {
    return jsonError("Invalid auth challenge payload", 400, err?.issues ?? err?.message);
  }

  try {
    const issued = await issueNetworkAuthChallenge({
      action: body.action as PersistedNetworkAuthAction,
      walletAddress: body.walletAddress,
      payload: body.payload,
      ttlSecs: body.ttlSecs,
    });

    return Response.json({
      ok: true,
      challenge: {
        id: issued.challenge.id,
        action: issued.challenge.action,
        walletAddress: issued.challenge.walletAddress,
        payloadHash: issued.challenge.payloadHash,
        nonce: issued.challenge.nonce,
        expirySec: issued.challenge.expirySec,
        expiresAt: issued.challenge.expiresAt,
        typedData: issued.typedData,
      },
    });
  } catch (err: any) {
    return jsonError("Failed to issue auth challenge", 400, err?.message ?? String(err));
  }
}
