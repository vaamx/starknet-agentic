import { NextRequest, NextResponse } from "next/server";
import { listTokens } from "@/lib/economy-reader";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const curveType = searchParams.get("curveType") ?? undefined;
  const limit = parseInt(searchParams.get("limit") ?? "20", 10);
  const offset = parseInt(searchParams.get("offset") ?? "0", 10);

  try {
    const result = await listTokens(offset, limit, curveType);
    return NextResponse.json({
      tokens: result.tokens,
      total: result.total,
      offset,
      limit,
      source: "onchain",
    });
  } catch (err) {
    console.warn("[starkmint/tokens] on-chain fetch failed:", err);
    return NextResponse.json({
      tokens: [],
      total: 0,
      offset,
      limit,
      source: "onchain",
      error: err instanceof Error ? err.message : "Failed to fetch tokens from on-chain",
    });
  }
}
