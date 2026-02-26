import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { enforceRateLimit, jsonError } from "@/lib/api-guard";
import { verifyNetworkAuthEnvelope } from "@/lib/network-auth";
import { isStarknetAddress, normalizeWalletAddress } from "@/lib/agent-network";
import {
  issueWalletSessionToken,
  isManualAuthConfigured,
  setWalletSessionCookie,
} from "@/lib/wallet-session";

export const runtime = "nodejs";

const verifySchema = z.object({
  walletAddress: z.string().trim().min(4).max(120),
  auth: z.object({
    challengeId: z.string().trim().min(3).max(180),
    walletAddress: z.string().trim().min(4).max(120),
    signature: z.array(z.string().trim().min(1)).min(1),
  }),
});

export async function POST(request: NextRequest) {
  const rateLimited = await enforceRateLimit(request, "manual_auth_verify", {
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

  let body: z.infer<typeof verifySchema>;
  try {
    body = verifySchema.parse(await request.json());
  } catch (err: any) {
    return jsonError("Invalid verify payload", 400, err?.issues ?? err?.message);
  }

  const walletAddress = normalizeWalletAddress(body.walletAddress);
  if (!isStarknetAddress(walletAddress)) {
    return jsonError("walletAddress must be a valid Starknet address", 400);
  }

  const payload = {
    purpose: "manual_ui_session",
    walletAddress,
  };

  const authResult = await verifyNetworkAuthEnvelope({
    action: "manual_session",
    payload,
    auth: {
      challengeId: body.auth.challengeId,
      walletAddress: body.auth.walletAddress,
      signature: body.auth.signature,
    },
    expectedWalletAddress: walletAddress,
  });

  if (!authResult.ok) {
    return jsonError(authResult.error, authResult.status);
  }

  try {
    const { token, payload: session } = issueWalletSessionToken(walletAddress);
    const response = NextResponse.json({
      ok: true,
      walletAddress: session.walletAddress,
      expiresAt: session.expiresAt,
    });
    setWalletSessionCookie(response, token);
    return response;
  } catch (err: any) {
    return jsonError("Failed to create auth session", 500, err?.message ?? String(err));
  }
}

