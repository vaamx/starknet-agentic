import { NextRequest, NextResponse } from "next/server";
import { getBuzzLeaderboard, getBuzzStats } from "@/lib/buzz-rewards";

// ── Simple in-memory rate limiter (30 req/min per IP) ────────────────────────

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now >= entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= RATE_LIMIT;
}

// ── Response cache (60s TTL) ─────────────────────────────────────────────────

let cached: { body: object; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

export async function GET(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: "Rate limit exceeded (30 req/min)" },
      { status: 429 }
    );
  }

  try {
    // Serve from cache if fresh
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return NextResponse.json(cached.body);
    }

    const leaderboard = getBuzzLeaderboard(20);
    const stats = getBuzzStats();

    const body = {
      leaderboard,
      stats,
    };

    cached = { body, fetchedAt: Date.now() };
    return NextResponse.json(body);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
