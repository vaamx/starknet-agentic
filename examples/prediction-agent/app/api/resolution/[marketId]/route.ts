import { NextRequest, NextResponse } from "next/server";
import {
  getResolutionStatus,
  listResolutionAttempts,
} from "@/lib/resolution-store";

export const runtime = "nodejs";

const DEFAULT_ORG = "default";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ marketId: string }> }
) {
  const { marketId: rawId } = await params;
  const marketId = parseInt(rawId, 10);
  if (!Number.isFinite(marketId) || marketId < 0) {
    return NextResponse.json({ error: "Invalid market id" }, { status: 400 });
  }

  try {
    const status = getResolutionStatus(DEFAULT_ORG, marketId);
    const attempts = listResolutionAttempts(DEFAULT_ORG, marketId, 50);

    return NextResponse.json({
      status,
      attempts,
      outcome: attempts.find((a) => a.status === "resolved")?.outcome ?? null,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to fetch resolution data" },
      { status: 500 }
    );
  }
}
