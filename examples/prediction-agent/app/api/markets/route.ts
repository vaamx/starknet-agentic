import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { getMarkets, DEMO_QUESTIONS, setMarketQuestion } from "@/lib/market-reader";
import { createMarket, type ExecutionSurface } from "@/lib/starknet-executor";
import { requireRole } from "@/lib/require-auth";
import { recordAudit, recordTradeExecution } from "@/lib/ops-store";
import { reviewMarketQuestion } from "@/lib/market-quality";

const CreateMarketSchema = z.object({
  question: z.string().min(5).max(280),
  days: z.number().int().min(1).max(3650),
  feeBps: z.number().int().min(0).max(1000),
  oracle: z.string().regex(/^0x[0-9a-fA-F]+$/).optional(),
  category: z
    .enum(["crypto", "macro", "politics", "tech", "sports", "other"])
    .optional(),
  resolutionCriteria: z.string().min(12).max(600).optional(),
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
    const quality = reviewMarketQuestion(parsed.question);

    if (quality.issues.length > 0 || quality.score < 60) {
      return NextResponse.json(
        {
          error: "Market question quality check failed",
          issues: quality.issues,
          warnings: quality.warnings,
          qualityScore: quality.score,
        },
        { status: 400 }
      );
    }

    const now = Math.floor(Date.now() / 1000);
    const resolutionTime = now + parsed.days * 86400;
    const normalizedQuestion = quality.normalizedQuestion;
    const questionHash = hashQuestionToFelt(normalizedQuestion);
    const fallbackOracle = process.env.MARKET_ORACLE_ADDRESS ?? process.env.AGENT_ADDRESS;
    const oracle = parsed.oracle ?? fallbackOracle;

    if (!oracle) {
      return NextResponse.json(
        { error: "No oracle address provided. Set MARKET_ORACLE_ADDRESS or AGENT_ADDRESS." },
        { status: 400 }
      );
    }

    const existingMarketQuestions = new Set(
      Object.values(DEMO_QUESTIONS).map((q) => q.trim().toLowerCase())
    );
    if (existingMarketQuestions.has(normalizedQuestion.toLowerCase())) {
      return NextResponse.json(
        {
          error: "A similar market question already exists",
          qualityScore: quality.score,
        },
        { status: 409 }
      );
    }

    const existingMarkets = await getMarkets();
    if (
      existingMarkets.some(
        (market) => market.questionHash.toLowerCase() === questionHash.toLowerCase()
      )
    ) {
      return NextResponse.json(
        {
          error: "Duplicate market hash detected for this question",
          qualityScore: quality.score,
        },
        { status: 409 }
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
      setMarketQuestion(createdMarket.id, normalizedQuestion);
      await recordAudit({
        organizationId: context.membership.organizationId,
        userId: context.user.id,
        action: "market.create",
        targetType: "market",
        targetId: String(createdMarket.id),
        metadata: {
          question: normalizedQuestion,
          category: parsed.category ?? quality.categoryHint,
          resolutionCriteria: parsed.resolutionCriteria ?? null,
          qualityScore: quality.score,
          warnings: quality.warnings,
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
            question: normalizedQuestion,
            totalPool: createdMarket.totalPool.toString(),
            yesPool: createdMarket.yesPool.toString(),
            noPool: createdMarket.noPool.toString(),
          }
        : null,
      marketQuality: {
        score: quality.score,
        warnings: quality.warnings,
        categoryHint: quality.categoryHint,
      },
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 400 });
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
