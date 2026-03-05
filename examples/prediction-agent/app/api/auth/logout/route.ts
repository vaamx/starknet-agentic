import { NextRequest, NextResponse } from "next/server";
import { revokeSessionByToken, sessionCookieName } from "@/lib/auth";
import { setCsrfCookie, validateMutatingRequest } from "@/lib/request-security";

export async function POST(request: NextRequest) {
  const mutationCheck = validateMutatingRequest(request);
  if (!mutationCheck.ok) {
    return NextResponse.json({ error: mutationCheck.reason }, { status: 403 });
  }

  const token = request.cookies.get(sessionCookieName())?.value;
  if (token) {
    revokeSessionByToken(token);
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(sessionCookieName(), "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  setCsrfCookie(response);
  return response;
}
