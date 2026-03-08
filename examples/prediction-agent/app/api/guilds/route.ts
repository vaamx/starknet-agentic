import { NextRequest, NextResponse } from "next/server";
import { listGuilds } from "@/lib/economy-reader";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const limit = parseInt(searchParams.get("limit") ?? "20", 10);
  const offset = parseInt(searchParams.get("offset") ?? "0", 10);
  const sort = searchParams.get("sort") ?? "members";

  try {
    const result = await listGuilds(offset, limit, sort);
    return NextResponse.json({
      guilds: result.guilds,
      total: result.total,
      offset,
      limit,
      source: "onchain",
    });
  } catch (err) {
    console.warn("[guilds] on-chain fetch failed:", err);
    return NextResponse.json({
      guilds: [],
      total: 0,
      offset,
      limit,
      source: "onchain",
      error: err instanceof Error ? err.message : "Failed to fetch guilds from on-chain",
    });
  }
}
