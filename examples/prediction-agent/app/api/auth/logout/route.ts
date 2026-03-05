import { NextRequest, NextResponse } from "next/server";
import { revokeSessionByToken, sessionCookieName } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const token = request.cookies.get(sessionCookieName())?.value;
  if (token) {
    revokeSessionByToken(token);
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(sessionCookieName(), "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
