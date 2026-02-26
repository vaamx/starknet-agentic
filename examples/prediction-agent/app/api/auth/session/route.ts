import { NextRequest } from "next/server";
import {
  isManualAuthConfigured,
  readWalletSession,
} from "@/lib/wallet-session";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const configured = isManualAuthConfigured();
  const session = readWalletSession(request);
  if (!configured || !session) {
    return Response.json({
      ok: true,
      configured,
      authenticated: false,
    });
  }

  return Response.json({
    ok: true,
    configured: true,
    authenticated: true,
    walletAddress: session.walletAddress,
    expiresAt: session.expiresAt,
    scopes: session.scopes,
  });
}
