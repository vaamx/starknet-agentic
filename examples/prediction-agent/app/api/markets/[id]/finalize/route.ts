import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { finalizeMarket, type ExecutionSurface } from "@/lib/starknet-executor";
import { requireRole } from "@/lib/require-auth";
import { recordAudit, recordMarketOutcome, recordTradeExecution } from "@/lib/ops-store";

const FinalizeSchema = z.object({
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
    if (Number.isNaN(marketId) || marketId < 0) {
      return NextResponse.json({ error: "Invalid market id" }, { status: 400 });
    }

    const body = await request.json();
    const parsed = FinalizeSchema.parse(body);

    const tx = await finalizeMarket(
      marketId,
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
      action: "market.finalize",
      targetType: "market",
      targetId: String(marketId),
      metadata: {
        outcome: parsed.outcome,
        status: tx.status,
        executionSurface: tx.executionSurface,
      },
    });
    if (tx.status === "success") {
      await recordMarketOutcome({
        organizationId: context.membership.organizationId,
        marketId,
        outcome: parsed.outcome as 0 | 1,
      });
    }

    if (tx.status !== "success") {
      return NextResponse.json(
        {
          error: tx.error ?? "Finalize failed",
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
