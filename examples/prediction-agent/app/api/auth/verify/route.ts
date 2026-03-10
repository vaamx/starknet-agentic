import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { enforceRateLimit, jsonError } from "@/lib/api-guard";
import { verifyNetworkAuthEnvelope } from "@/lib/network-auth";
import { isStarknetAddress, normalizeWalletAddress } from "@/lib/agent-network";
import {
  issueWalletSessionToken,
  isManualAuthConfigured,
  MANUAL_AUTH_SCOPES,
  normalizeManualAuthScopes,
  setWalletSessionCookie,
} from "@/lib/wallet-session";
import { getUserFromSessionToken, sessionCookieName } from "@/lib/auth";
import { getPrismaClient } from "@/lib/prisma";

export const runtime = "nodejs";

const verifySchema = z.object({
  walletAddress: z.string().trim().min(4).max(120),
  scopes: z.array(z.enum(MANUAL_AUTH_SCOPES)).min(1).max(3).optional(),
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
    scopes: normalizeManualAuthScopes(body.scopes),
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
    const { token, payload: session } = issueWalletSessionToken(
      walletAddress,
      payload.scopes
    );

    // Auto-link wallet to user account if logged in
    try {
      const sessionToken = request.cookies.get(sessionCookieName())?.value;
      const user = sessionToken ? await getUserFromSessionToken(sessionToken) : null;
      if (user) {
        const prisma = await getPrismaClient();
        if (prisma) {
          const now = Math.floor(Date.now() / 1000);
          const addr = session.walletAddress.toLowerCase();

          // Check the wallet isn't owned by another user
          const existing = await prisma.userWallet.findUnique({
            where: { walletAddress: addr },
          });
          if (!existing || existing.userId === user.id) {
            const walletCount = await prisma.userWallet.count({ where: { userId: user.id } });
            await prisma.userWallet.upsert({
              where: { userId_walletAddress: { userId: user.id, walletAddress: addr } },
              update: { lastUsedAt: now, verifiedAt: now },
              create: {
                id: `uw_${randomBytes(12).toString("hex")}`,
                userId: user.id,
                walletAddress: addr,
                provider: "starknet",
                isPrimary: walletCount === 0,
                chainId: "SN_SEPOLIA",
                verifiedAt: now,
                lastUsedAt: now,
                createdAt: now,
              },
            });
          }
        }
      }
    } catch {
      // Non-blocking — wallet linking is best-effort
    }

    const response = NextResponse.json({
      ok: true,
      walletAddress: session.walletAddress,
      expiresAt: session.expiresAt,
      scopes: session.scopes,
    });
    setWalletSessionCookie(response, token);
    return response;
  } catch (err: any) {
    return jsonError("Failed to create auth session", 500, err?.message ?? String(err));
  }
}
