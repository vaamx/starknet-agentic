import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { placeBet, type ExecutionSurface } from "@/lib/starknet-executor";
import { getMarkets } from "@/lib/market-reader";
import { requireRole } from "@/lib/require-auth";
import { recordAudit, recordTradeExecution } from "@/lib/ops-store";

const BetSchema = z.object({
  marketId: z.number().int().min(0),
  outcome: z.union([z.literal(0), z.literal(1)]),
  amount: z.string(), // bigint as string
  executionSurface: z.enum(["direct", "starkzap", "avnu"]).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const context = requireRole(request, "analyst");
    if (!context) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const parsed = BetSchema.parse(body);

    const markets = await getMarkets();
    const market = markets.find((m) => m.id === parsed.marketId);

    if (!market) {
      return NextResponse.json({ error: "Market not found" }, { status: 404 });
    }

    if (market.status !== 0) {
      return NextResponse.json({ error: "Market is not open" }, { status: 400 });
    }

    const result = await placeBet(
      market.address,
      parsed.outcome as 0 | 1,
      BigInt(parsed.amount),
      market.collateralToken,
      parsed.executionSurface as ExecutionSurface | undefined
    );

    await recordTradeExecution({
      organizationId: context.membership.organizationId,
      marketId: parsed.marketId,
      userId: context.user.id,
      executionSurface: result.executionSurface,
      txHash: result.txHash || undefined,
      status: result.status,
      errorCode: result.errorCode,
      errorMessage: result.error,
    });
    await recordAudit({
      organizationId: context.membership.organizationId,
      userId: context.user.id,
      action: "market.bet",
      targetType: "market",
      targetId: String(parsed.marketId),
      metadata: {
        outcome: parsed.outcome,
        amount: parsed.amount,
        status: result.status,
        executionSurface: result.executionSurface,
      },
    });

    return NextResponse.json(result);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 400 });
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
