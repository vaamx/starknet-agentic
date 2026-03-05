import { NextResponse } from "next/server";
import { getMarkets, resolveMarketQuestion } from "@/lib/market-reader";

export async function GET() {
  try {
    const markets = await getMarkets();
    const now = Math.floor(Date.now() / 1000);

    // Markets past resolution time that are still OPEN (status 0)
    const pending = markets
      .filter((m) => m.status === 0 && m.resolutionTime <= now)
      .map((m) => ({
        id: m.id,
        address: m.address,
        question: resolveMarketQuestion(m.id, m.questionHash),
        resolutionTime: m.resolutionTime,
        overdueDays: Math.floor((now - m.resolutionTime) / 86400),
        totalPool: m.totalPool.toString(),
        impliedProbYes: m.impliedProbYes,
      }));

    return NextResponse.json({ pending, count: pending.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
