import { NextRequest, NextResponse } from "next/server";
import { getUserFromSessionToken, sessionCookieName } from "@/lib/auth";
import { setCsrfCookie } from "@/lib/request-security";

export async function GET(request: NextRequest) {
  const token = request.cookies.get(sessionCookieName())?.value;
  if (!token) {
    const response = NextResponse.json({ authenticated: false });
    if (!request.cookies.get("hc_csrf")?.value) {
      setCsrfCookie(response);
    }
    return response;
  }

  const user = getUserFromSessionToken(token);
  if (!user) {
    const response = NextResponse.json({ authenticated: false });
    if (!request.cookies.get("hc_csrf")?.value) {
      setCsrfCookie(response);
    }
    return response;
  }

  const response = NextResponse.json({ authenticated: true, user });
  if (!request.cookies.get("hc_csrf")?.value) {
    setCsrfCookie(response);
  }
  return response;
}
