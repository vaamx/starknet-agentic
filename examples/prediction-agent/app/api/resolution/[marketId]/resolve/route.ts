import { NextRequest, NextResponse } from "next/server";
import { markManuallyResolved } from "@/lib/resolution-store";
import { requireRole } from "@/lib/require-auth";

export const runtime = "nodejs";

const DEFAULT_ORG = "default";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ marketId: string }> }
) {
  const auth = requireRole(request, "admin");
  if (!auth) {
    return NextResponse.json(
      { error: "Unauthorized — admin role required" },
      { status: 403 }
    );
  }

  const { marketId: rawId } = await params;
  const marketId = parseInt(rawId, 10);
  if (!Number.isFinite(marketId) || marketId < 0) {
    return NextResponse.json({ error: "Invalid market id" }, { status: 400 });
  }

  try {
    markManuallyResolved(DEFAULT_ORG, marketId);
    return NextResponse.json({ success: true, marketId });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to mark market as manually resolved" },
      { status: 500 }
    );
  }
}
