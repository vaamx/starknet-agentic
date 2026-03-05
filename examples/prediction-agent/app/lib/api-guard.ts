import { NextRequest } from "next/server";
import { config } from "./config";

type RateLimitConfig = {
  windowMs: number;
  maxRequests: number;
};

type RateLimitEntry = {
  resetAt: number;
  count: number;
};

const memoryRateLimitStore = new Map<string, RateLimitEntry>();

function normalizeAddress(value: string): string {
  return value.trim().toLowerCase();
}

function isLikelyAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{1,64}$/.test(value);
}

function safeParseBase64Json(encoded: string): any | null {
  try {
    return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

export function getClientIpFromHeaders(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  const realIp = headers.get("x-real-ip");
  if (realIp) return realIp;
  return "unknown";
}

function extractWalletHintFromHeaders(headers: Headers): string | null {
  const directWalletHeaders = [
    headers.get("x-wallet-address"),
    headers.get("x-agent-address"),
    headers.get("x-account-address"),
    headers.get("x-payment-sender"),
  ];

  for (const candidate of directWalletHeaders) {
    if (candidate && isLikelyAddress(candidate)) {
      return normalizeAddress(candidate);
    }
  }

  const paymentSignature = headers.get("x-payment-signature");
  if (!paymentSignature) return null;

  const payload = safeParseBase64Json(paymentSignature);
  const callerAddress =
    typeof payload?.callerAddress === "string"
      ? payload.callerAddress
      : null;
  if (!callerAddress || !isLikelyAddress(callerAddress)) return null;
  return normalizeAddress(callerAddress);
}

export function buildActorFingerprintFromHeaders(headers: Headers): string {
  const ip = getClientIpFromHeaders(headers);
  const wallet = extractWalletHintFromHeaders(headers);
  const agentHeader = headers.get("user-agent") ?? "unknown-agent";
  const normalizedAgent = agentHeader.slice(0, 64).toLowerCase();
  return `ip:${ip}|wallet:${wallet ?? "anon"}|ua:${normalizedAgent}`;
}

export function getRequestSecret(request: NextRequest): string | null {
  const headerSecret = request.headers.get("x-heartbeat-secret");
  if (headerSecret && headerSecret.trim().length > 0) {
    return headerSecret.trim();
  }

  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice("Bearer ".length).trim();
    return token.length > 0 ? token : null;
  }

  return null;
}

export function jsonError(
  message: string,
  status = 400,
  details?: unknown
): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error: message,
      details,
    }),
    {
      status,
      headers: { "Content-Type": "application/json" },
    }
  );
}

function buildRateLimitedResponse(
  limit: number,
  count: number,
  resetAt: number
): Response {
  const retryAfterSec = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
  const remaining = Math.max(0, limit - count);
  return new Response(
    JSON.stringify({
      ok: false,
      error: "Rate limit exceeded",
      retryAfterSec,
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfterSec),
        "X-RateLimit-Limit": String(limit),
        "X-RateLimit-Remaining": String(remaining),
        "X-RateLimit-Reset": String(Math.floor(resetAt / 1000)),
      },
    }
  );
}

function pruneMemoryRateLimitStore(nowMs: number): void {
  if (memoryRateLimitStore.size < 5000) return;
  for (const [key, entry] of memoryRateLimitStore.entries()) {
    if (entry.resetAt <= nowMs) {
      memoryRateLimitStore.delete(key);
    }
  }
}

function incrementMemoryBucket(key: string, resetAt: number, nowMs: number): number {
  pruneMemoryRateLimitStore(nowMs);
  const current = memoryRateLimitStore.get(key);
  if (!current || current.resetAt <= nowMs) {
    memoryRateLimitStore.set(key, { count: 1, resetAt });
    return 1;
  }
  current.count += 1;
  memoryRateLimitStore.set(key, current);
  return current.count;
}

async function incrementUpstashBucket(
  key: string,
  windowMs: number
): Promise<number | null> {
  if (!config.upstashRateLimitEnabled) return null;
  if (!config.UPSTASH_REDIS_REST_URL || !config.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }

  const url = config.UPSTASH_REDIS_REST_URL.replace(/\/+$/, "");
  const ttlSeconds = Math.max(10, Math.ceil(windowMs / 1000) + 60);

  try {
    const response = await fetch(`${url}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.UPSTASH_REDIS_REST_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        ["INCR", key],
        ["EXPIRE", key, String(ttlSeconds)],
      ]),
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Upstash pipeline failed: HTTP ${response.status}`);
    }

    const payload = await response.json();
    const count = Number(payload?.[0]?.result);
    if (!Number.isFinite(count) || count < 0) {
      throw new Error("Upstash returned invalid increment result");
    }
    return count;
  } catch (err) {
    console.warn("[rate-limit] falling back to memory store:", err);
    return null;
  }
}

function getEffectiveMaxRequests(
  requestedMax: number,
  windowMs: number
): number {
  const globalMaxForWindow = Math.max(
    1,
    Math.floor((config.rateLimitGlobalPerMin * windowMs) / 60_000)
  );
  return Math.max(1, Math.min(requestedMax, globalMaxForWindow));
}

export async function enforceRateLimit(
  request: NextRequest,
  scope: string,
  settings: RateLimitConfig
): Promise<Response | null> {
  const nowMs = Date.now();
  const windowMs = Math.max(1000, settings.windowMs);
  const effectiveMax = getEffectiveMaxRequests(settings.maxRequests, windowMs);

  const bucketIndex = Math.floor(nowMs / windowMs);
  const bucketStart = bucketIndex * windowMs;
  const resetAt = bucketStart + windowMs;

  const actor = buildActorFingerprintFromHeaders(request.headers);
  const key = `rl:${scope}:${actor}:${bucketIndex}`;

  const upstashCount = await incrementUpstashBucket(key, windowMs);
  const count =
    upstashCount ??
    incrementMemoryBucket(key, resetAt, nowMs);

  if (count > effectiveMax) {
    return buildRateLimitedResponse(effectiveMax, count, resetAt);
  }

  return null;
}
