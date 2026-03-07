import { NextResponse } from "next/server";
import {
  listNeedsReview,
  getResolutionStatus,
} from "@/lib/resolution-store";
import { getMarkets, resolveMarketQuestion } from "@/lib/market-reader";

export const runtime = "nodejs";

const DEFAULT_ORG = "default";

export async function GET() {
  try {
    const needsReview = listNeedsReview(DEFAULT_ORG);

    const markets = await getMarkets().catch(() => []);
    const nowSec = Math.floor(Date.now() / 1000);

    // Also include markets past resolution time that haven't been escalated yet
    const pendingMarkets = markets
      .filter((m) => m.status === 0 && m.resolutionTime <= nowSec)
      .map((m) => {
        const status = getResolutionStatus(DEFAULT_ORG, m.id);
        return {
          marketId: m.id,
          question: resolveMarketQuestion(m.id, m.questionHash),
          totalAttempts: status?.totalAttempts ?? 0,
          lastAttemptAt: status?.lastAttemptAt ?? null,
          lastStatus: status?.lastStatus ?? null,
          escalation: status?.escalation ?? "auto",
        };
      });

    return NextResponse.json({
      needsReview,
      pending: pendingMarkets,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to fetch pending resolutions" },
      { status: 500 }
    );
  }
}
