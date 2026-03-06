import { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const { getUserFromSessionToken, sessionCookieName } = await import("@/lib/auth");
    const { getPrimaryMembership } = await import("@/lib/rbac");
    const { isManualAuthConfigured, readWalletSession } = await import("@/lib/wallet-session");

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
  } catch (err: any) {
    console.error("[auth/session] Init error:", err.message);
    return Response.json({
      ok: true,
      configured: false,
      authenticated: false,
      userAuthenticated: false,
      user: null,
      organization: null,
      role: null,
    });
  }
}
