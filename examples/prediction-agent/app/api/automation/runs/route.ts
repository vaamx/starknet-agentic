import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/require-auth";
import {
  executeAutomationMarketNow,
  executeDueAutomationPolicies,
} from "@/lib/automation-engine";
import { listRecentAutomationRuns } from "@/lib/automation-store";
import { requireWalletSessionScope } from "@/lib/wallet-session";

export const runtime = "nodejs";

const postSchema = z.object({
  marketId: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

function parseMarketId(raw: string | null): number | null {
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function parseLimit(raw: string | null): number {
  if (!raw) return 30;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 30;
  return Math.min(100, parsed);
}

export async function GET(request: NextRequest) {
  const context = requireRole(request, "viewer");
  if (!context) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const marketId = parseMarketId(request.nextUrl.searchParams.get("marketId"));
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
  const runs = await listRecentAutomationRuns({
    organizationId: context.membership.organizationId,
    userId: context.user.id,
    marketId: marketId ?? undefined,
    limit,
  });
  return NextResponse.json({ runs });
}

export async function POST(request: NextRequest) {
  const context = requireRole(request, "analyst");
  if (!context) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const walletAuth = requireWalletSessionScope(request, "tick");
  if (!walletAuth.ok) {
    return walletAuth.response;
  }

  try {
    const body = postSchema.parse(await request.json());
    if (typeof body.marketId === "number") {
      const result = await executeAutomationMarketNow({
        organizationId: context.membership.organizationId,
        userId: context.user.id,
        marketId: body.marketId,
      });
      if (!result) {
        return NextResponse.json(
          { error: "No automation policy found for this market" },
          { status: 404 }
        );
      }
      return NextResponse.json({
        processed: 1,
        results: [result],
      });
    }

    const executed = await executeDueAutomationPolicies({
      organizationId: context.membership.organizationId,
      userId: context.user.id,
      limit: body.limit ?? 12,
    });
    return NextResponse.json(executed);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    return NextResponse.json(
      { error: error?.message ?? "Failed to execute automation runs" },
      { status: 500 }
    );
  }
}
