import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/require-auth";
import { getAnalyticsOverview } from "@/lib/ops-store";

export async function GET(request: NextRequest) {
  const context = requireRole(request, "viewer");
  if (!context) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const analytics = await getAnalyticsOverview(context.membership.organizationId);
  return NextResponse.json({
    organizationId: context.membership.organizationId,
    analytics,
  });
}
