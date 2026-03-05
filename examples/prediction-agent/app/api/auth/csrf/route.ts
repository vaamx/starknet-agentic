import { NextResponse } from "next/server";
import { createCsrfToken, setCsrfCookie } from "@/lib/request-security";

export async function GET() {
  const token = createCsrfToken();
  const response = NextResponse.json(
    { ok: true, csrfToken: token },
    { headers: { "Cache-Control": "no-store" } }
  );
  setCsrfCookie(response, token);
  return response;
}

