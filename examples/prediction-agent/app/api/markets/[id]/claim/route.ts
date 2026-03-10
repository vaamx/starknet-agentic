import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getMarkets } from "@/lib/market-reader";
import { claimWinnings, type ExecutionSurface } from "@/lib/starknet-executor";
import { requireRole } from "@/lib/require-auth";
import { recordAudit, recordTradeExecution } from "@/lib/ops-store";
import { getPolymarketMarketById } from "@/lib/polymarket-reader";

const ClaimSchema = z.object({
  executionSurface: z.enum(["direct", "starkzap", "avnu"]).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = await requireRole(request, "analyst");
    if (!context) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const marketId = parseInt(id, 10);
    const body = await request.json().catch(() => ({}));
    const parsed = ClaimSchema.parse(body);

    let claimAddress: string | null = null;

    if (marketId >= 100_000) {
      // Polymarket — use mirror address
      const polyMarket = await getPolymarketMarketById(marketId);
      if (polyMarket?.mirrorAddress && polyMarket.mirrorAddress !== "0x0") {
        claimAddress = polyMarket.mirrorAddress;
      } else {
        return NextResponse.json({ error: "No mirror market deployed for claim" }, { status: 404 });
      }
    } else {
      const markets = await getMarkets();
      const market = markets.find((m) => m.id === marketId);
      if (!market) {
        return NextResponse.json({ error: "Market not found" }, { status: 404 });
      }
      claimAddress = market.address;
    }

    const tx = await claimWinnings(
      claimAddress,
      parsed.executionSurface as ExecutionSurface | undefined
    );
    await recordTradeExecution({
      organizationId: context.membership.organizationId,
      marketId,
      userId: context.user.id,
      executionSurface: tx.executionSurface,
      txHash: tx.txHash || undefined,
      status: tx.status,
      errorCode: tx.errorCode,
      errorMessage: tx.error,
    });
    await recordAudit({
      organizationId: context.membership.organizationId,
      userId: context.user.id,
      action: "market.claim",
      targetType: "market",
      targetId: String(marketId),
      metadata: {
        status: tx.status,
        executionSurface: tx.executionSurface,
      },
    });

    if (tx.status !== "success") {
      return NextResponse.json(
        {
          error: tx.error ?? "Claim failed",
          errorCode: tx.errorCode,
          executionSurface: tx.executionSurface,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(tx);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 400 });
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
