import { NextRequest } from "next/server";
import { z } from "zod";
import { forecastMarket, extractProbability } from "@/lib/agent-forecaster";
import { getMarkets, getAgentPredictions, DEMO_QUESTIONS } from "@/lib/market-reader";
import { getPersona } from "@/lib/agent-personas";
import { recordPrediction } from "@/lib/starknet-executor";
import {
  gatherResearch,
  buildResearchBrief,
  averageResearchQuality,
  type DataSourceName,
} from "@/lib/data-sources/index";
import {
  buildForecastSkillPlan,
  formatForecastSkillPlan,
} from "@/lib/forecast-skills";
import { requireRole } from "@/lib/require-auth";
import {
  recordAudit,
  recordForecast,
  recordResearchArtifact,
  recordTradeExecution,
  getAgentCalibrationMemory,
  getSourceReliabilityProfile,
} from "@/lib/ops-store";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  aggregateSourceReliability,
  adjustWithCalibrationMemory,
  blendResearchQuality,
  deriveConfidenceInterval,
  deriveForecastConfidence,
} from "@/lib/forecast-calibration";

const PredictSchema = z.object({
  marketId: z.number().int().min(0),
});

const DEFAULT_SOURCES: DataSourceName[] = [
  "polymarket",
  "coingecko",
  "news",
  "social",
];

export async function POST(request: NextRequest) {
  const context = requireRole(request, "analyst");
  if (!context) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const rateLimit = checkRateLimit(
    `predict:${context.membership.organizationId}:${context.user.id}`,
    {
      windowMs: 60_000,
      max: 12,
      blockMs: 60_000,
    }
  );
  if (!rateLimit.allowed) {
    return new Response(
      JSON.stringify({ error: "Rate limit exceeded for prediction requests" }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(Math.ceil(rateLimit.retryAfterMs / 1000)),
        },
      }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = PredictSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: parsed.error.issues }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const marketId = parsed.data.marketId;

  const markets = await getMarkets();
  const market = markets.find((m) => m.id === marketId);

  if (!market) {
    return new Response(JSON.stringify({ error: "Market not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const predictions = await getAgentPredictions(marketId);
  const question = DEMO_QUESTIONS[marketId] ?? `Market #${marketId}`;
  const alphaPersona = getPersona("alpha");
  const skillPlan = alphaPersona
    ? buildForecastSkillPlan(question, alphaPersona)
    : null;
  const plannedSources: DataSourceName[] = Array.from(
    new Set([
      ...DEFAULT_SOURCES,
      ...(skillPlan?.recommendedSources ?? []),
    ])
  );
  const [sourceReliabilityProfile, calibrationMemory] = await Promise.all([
    getSourceReliabilityProfile(context.membership.organizationId).catch(
      () => ({})
    ),
    getAgentCalibrationMemory(
      context.membership.organizationId,
      "alpha"
    ).catch(() => ({
      agentId: "alpha",
      samples: 0,
      avgBrier: 0.25,
      calibrationBias: 0,
      reliabilityScore: 0.5,
      confidence: 0,
      memoryStrength: 0,
    })),
  ]);

  const daysUntil = Math.max(
    0,
    Math.floor((market.resolutionTime - Date.now() / 1000) / 86400)
  );

  let researchBrief = "";
  let researchQuality = 0.5;
  try {
    const research = await gatherResearch(question, plannedSources);
    researchBrief = [
      skillPlan ? formatForecastSkillPlan(skillPlan) : "",
      buildResearchBrief(research),
    ]
      .filter((section) => section.length > 0)
      .join("\n\n");
    const liveResearchQuality = averageResearchQuality(research);
    const backtestedReliability = aggregateSourceReliability(
      plannedSources,
      sourceReliabilityProfile
    );
    researchQuality = blendResearchQuality(
      liveResearchQuality,
      backtestedReliability
    );

    for (const item of research) {
      const firstPoint = item.data[0];
      await recordResearchArtifact({
        organizationId: context.membership.organizationId,
        marketId,
        sourceType: item.source,
        sourceUrl: firstPoint?.url,
        title: firstPoint?.label,
        summary: item.summary,
        payloadJson: JSON.stringify(item),
      });
    }
  } catch {
    researchBrief = "";
    researchQuality = aggregateSourceReliability(
      plannedSources,
      sourceReliabilityProfile
    );
  }

  // Stream the reasoning via SSE
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const generator = forecastMarket(question, {
          currentMarketProb: market.impliedProbYes,
          totalPool: (market.totalPool / 10n ** 18n).toString(),
          agentPredictions: predictions.map((p) => ({
            agent: p.agent.slice(0, 10),
            prob: p.predictedProb,
            brier: p.brierScore,
          })),
          timeUntilResolution: `${daysUntil} days`,
          researchBrief,
        });

        let fullText = "";
        let result: any;

        while (true) {
          const { value, done } = await generator.next();
          if (done) {
            result = value;
            break;
          }
          fullText += value;
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "text", content: value })}\n\n`)
          );
        }

        let probability = result?.probability ?? extractProbability(fullText);
        const memoryAdjustment = adjustWithCalibrationMemory(
          probability,
          calibrationMemory,
          researchQuality
        );
        probability = memoryAdjustment.adjustedProbability;
        const confidence = deriveForecastConfidence(
          probability,
          researchQuality,
          calibrationMemory
        );
        const confidenceInterval = deriveConfidenceInterval(probability, confidence);

        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "text",
              content: `[Calibration memory n=${calibrationMemory.samples}, bias=${(
                calibrationMemory.calibrationBias * 100
              ).toFixed(1)}pt, adjust=${(
                memoryAdjustment.adjustment * 100
              ).toFixed(1)}pt]\n\n`,
            })}\n\n`
          )
        );

        // Attempt to record prediction on-chain
        const txResult = await recordPrediction(marketId, probability);
        await recordForecast({
          organizationId: context.membership.organizationId,
          marketId,
          userId: context.user.id,
          agentId: "alpha",
          probability,
          confidence,
          modelName: "claude",
          rationale: fullText.slice(0, 2000),
        });
        await recordTradeExecution({
          organizationId: context.membership.organizationId,
          marketId,
          userId: context.user.id,
          executionSurface: txResult.executionSurface,
          txHash: txResult.txHash || undefined,
          status: txResult.status,
          errorCode: txResult.errorCode,
          errorMessage: txResult.error,
        });
        await recordAudit({
          organizationId: context.membership.organizationId,
          userId: context.user.id,
          action: "market.predict",
          targetType: "market",
          targetId: String(marketId),
          metadata: {
            probability,
            confidence,
            confidenceInterval,
            researchQuality,
            calibrationMemory,
            calibrationAdjustment: memoryAdjustment.adjustment,
            skillCount: skillPlan?.skills.length ?? 0,
            txStatus: txResult.status,
            executionSurface: txResult.executionSurface,
          },
        });

        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "result",
              probability,
              confidence,
              confidenceInterval,
              researchQuality,
              calibrationMemory: {
                samples: calibrationMemory.samples,
                reliabilityScore: calibrationMemory.reliabilityScore,
              },
              calibrationAdjustment: memoryAdjustment.adjustment,
              skillCount: skillPlan?.skills.length ?? 0,
              txHash: txResult.txHash,
              txStatus: txResult.status,
              txError: txResult.error,
            })}\n\n`
          )
        );

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (err: any) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "error", message: err.message })}\n\n`
          )
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
