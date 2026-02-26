import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextResponse } from "next/server";
import { jsonError } from "./api-guard";
import { config } from "./config";
import { isStarknetAddress, normalizeWalletAddress } from "./agent-network";

const COOKIE_NAME = "wallet_session";
const SESSION_VERSION = 1;
export const MANUAL_AUTH_SCOPES = ["spawn", "fund", "tick"] as const;
export type ManualAuthScope = (typeof MANUAL_AUTH_SCOPES)[number];
const MANUAL_AUTH_SCOPE_SET = new Set<string>(MANUAL_AUTH_SCOPES);
const DEFAULT_MANUAL_AUTH_SCOPES: ManualAuthScope[] = [...MANUAL_AUTH_SCOPES];

export interface WalletSessionPayload {
  v: number;
  walletAddress: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
  scopes: ManualAuthScope[];
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeBase64Url(value: string): string | null {
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

function signPayload(payloadB64: string): string {
  return createHmac("sha256", config.manualAuthSecret).update(payloadB64).digest("base64url");
}

function parseCookieHeader(header: string | null): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const pair of header.split(";")) {
    const [rawKey, ...rawValue] = pair.trim().split("=");
    const key = rawKey?.trim();
    if (!key) continue;
    out[key] = rawValue.join("=").trim();
  }
  return out;
}

function getCookieValue(request: Request, name: string): string | null {
  const cookies = parseCookieHeader(request.headers.get("cookie"));
  const value = cookies[name];
  return value && value.length > 0 ? value : null;
}

export function normalizeManualAuthScopes(
  scopes?: readonly string[] | null
): ManualAuthScope[] {
  if (!scopes || scopes.length === 0) {
    return [...DEFAULT_MANUAL_AUTH_SCOPES];
  }

  const requested = new Set(
    scopes
      .map((scope) => String(scope ?? "").trim().toLowerCase())
      .filter((scope): scope is ManualAuthScope => MANUAL_AUTH_SCOPE_SET.has(scope))
  );
  const ordered = MANUAL_AUTH_SCOPES.filter((scope) => requested.has(scope));
  return ordered.length > 0 ? ordered : [...DEFAULT_MANUAL_AUTH_SCOPES];
}

function buildSessionPayload(
  walletAddress: string,
  scopes: readonly ManualAuthScope[]
): WalletSessionPayload {
  const issuedAt = Date.now();
  const expiresAt = issuedAt + config.manualAuthSessionTtlSecs * 1000;
  return {
    v: SESSION_VERSION,
    walletAddress: normalizeWalletAddress(walletAddress),
    issuedAt,
    expiresAt,
    nonce: randomBytes(12).toString("hex"),
    scopes: normalizeManualAuthScopes(scopes),
  };
}

function encodeSessionToken(payload: WalletSessionPayload): string {
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = encodeBase64Url(payloadJson);
  const sig = signPayload(payloadB64);
  return `${payloadB64}.${sig}`;
}

function decodeSessionToken(token: string): WalletSessionPayload | null {
  const [payloadB64, signature] = token.split(".");
  if (!payloadB64 || !signature) return null;
  const expectedSig = signPayload(payloadB64);
  const sigBuf = Buffer.from(signature, "utf8");
  const expectedBuf = Buffer.from(expectedSig, "utf8");
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expectedBuf)) return null;

  const decoded = decodeBase64Url(payloadB64);
  if (!decoded) return null;

  let parsed: WalletSessionPayload;
  try {
    parsed = JSON.parse(decoded) as WalletSessionPayload;
  } catch {
    return null;
  }

  if (!parsed || parsed.v !== SESSION_VERSION) return null;
  if (!parsed.walletAddress || !isStarknetAddress(parsed.walletAddress)) return null;
  if (!Number.isFinite(parsed.expiresAt) || parsed.expiresAt <= Date.now()) return null;
  if (!Number.isFinite(parsed.issuedAt)) return null;
  if (!Array.isArray(parsed.scopes) || parsed.scopes.length === 0) return null;
  const scopes = normalizeManualAuthScopes(parsed.scopes);
  return {
    ...parsed,
    walletAddress: normalizeWalletAddress(parsed.walletAddress),
    scopes,
  };
}

export function isManualAuthConfigured(): boolean {
  return config.manualAuthSecret.trim().length >= 16;
}

export function issueWalletSessionToken(
  walletAddress: string,
  scopes?: readonly string[]
): {
  token: string;
  payload: WalletSessionPayload;
} {
  const normalized = normalizeWalletAddress(walletAddress);
  if (!isStarknetAddress(normalized)) {
    throw new Error("walletAddress must be a valid Starknet address");
  }
  if (!isManualAuthConfigured()) {
    throw new Error(
      "MANUAL_AUTH_SECRET (or HEARTBEAT_SECRET fallback) must be configured for wallet session auth"
    );
  }
  const payload = buildSessionPayload(
    normalized,
    normalizeManualAuthScopes(scopes)
  );
  return {
    token: encodeSessionToken(payload),
    payload,
  };
}

export function readWalletSession(request: Request): WalletSessionPayload | null {
  if (!isManualAuthConfigured()) return null;
  const token = getCookieValue(request, COOKIE_NAME);
  if (!token) return null;
  return decodeSessionToken(token);
}

export function setWalletSessionCookie(response: NextResponse, token: string): void {
  response.cookies.set({
    name: COOKIE_NAME,
    value: token,
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: config.manualAuthSessionTtlSecs,
  });
}

export function clearWalletSessionCookie(response: NextResponse): void {
  response.cookies.set({
    name: COOKIE_NAME,
    value: "",
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
  });
}

export function requireWalletSession(request: Request):
  | {
      ok: true;
      walletAddress: string;
      expiresAt: number;
      scopes: ManualAuthScope[];
    }
  | { ok: false; response: Response } {
  return requireWalletSessionWithScope(request);
}

function requireWalletSessionWithScope(
  request: Request,
  requiredScopes?: ManualAuthScope | readonly ManualAuthScope[]
):
  | {
      ok: true;
      walletAddress: string;
      expiresAt: number;
      scopes: ManualAuthScope[];
    }
  | { ok: false; response: Response } {
  if (!isManualAuthConfigured()) {
    return {
      ok: false,
      response: jsonError(
        "Manual wallet auth is not configured (set MANUAL_AUTH_SECRET or HEARTBEAT_SECRET)",
        503
      ),
    };
  }

  const session = readWalletSession(request);
  if (!session) {
    return {
      ok: false,
      response: jsonError("Wallet signature session required", 401),
    };
  }

  if (requiredScopes) {
    const required = Array.isArray(requiredScopes)
      ? requiredScopes
      : [requiredScopes];
    const missing = required.filter((scope) => !session.scopes.includes(scope));
    if (missing.length > 0) {
      return {
        ok: false,
        response: jsonError(
          `Wallet session missing required scope(s): ${missing.join(", ")}`,
          403,
          {
            requiredScopes: required,
            grantedScopes: session.scopes,
          }
        ),
      };
    }
  }

  return {
    ok: true,
    walletAddress: session.walletAddress,
    expiresAt: session.expiresAt,
    scopes: session.scopes,
  };
}

export function requireWalletSessionScope(
  request: Request,
  requiredScopes: ManualAuthScope | readonly ManualAuthScope[]
):
  | {
      ok: true;
      walletAddress: string;
      expiresAt: number;
      scopes: ManualAuthScope[];
    }
  | { ok: false; response: Response } {
  return requireWalletSessionWithScope(request, requiredScopes);
}
