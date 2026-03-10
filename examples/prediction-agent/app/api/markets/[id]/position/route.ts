import { NextRequest, NextResponse } from "next/server";
import { getMarketById, getUserPosition } from "@/lib/market-reader";
import { getPolymarketMarketById } from "@/lib/polymarket-reader";

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

  // For Polymarket markets, use the mirror address if provided or look it up
  const mirrorParam = request.nextUrl.searchParams.get("mirror");

  try {
    let contractAddress: string | null = null;

    if (mirrorParam && /^0x[0-9a-fA-F]+$/.test(mirrorParam)) {
      contractAddress = mirrorParam;
    } else if (marketId >= 100_000) {
      // Polymarket — look up mirror address
      const polyMarket = await getPolymarketMarketById(marketId);
      if (polyMarket?.mirrorAddress && polyMarket.mirrorAddress !== "0x0") {
        contractAddress = polyMarket.mirrorAddress;
      } else {
        return NextResponse.json({ error: "No mirror market deployed" }, { status: 404 });
      }
    } else {
      const market = await getMarketById(marketId);
      if (!market) {
        return NextResponse.json({ error: "Market not found" }, { status: 404 });
      }
      contractAddress = market.address;
    }

    const position = await getUserPosition(contractAddress, userAddress);
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
