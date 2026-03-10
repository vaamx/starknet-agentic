import { NextRequest } from "next/server";

export const runtime = "nodejs";

async function getUserProfile(userId: string): Promise<{
  onboardingCompleted: boolean;
  interests: string[];
  wallets: Array<{
    walletAddress: string;
    provider: string;
    label: string | null;
    isPrimary: boolean;
    chainId: string;
    lastUsedAt: number;
  }>;
} | null> {
  try {
    const { getPrismaClient } = await import("@/lib/prisma");
    const prisma = await getPrismaClient();
    if (!prisma) return null;
    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        onboardingCompleted: true,
        interests: true,
        wallets: {
          orderBy: [{ isPrimary: "desc" }, { lastUsedAt: "desc" }],
          select: {
            walletAddress: true,
            provider: true,
            label: true,
            isPrimary: true,
            chainId: true,
            lastUsedAt: true,
          },
        },
      },
    });
    if (!row) return null;
    let interests: string[] = [];
    try { interests = JSON.parse(row.interests ?? "[]"); } catch {}
    return {
      onboardingCompleted: row.onboardingCompleted,
      interests,
      wallets: row.wallets ?? [],
    };
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  try {
    const { getUserFromSessionToken, sessionCookieName } = await import("@/lib/auth");
    const { getPrimaryMembership } = await import("@/lib/rbac");
    const { isManualAuthConfigured, readWalletSession } = await import("@/lib/wallet-session");

    const sessionToken = request.cookies.get(sessionCookieName())?.value;
    const user = sessionToken ? await getUserFromSessionToken(sessionToken) : null;
    const membership = user ? await getPrimaryMembership(user.id) : null;
    const profile = user ? await getUserProfile(user.id) : null;

    const configured = isManualAuthConfigured();
    const walletSession = readWalletSession(request);

    const basePayload = {
      ok: true,
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
      onboardingCompleted: profile?.onboardingCompleted ?? false,
      interests: profile?.interests ?? [],
      wallets: profile?.wallets ?? [],
    };

    if (!configured || !walletSession) {
      return Response.json({
        ...basePayload,
        configured,
        authenticated: false,
      });
    }

    return Response.json({
      ...basePayload,
      configured: true,
      authenticated: true,
      walletAddress: walletSession.walletAddress,
      expiresAt: walletSession.expiresAt,
      scopes: walletSession.scopes,
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
      onboardingCompleted: false,
      interests: [],
      wallets: [],
    });
  }
}
