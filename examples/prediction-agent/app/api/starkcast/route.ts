import { NextRequest, NextResponse } from "next/server";
import { listCasts } from "@/lib/economy-reader";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const limit = parseInt(searchParams.get("limit") ?? "50", 10);
  const offset = parseInt(searchParams.get("offset") ?? "0", 10);
  const sort = searchParams.get("sort") ?? "newest";

  try {
    const result = await listCasts(offset, limit, sort);
    return NextResponse.json({
      casts: result.casts,
      total: result.total,
      offset,
      limit,
      source: "onchain",
    });
  } catch (err) {
    console.warn("[starkcast] on-chain fetch failed:", err);
    return NextResponse.json({
      casts: [],
      total: 0,
      offset,
      limit,
      source: "onchain",
      error: err instanceof Error ? err.message : "Failed to fetch casts",
    });
  }
}
