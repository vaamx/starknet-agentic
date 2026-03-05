import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getMarkets } from "@/lib/market-reader";
import { resolveMarket, type ExecutionSurface } from "@/lib/starknet-executor";
import { requireRole } from "@/lib/require-auth";
import { recordAudit, recordTradeExecution } from "@/lib/ops-store";

const ResolveSchema = z.object({
  outcome: z.union([z.literal(0), z.literal(1)]),
  executionSurface: z.enum(["direct", "starkzap", "avnu"]).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const context = requireRole(request, "admin");
    if (!context) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const marketId = parseInt(id, 10);
    const body = await request.json();
    const parsed = ResolveSchema.parse(body);

    const markets = await getMarkets();
    const market = markets.find((m) => m.id === marketId);
    if (!market) {
      return NextResponse.json({ error: "Market not found" }, { status: 404 });
    }

    const tx = await resolveMarket(
      market.address,
      parsed.outcome as 0 | 1,
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
      action: "market.resolve",
      targetType: "market",
      targetId: String(marketId),
      metadata: {
        outcome: parsed.outcome,
        status: tx.status,
        executionSurface: tx.executionSurface,
      },
    });

    if (tx.status !== "success") {
      return NextResponse.json(
        {
          error: tx.error ?? "Resolve failed",
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
