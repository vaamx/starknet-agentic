import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { getMarkets, DEMO_QUESTIONS, setMarketQuestion } from "@/lib/market-reader";
import { createMarket, type ExecutionSurface } from "@/lib/starknet-executor";
import { requireRole } from "@/lib/require-auth";
import { recordAudit, recordTradeExecution } from "@/lib/ops-store";

const CreateMarketSchema = z.object({
  question: z.string().min(5).max(280),
  days: z.number().int().min(1).max(3650),
  feeBps: z.number().int().min(0).max(1000),
  oracle: z.string().regex(/^0x[0-9a-fA-F]+$/).optional(),
  executionSurface: z.enum(["direct", "starkzap", "avnu"]).optional(),
});

function hashQuestionToFelt(question: string): string {
  const digest = createHash("sha256").update(question.trim()).digest("hex").slice(0, 62);
  return `0x${digest}`;
}

export async function GET(request: NextRequest) {
  try {
    const context = requireRole(request, "viewer");
    if (!context) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const markets = await getMarkets();

    const enriched = markets.map((m) => ({
      ...m,
      question: DEMO_QUESTIONS[m.id] ?? `Market #${m.id}`,
      totalPool: m.totalPool.toString(),
      yesPool: m.yesPool.toString(),
      noPool: m.noPool.toString(),
    }));

    return NextResponse.json({ markets: enriched });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = requireRole(request, "admin");
    if (!context) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const parsed = CreateMarketSchema.parse(body);

    const now = Math.floor(Date.now() / 1000);
    const resolutionTime = now + parsed.days * 86400;
    const questionHash = hashQuestionToFelt(parsed.question);
    const fallbackOracle = process.env.MARKET_ORACLE_ADDRESS ?? process.env.AGENT_ADDRESS;
    const oracle = parsed.oracle ?? fallbackOracle;

    if (!oracle) {
      return NextResponse.json(
        { error: "No oracle address provided. Set MARKET_ORACLE_ADDRESS or AGENT_ADDRESS." },
        { status: 400 }
      );
    }

    const tx = await createMarket(
      questionHash,
      resolutionTime,
      oracle,
      parsed.feeBps,
      parsed.executionSurface as ExecutionSurface | undefined
    );

    await recordTradeExecution({
      organizationId: context.membership.organizationId,
      marketId: -1,
      userId: context.user.id,
      executionSurface: tx.executionSurface,
      txHash: tx.txHash || undefined,
      status: tx.status,
      errorCode: tx.errorCode,
      errorMessage: tx.error,
    });

    if (tx.status !== "success") {
      const status =
        tx.errorCode === "NO_ACCOUNT" ||
        tx.errorCode === "FACTORY_NOT_DEPLOYED" ||
        tx.errorCode === "PROVIDER_UNAVAILABLE"
          ? 400
          : 500;
      return NextResponse.json(
        {
          error: tx.error ?? "Market creation failed",
          errorCode: tx.errorCode,
          executionSurface: tx.executionSurface,
        },
        { status }
      );
    }

    const markets = await getMarkets();
    const createdMarket = [...markets]
      .reverse()
      .find(
        (m) =>
          m.questionHash.toLowerCase() === questionHash.toLowerCase() &&
          m.resolutionTime === resolutionTime
      );

    if (createdMarket) {
      setMarketQuestion(createdMarket.id, parsed.question);
      await recordAudit({
        organizationId: context.membership.organizationId,
        userId: context.user.id,
        action: "market.create",
        targetType: "market",
        targetId: String(createdMarket.id),
        metadata: {
          question: parsed.question,
          feeBps: parsed.feeBps,
          executionSurface: tx.executionSurface,
          txHash: tx.txHash,
        },
      });
    }

    return NextResponse.json({
      ...tx,
      market: createdMarket
        ? {
            ...createdMarket,
            question: parsed.question.trim(),
            totalPool: createdMarket.totalPool.toString(),
            yesPool: createdMarket.yesPool.toString(),
            noPool: createdMarket.noPool.toString(),
          }
        : null,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 400 });
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
