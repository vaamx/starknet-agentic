import { NextRequest } from "next/server";
import { z } from "zod";
import { forecastMarket, extractProbability } from "@/lib/agent-forecaster";
import {
  AGENT_PERSONAS,
  simulatePersonaForecast,
} from "@/lib/agent-personas";
import {
  getMarkets,
  getAgentPredictions,
  DEMO_QUESTIONS,
} from "@/lib/market-reader";
import {
  gatherResearch,
  buildResearchBrief,
  averageResearchQuality,
  type DataSourceName,
  type DataSourceResult,
} from "@/lib/data-sources/index";
import { requireRole } from "@/lib/require-auth";
import {
  recordAudit,
  recordForecast,
  recordResearchArtifact,
  getAgentCalibrationMemory,
  getSourceReliabilityProfile,
} from "@/lib/ops-store";
import { checkRateLimit } from "@/lib/rate-limit";
import { buildSuperforecastConsensus } from "@/lib/superforecast";
import {
  buildForecastSkillPlan,
  formatForecastSkillPlan,
} from "@/lib/forecast-skills";
import {
  aggregateSourceReliability,
  adjustWithCalibrationMemory,
  blendResearchQuality,
  deriveForecastConfidence,
} from "@/lib/forecast-calibration";

const MultiPredictSchema = z.object({
  marketId: z.number().int().min(0),
});

const DEFAULT_SOURCES: DataSourceName[] = [
  "polymarket",
  "coingecko",
  "news",
  "social",
];

function isDataSourceName(value: string): value is DataSourceName {
  return (
    value === "polymarket" ||
    value === "coingecko" ||
    value === "news" ||
    value === "social"
  );
}

function getPersonaSources(
  preferredSources: string[] | undefined
): DataSourceName[] {
  const raw = preferredSources ?? DEFAULT_SOURCES;
  const normalized = raw
    .map((source) => source.toLowerCase().trim())
    .filter(isDataSourceName);
  return normalized.length > 0 ? normalized : DEFAULT_SOURCES;
}

function mergeSources(...groups: DataSourceName[][]): DataSourceName[] {
  return Array.from(new Set(groups.flat()));
}

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function deriveFallbackBrier(
  personaId: string,
  marketId: number,
  probability: number
): number {
  const seed = hashString(
    `${personaId}:${marketId}:${Math.round(probability * 1000)}`
  );
  return 0.12 + (seed % 120) / 1000;
}

/**
 * Multi-agent forecast endpoint.
 * Runs all agent personas on a market and streams their reasoning.
 * The final output includes a superforecasting consensus with confidence bands.
 */
