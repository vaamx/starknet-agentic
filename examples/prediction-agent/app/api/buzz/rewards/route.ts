import { NextRequest, NextResponse } from "next/server";
import {
  getBuzzRewardHistory,
  getPendingRewards,
  getTotalBuzzEarned,
} from "@/lib/buzz-rewards";

// ── Simple in-memory rate limiter (30 req/min per IP) ────────────────────────

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
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

export async function GET(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: "Rate limit exceeded (30 req/min)" },
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

  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = Math.min(200, Math.max(1, parseInt(limitParam ?? "50", 10) || 50));

  try {
    const rewards = getBuzzRewardHistory(address, limit);
    const totalEarned = getTotalBuzzEarned(address);
    const pending = getPendingRewards(address);

    return NextResponse.json({
      rewards,
      totalEarned,
      pendingCount: pending.length,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch rewards" },
      { status: 500 }
    );
  }
}
