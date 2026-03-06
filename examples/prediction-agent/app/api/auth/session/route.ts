import { NextRequest } from "next/server";
import { getUserFromSessionToken, sessionCookieName } from "@/lib/auth";
import { getPrimaryMembership } from "@/lib/rbac";
import {
  isManualAuthConfigured,
  readWalletSession,
} from "@/lib/wallet-session";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const sessionToken = request.cookies.get(sessionCookieName())?.value;
  const user = sessionToken ? getUserFromSessionToken(sessionToken) : null;
  const membership = user ? getPrimaryMembership(user.id) : null;

  const configured = isManualAuthConfigured();
  const walletSession = readWalletSession(request);
  if (!configured || !walletSession) {
    return Response.json({
      ok: true,
      configured,
      authenticated: false,
      userAuthenticated: Boolean(user),
      user,
      organization: membership
        ? {
            id: membership.organizationId,
            name: membership.organizationName,
            slug: membership.organizationSlug,
          }
        : null,
      role: membership?.role ?? null,
    });
  }

  return Response.json({
    ok: true,
    configured: true,
    authenticated: true,
    walletAddress: walletSession.walletAddress,
    expiresAt: walletSession.expiresAt,
    scopes: walletSession.scopes,
    userAuthenticated: Boolean(user),
    user,
    organization: membership
      ? {
          id: membership.organizationId,
          name: membership.organizationName,
          slug: membership.organizationSlug,
        }
      : null,
    role: membership?.role ?? null,
  });
}
