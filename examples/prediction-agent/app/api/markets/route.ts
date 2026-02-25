import { NextResponse } from "next/server";
import { getMarkets, resolveMarketQuestion } from "@/lib/market-reader";
import { config } from "@/lib/config";
import { getOnChainActivityCounts } from "@/lib/event-indexer";

export async function GET() {
  try {
    const markets = await getMarkets();

    const addresses = markets
      .map((m) => m.address)
      .filter((a) => a !== "0x0" && !a.startsWith("0xpending"));
    const tradeCounts =
      addresses.length > 0
        ? await getOnChainActivityCounts(addresses)
        : {};

    const enriched = markets.map((m) => ({
      ...m,
      question: resolveMarketQuestion(m.id, m.questionHash),
      totalPool: m.totalPool.toString(),
      yesPool: m.yesPool.toString(),
      noPool: m.noPool.toString(),
      tradeCount: tradeCounts[m.address] ?? 0,
    }));

    const factoryAddress = config.MARKET_FACTORY_ADDRESS ?? "0x0";
    const factoryConfigured =
      factoryAddress !== "0x0" && factoryAddress !== "";

    return NextResponse.json({
      markets: enriched,
      factoryConfigured,
      factoryAddress,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
