import { NextRequest, NextResponse } from "next/server";
import {
  revokeSessionByToken,
  sessionCookieName,
} from "@/lib/auth";
import { clearWalletSessionCookie } from "@/lib/wallet-session";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const scope = request.nextUrl.searchParams.get("scope") ?? "wallet";
  const clearWallet = scope === "wallet" || scope === "all";
  const clearAccount = scope === "account" || scope === "all";
  const response = NextResponse.json({ ok: true, scope });

  if (clearAccount) {
    const sessionToken = request.cookies.get(sessionCookieName())?.value;
    if (sessionToken) {
      revokeSessionByToken(sessionToken);
    }

    response.cookies.set(sessionCookieName(), "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 0,
    });
  }

  if (clearWallet) {
    clearWalletSessionCookie(response);
  }
  return response;
}
