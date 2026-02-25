import { NextResponse } from "next/server";
import { getOnChainLeaderboard } from "@/lib/market-reader";

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timeoutId = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function GET() {
  try {
    const leaderboard = await withTimeout(getOnChainLeaderboard(), 8_000, []);
    return NextResponse.json({ leaderboard, stale: leaderboard.length === 0 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
