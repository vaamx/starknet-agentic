import { NextRequest, NextResponse } from "next/server";
import { getUserFromSessionToken, sessionCookieName } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const token = request.cookies.get(sessionCookieName())?.value;
  if (!token) {
    return NextResponse.json({ authenticated: false });
  }

  const user = getUserFromSessionToken(token);
  if (!user) {
    return NextResponse.json({ authenticated: false });
  }

  return NextResponse.json({ authenticated: true, user });
}
