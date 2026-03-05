import { randomBytes, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

const CSRF_COOKIE_NAME = "hc_csrf";
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function csrfCookieName(): string {
  return CSRF_COOKIE_NAME;
}

export function createCsrfToken(): string {
  return randomBytes(24).toString("hex");
}

export function isMutatingMethod(method: string): boolean {
  return MUTATING_METHODS.has(method.toUpperCase());
}

export function readClientIp(request: NextRequest): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  return realIp || "unknown";
}

export function validateSameOrigin(
  request: NextRequest
): { ok: true } | { ok: false; reason: string } {
  if (!isMutatingMethod(request.method)) {
    return { ok: true };
  }

  const origin = request.headers.get("origin");
  if (!origin) {
    return { ok: false, reason: "Missing Origin header" };
  }

  const expectedOrigin = request.nextUrl.origin;
  if (origin !== expectedOrigin) {
    return {
      ok: false,
      reason: `Origin mismatch: expected ${expectedOrigin}, got ${origin}`,
    };
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (
    fetchSite &&
    fetchSite !== "same-origin" &&
    fetchSite !== "same-site" &&
    fetchSite !== "none"
  ) {
    return {
      ok: false,
      reason: `Cross-site request blocked (sec-fetch-site=${fetchSite})`,
    };
  }

  return { ok: true };
}

export function validateCsrfToken(
  request: NextRequest
): { ok: true } | { ok: false; reason: string } {
  const tokenFromCookie = request.cookies.get(CSRF_COOKIE_NAME)?.value;
  const tokenFromHeader = request.headers.get("x-csrf-token");

  if (!tokenFromCookie || !tokenFromHeader) {
    return { ok: false, reason: "Missing CSRF token" };
  }

  const a = Uint8Array.from(Buffer.from(tokenFromCookie));
  const b = Uint8Array.from(Buffer.from(tokenFromHeader));
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "Invalid CSRF token" };
  }

  return { ok: true };
}

export function validateMutatingRequest(
  request: NextRequest
): { ok: true } | { ok: false; reason: string } {
  const sameOrigin = validateSameOrigin(request);
  if (!sameOrigin.ok) {
    return sameOrigin;
  }

  if (!isMutatingMethod(request.method)) {
    return { ok: true };
  }

  return validateCsrfToken(request);
}

export function setCsrfCookie(
  response: NextResponse,
  token: string = createCsrfToken()
): string {
  response.cookies.set(CSRF_COOKIE_NAME, token, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 8, // 8 hours
  });
  return token;
}
