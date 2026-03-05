import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/require-auth";
import { listRecentForecasts } from "@/lib/ops-store";

export async function GET(request: NextRequest) {
  const context = requireRole(request, "viewer");
  if (!context) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limit = Number(request.nextUrl.searchParams.get("limit") ?? "100");
  const rows = await listRecentForecasts(
    context.membership.organizationId,
    Math.min(500, Math.max(1, limit))
  );

  return NextResponse.json({ forecasts: rows });
}