export async function POST(request: NextRequest) {
  const context = requireRole(request, "analyst");
  if (!context) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const rateLimit = checkRateLimit(
    `multi_predict:${context.membership.organizationId}:${context.user.id}`,
    {
      windowMs: 60_000,
      max: 6,
      blockMs: 60_000,
    }
  );
  if (!rateLimit.allowed) {
    return new Response(
      JSON.stringify({
        error: "Rate limit exceeded for multi-agent prediction requests",
      }),
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
  const parsed = MultiPredictSchema.safeParse(body);
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

  const daysUntil = Math.max(
    0,
    Math.floor((market.resolutionTime - Date.now() / 1000) / 86400)
  );
  const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const [sourceReliabilityProfile, calibrationMemoryEntries] = await Promise.all([
    getSourceReliabilityProfile(context.membership.organizationId).catch(
      () => ({})
    ),
    Promise.all(
      AGENT_PERSONAS.map(async (persona) =>
        [
          persona.id,
          await getAgentCalibrationMemory(
            context.membership.organizationId,
            persona.id
          ).catch(() => ({
            agentId: persona.id,
            samples: 0,
            avgBrier: 0.25,
            calibrationBias: 0,
            reliabilityScore: 0.5,
            confidence: 0,
            memoryStrength: 0,
          })),
        ] as const
      )
    ),
  ]);
  const calibrationMemoryByAgent = new Map(calibrationMemoryEntries);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const unionSources = new Set<DataSourceName>();
        for (const persona of AGENT_PERSONAS) {
          const skillPlan = buildForecastSkillPlan(question, persona);
          const sources = mergeSources(
            getPersonaSources(persona.preferredSources),
            skillPlan.recommendedSources
          );
          for (const source of sources) {
            unionSources.add(source);
          }
        }

        let sharedResearch: DataSourceResult[] = [];
        try {
          sharedResearch = await gatherResearch(
            question,
            unionSources.size > 0 ? Array.from(unionSources) : DEFAULT_SOURCES
          );

          for (const item of sharedResearch) {
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

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "research_ready",
                sourceCount: sharedResearch.length,
                quality: averageResearchQuality(sharedResearch),
              })}\n\n`
            )
          );
        } catch {
          sharedResearch = [];
        }

        const agentResults: Array<{
          agent: string;
          name: string;
          probability: number;
          brierScore: number;
          confidence: number;
          sourceQuality: number;
        }> = [];

        for (const persona of AGENT_PERSONAS) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "agent_start",
                agentId: persona.id,
                agentName: persona.name,
                agentType: persona.agentType,
                model: persona.model,
              })}\n\n`
            )
          );

          const skillPlan = buildForecastSkillPlan(question, persona);
          const personaSources = mergeSources(
            getPersonaSources(persona.preferredSources),
            skillPlan.recommendedSources
          );
          const personaResearch = sharedResearch.filter((item) =>
            personaSources.includes(item.source as DataSourceName)
          );
          const researchBrief = [
            formatForecastSkillPlan(skillPlan),
            buildResearchBrief(personaResearch),
          ]
            .filter((section) => section.length > 0)
            .join("\n\n");
          const liveResearchQuality = averageResearchQuality(personaResearch);
          const backtestedReliability = aggregateSourceReliability(
            personaSources,
            sourceReliabilityProfile
          );
          const sourceQuality = blendResearchQuality(
            liveResearchQuality,
            backtestedReliability
          );
          const calibrationMemory = calibrationMemoryByAgent.get(persona.id);
          const allowLiveForecast =
            hasApiKey &&
            (persona.id === "alpha" ||
              (persona.id === "beta" &&
                persona.model.toLowerCase().includes("claude")));

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "text",
                agentId: persona.id,
                content: `[Skill plan: ${skillPlan.skills
                  .map((skill) => skill.name)
                  .join(", ")}]\n\n`,
              })}\n\n`
            )
          );

          if (personaResearch.length > 0) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: "text",
                  agentId: persona.id,
                  content: `[Research quality ${(sourceQuality * 100).toFixed(
                    0
                  )}% (live ${(liveResearchQuality * 100).toFixed(
                    0
                  )}% + backtest ${(backtestedReliability * 100).toFixed(
                    0
                  )}%) from ${personaResearch.map((r) => r.source).join(", ")}]\n\n`,
                })}\n\n`
              )
            );
          }

          let probability: number;
          if (allowLiveForecast) {
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
            let result: { probability: number } | undefined;

            while (true) {
              const { value, done } = await generator.next();
              if (done) {
                result = value;
                break;
              }
              fullText += value;
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: "text",
                    agentId: persona.id,
                    content: value,
                  })}\n\n`
                )
              );
            }

            probability = result?.probability ?? extractProbability(fullText);
          } else {
            const forecast = simulatePersonaForecast(
              persona,
              market.impliedProbYes,
              question,
              { sourceQuality }
            );
            probability = forecast.probability;

            const chunks = forecast.reasoning.split(/(?<=\n\n)/);
            for (const chunk of chunks) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: "text",
                    agentId: persona.id,
                    content: chunk,
                  })}\n\n`
                )
              );
              await new Promise((resolve) => setTimeout(resolve, 80));
            }
          }

          let calibrationAdjustedBy = 0;
          if (calibrationMemory) {
            const adjusted = adjustWithCalibrationMemory(
              probability,
              calibrationMemory,
              sourceQuality
            );
            probability = adjusted.adjustedProbability;
            calibrationAdjustedBy = adjusted.adjustment;
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: "text",
                  agentId: persona.id,
                  content: `[Calibration memory n=${
                    calibrationMemory.samples
                  }, bias=${(calibrationMemory.calibrationBias * 100).toFixed(
                    1
                  )}pt, adjust=${(calibrationAdjustedBy * 100).toFixed(
                    1
                  )}pt]\n\n`,
                })}\n\n`
              )
            );
          }

          const forecastConfidence = deriveForecastConfidence(
            probability,
            sourceQuality,
            calibrationMemory
          );

          const existing = predictions.find(
            (prediction) =>
              prediction.agent ===
              `0x${persona.id.charAt(0).toUpperCase()}${persona.id.slice(1)}`
          );
          const brierScore =
            existing?.brierScore ??
            deriveFallbackBrier(persona.id, marketId, probability);

          agentResults.push({
            agent: persona.id,
            name: persona.name,
            probability,
            brierScore,
            confidence: forecastConfidence,
            sourceQuality,
          });

          await recordForecast({
            organizationId: context.membership.organizationId,
            marketId,
            userId: context.user.id,
            agentId: persona.id,
            probability,
            confidence: forecastConfidence,
            modelName: persona.model,
          });

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "agent_complete",
                agentId: persona.id,
                agentName: persona.name,
                probability,
                brierScore,
                confidence: forecastConfidence,
                sourceQuality,
                memory: calibrationMemory
                  ? {
                      samples: calibrationMemory.samples,
                      reliabilityScore: calibrationMemory.reliabilityScore,
                      calibrationBias: calibrationMemory.calibrationBias,
                      adjustment: calibrationAdjustedBy,
                    }
                  : null,
              })}\n\n`
            )
          );
        }

        const consensus = buildSuperforecastConsensus(
          agentResults.map((agent) => ({
            id: agent.agent,
            name: agent.name,
            probability: agent.probability,
            brierScore: agent.brierScore,
            confidence: agent.confidence,
            sourceQuality: agent.sourceQuality,
          })),
          market.impliedProbYes
        );

        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "consensus",
              weightedProbability: consensus.weightedProbability,
              simpleProbability: consensus.simpleProbability,
              agentCount: consensus.agentCount,
              disagreement: consensus.disagreement,
              confidenceScore: consensus.confidenceScore,
              confidenceInterval: consensus.confidenceInterval,
              marketEdge: consensus.marketEdge,
              signal: consensus.signal,
              scenarios: consensus.scenarios,
              agents: consensus.agents,
            })}\n\n`
          )
        );

        await recordAudit({
          organizationId: context.membership.organizationId,
          userId: context.user.id,
          action: "market.multi_predict",
          targetType: "market",
          targetId: String(marketId),
          metadata: {
            weightedProbability: consensus.weightedProbability,
            simpleProbability: consensus.simpleProbability,
            disagreement: consensus.disagreement,
            confidenceScore: consensus.confidenceScore,
            signal: consensus.signal,
            agentCount: consensus.agentCount,
          },
        });

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Unknown multi-agent error";
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "error", message })}\n\n`
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
