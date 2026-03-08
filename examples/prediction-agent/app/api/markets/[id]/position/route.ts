import { NextRequest, NextResponse } from "next/server";
import { getMarketById, getUserPosition } from "@/lib/market-reader";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const marketId = parseInt(id, 10);
  if (!Number.isFinite(marketId) || marketId < 0) {
    return NextResponse.json({ error: "Invalid market id" }, { status: 400 });
  }

  const userAddress = request.nextUrl.searchParams.get("user");
  if (!userAddress || !/^0x[0-9a-fA-F]+$/.test(userAddress)) {
    return NextResponse.json({ error: "user query param required (hex address)" }, { status: 400 });
  }

  try {
    const market = await getMarketById(marketId);
    if (!market) {
      return NextResponse.json({ error: "Market not found" }, { status: 404 });
    }

    const position = await getUserPosition(market.address, userAddress);
    return NextResponse.json({
      marketId,
      user: userAddress,
      yesBet: position.yesBet.toString(),
      noBet: position.noBet.toString(),
      totalBet: (position.yesBet + position.noBet).toString(),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Failed to fetch position" }, { status: 500 });
  }
}
