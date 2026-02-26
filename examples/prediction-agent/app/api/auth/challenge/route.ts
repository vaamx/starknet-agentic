import { NextRequest } from "next/server";
import { z } from "zod";
import { enforceRateLimit, jsonError } from "@/lib/api-guard";
import { issueNetworkAuthChallenge } from "@/lib/network-auth";
import { isStarknetAddress, normalizeWalletAddress } from "@/lib/agent-network";
import {
  isManualAuthConfigured,
  MANUAL_AUTH_SCOPES,
  normalizeManualAuthScopes,
} from "@/lib/wallet-session";

export const runtime = "nodejs";

const challengeSchema = z.object({
  walletAddress: z.string().trim().min(4).max(120),
  ttlSecs: z.number().int().min(30).max(600).optional(),
  scopes: z.array(z.enum(MANUAL_AUTH_SCOPES)).min(1).max(3).optional(),
});

export async function POST(request: NextRequest) {
  const rateLimited = await enforceRateLimit(request, "manual_auth_challenge", {
    windowMs: 60_000,
    maxRequests: 30,
  });
  if (rateLimited) return rateLimited;

  if (!isManualAuthConfigured()) {
    return jsonError(
      "Manual auth is not configured (set MANUAL_AUTH_SECRET or HEARTBEAT_SECRET)",
      503
    );
  }

  let body: z.infer<typeof challengeSchema>;
  try {
    body = challengeSchema.parse(await request.json());
  } catch (err: any) {
    return jsonError("Invalid challenge payload", 400, err?.issues ?? err?.message);
  }

  const walletAddress = normalizeWalletAddress(body.walletAddress);
  if (!isStarknetAddress(walletAddress)) {
    return jsonError("walletAddress must be a valid Starknet address", 400);
  }

  const payload = {
    purpose: "manual_ui_session",
    walletAddress,
    scopes: normalizeManualAuthScopes(body.scopes),
  };

  try {
    const issued = await issueNetworkAuthChallenge({
      action: "manual_session",
      walletAddress,
      payload,
      ttlSecs: body.ttlSecs,
    });

    return Response.json({
      ok: true,
      challenge: {
        id: issued.challenge.id,
        walletAddress: issued.challenge.walletAddress,
        expiresAt: issued.challenge.expiresAt,
        typedData: issued.typedData,
      },
      payload,
    });
  } catch (err: any) {
    return jsonError("Failed to issue wallet challenge", 400, err?.message ?? String(err));
  }
}
