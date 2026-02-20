import { NextResponse } from "next/server";
import { getOnChainLeaderboard } from "@/lib/market-reader";

export async function GET() {
  try {
    const leaderboard = await getOnChainLeaderboard();
    return NextResponse.json({ leaderboard });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
