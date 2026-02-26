import { NextResponse } from "next/server";
import { clearWalletSessionCookie } from "@/lib/wallet-session";

export const runtime = "nodejs";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  clearWalletSessionCookie(response);
  return response;
}

