"use client";

const CSRF_COOKIE_NAME = "hc_csrf";

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split("; ")
    .find((part) => part.startsWith(`${name}=`));
  if (!match) return null;
  const value = match.slice(name.length + 1);
  return value ? decodeURIComponent(value) : null;
}

export function getCsrfTokenFromCookie(): string | null {
  return readCookie(CSRF_COOKIE_NAME);
}

export async function ensureCsrfToken(): Promise<string> {
  const existing = getCsrfTokenFromCookie();
  if (existing) return existing;

  const response = await fetch("/api/auth/csrf", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to initialize CSRF protection");
  }

  const body = await response.json().catch(() => null);
  const fromBody =
    body && typeof body.csrfToken === "string" ? body.csrfToken : null;
  const fromCookie = getCsrfTokenFromCookie();
  const token = fromCookie ?? fromBody;

  if (!token) {
    throw new Error("CSRF token is unavailable");
  }
  return token;
}
