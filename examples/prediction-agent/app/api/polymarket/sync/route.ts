import { NextRequest, NextResponse } from "next/server";
import { syncPolymarketMarkets, getPolymarketCount } from "@/lib/polymarket-sync";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/polymarket/sync — trigger a Polymarket market sync.
 * Protected by HEARTBEAT_SECRET or admin auth.
 *
 * Query params:
 *   maxTotal (default 300) — max total markets to sync
 */
export async function POST(request: NextRequest) {
  // Auth: accept heartbeat secret or skip in dev
  const secret = request.headers.get("x-heartbeat-secret");
  const expectedSecret = process.env.HEARTBEAT_SECRET;

  if (expectedSecret && secret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const maxTotal = Number(
    request.nextUrl.searchParams.get("maxTotal") ?? "300"
  );

  try {
    const result = await syncPolymarketMarkets(maxTotal);

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (err: any) {
    console.error("[polymarket/sync] Error:", err.message);
    return NextResponse.json(
      { ok: false, error: err.message },
      { status: 500 }
    );
  }
}

/**
 * GET /api/polymarket/sync — check sync status.
 */
export async function GET() {
  try {
    const count = await getPolymarketCount();
    return NextResponse.json({
      ok: true,
      cachedMarketCount: count,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err.message },
      { status: 500 }
    );
  }
}
