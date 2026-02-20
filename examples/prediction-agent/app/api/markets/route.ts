import { NextResponse } from "next/server";
import { getMarkets, MARKET_QUESTIONS } from "@/lib/market-reader";
import { config } from "@/lib/config";
import { getOnChainActivityCounts } from "@/lib/event-indexer";

/** Decode a hex-encoded question string (e.g. 0x536561...) to UTF-8 text. */
function decodeQuestionHash(hex: string): string {
  try {
    const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
    if (!clean) return "";
    const decoded = Buffer.from(clean, "hex").toString("utf8").trim();
    // Only return if printable ASCII — reject garbage bytes
    return /^[\x20-\x7E]+$/.test(decoded) ? decoded : "";
  } catch {
    return "";
  }
}

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
      question: MARKET_QUESTIONS[m.id] ?? (decodeQuestionHash(m.questionHash) || `Market #${m.id}`),
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
