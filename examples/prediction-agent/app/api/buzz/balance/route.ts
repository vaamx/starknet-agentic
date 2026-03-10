import { NextRequest, NextResponse } from "next/server";
import { getBuzzBalance, formatBuzzBalance } from "@/lib/buzz-rewards";

// ── Simple in-memory rate limiter (60 req/min per IP) ────────────────────────

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  // Prune expired entries to prevent memory leak
  if (rateLimitMap.size > 1000) {
    for (const [k, v] of rateLimitMap) {
      if (now >= v.resetAt) rateLimitMap.delete(k);
    }
  }
  const entry = rateLimitMap.get(ip);
  if (!entry || now >= entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= RATE_LIMIT;
}

// ── Response cache (15s TTL) ─────────────────────────────────────────────────

let cached: { address: string; body: object; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 15_000;

export async function GET(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: "Rate limit exceeded (60 req/min)" },
      { status: 429 }
    );
  }

  const address = req.nextUrl.searchParams.get("address");
  if (!address || !/^0x[0-9a-fA-F]{1,64}$/.test(address)) {
    return NextResponse.json(
      { error: "Missing or invalid 'address' query parameter" },
      { status: 400 }
    );
  }

  try {
    // Serve from cache if fresh
    if (
      cached &&
      cached.address === address.toLowerCase() &&
      Date.now() - cached.fetchedAt < CACHE_TTL_MS
    ) {
      return NextResponse.json(cached.body);
    }

    const balance = await getBuzzBalance(address);
    // Return both numeric (for client) and formatted (for display)
    // Safe: 21M max supply * 1e18 decimals → whole BUZZ fits in Number
    const balanceWhole = Number(balance / 10n ** 18n);
    const body = {
      address,
      balance: balanceWhole,
      balanceRaw: balance.toString(),
      balanceFormatted: formatBuzzBalance(balance),
    };

    cached = { address: address.toLowerCase(), body, fetchedAt: Date.now() };
    return NextResponse.json(body);
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch balance" },
      { status: 500 }
    );
  }
}
