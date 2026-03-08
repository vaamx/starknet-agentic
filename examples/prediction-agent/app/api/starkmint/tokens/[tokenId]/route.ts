import { NextRequest, NextResponse } from "next/server";
import { getTokenDetail } from "@/lib/economy-reader";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ tokenId: string }> }
) {
  const { tokenId } = await params;

  // Try on-chain: if tokenId is "launch-N", extract the index
  const launchMatch = tokenId.match(/^launch-(\d+)$/);
  if (launchMatch) {
    try {
      const token = await getTokenDetail(parseInt(launchMatch[1], 10));
      if (token) {
        return NextResponse.json({ ...token, source: "onchain" });
      }
    } catch (err) {
      console.warn(`[starkmint/tokens/${tokenId}] on-chain fetch failed:`, err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to fetch token from on-chain" },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ error: "Token not found" }, { status: 404 });
}
