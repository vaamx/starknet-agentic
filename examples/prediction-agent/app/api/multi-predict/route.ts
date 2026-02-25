import { NextRequest } from "next/server";
import { forecastMarket } from "@/lib/agent-forecaster";
import { agenticForecastMarket, type AgenticForecastEvent } from "@/lib/forecast-tools";
import { AGENT_PERSONAS } from "@/lib/agent-personas";
import { getMarketById, getAgentPredictions, MARKET_QUESTIONS, SUPER_BOWL_REGEX } from "@/lib/market-reader";
import { gatherResearch, buildResearchBrief } from "@/lib/data-sources/index";
import type { DataSourceName } from "@/lib/data-sources/index";
import { runDebateRound, type Round1Result } from "@/lib/agent-debate";
import { requireX402 } from "@/lib/x402-middleware";
import { config } from "@/lib/config";
import { z } from "zod";
import { enforceRateLimit, jsonError } from "@/lib/api-guard";

/**
 * Multi-agent forecast endpoint.
 * Runs all agent personas on a market and streams their reasoning.
 * Round 1: Independent forecasts. Round 2: Debate with revisions.
 * Final output: reputation-weighted consensus from Round 2 estimates.
 */
export const maxDuration = 60;
const multiPredictBodySchema = z.object({
  marketId: z.number().int().min(1),
});

export async function POST(request: NextRequest) {
  const rateLimited = await enforceRateLimit(request, "multi_predict", {
    windowMs: 60_000,
    maxRequests: 12,
  });
  if (rateLimited) return rateLimited;

  // Phase C: X-402 payment check — must happen BEFORE opening the SSE stream
  const paymentResult = await requireX402(request, "multi_predict", config.x402PriceMultiPredict);
  if (paymentResult instanceof Response) return paymentResult; // HTTP 402

  let marketId: number;
  try {
    const body = multiPredictBodySchema.parse(await request.json());
    marketId = body.marketId;
  } catch (err: any) {
    return jsonError("Invalid request body", 400, err?.issues ?? err?.message);
  }

  const market = await getMarketById(marketId);

  if (!market) {
    return jsonError("Market not found", 404);
  }

  const predictions = await getAgentPredictions(marketId);
  const question = MARKET_QUESTIONS[marketId] ?? `Market #${marketId}`;

  const daysUntil = Math.max(
    0,
    Math.floor((market.resolutionTime - Date.now() / 1000) / 86400)
  );

  const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
  if (!hasApiKey) {
    return jsonError("Anthropic API key not configured", 400);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const agentResults: {
          agent: string;
          name: string;
          probability: number;
          brierScore: number | null;
        }[] = [];

        const sourceSet = new Set<DataSourceName>();
        for (const persona of AGENT_PERSONAS) {
          for (const src of (persona.preferredSources ?? ["polymarket", "coingecko", "news", "social"])) {
            sourceSet.add(src as DataSourceName);
          }
        }
        if (SUPER_BOWL_REGEX.test(question)) {
          sourceSet.add("espn");
        }
        const sources = Array.from(sourceSet);

        let researchBrief = "";
        let researchCount = 0;
        try {
          const research = await gatherResearch(question, sources);
          researchCount = research.length;
          researchBrief = buildResearchBrief(research);
        } catch {
          researchBrief = "";
        }

        // Compute once — same value for all 5 persona iterations.
        const useToolUse = process.env.AGENT_TOOL_USE_ENABLED !== "false";

        // Base context fields are identical across all personas; only systemPrompt varies.
        // Factoring avoids re-computing agentPredictions.map() 5× unnecessarily.
        const baseContext = {
          currentMarketProb: market.impliedProbYes,
          totalPool: (market.totalPool / 10n ** 18n).toString(),
          agentPredictions: predictions.map((p) => ({
            agent: p.agent.slice(0, 10),
            prob: p.predictedProb,
            brier: p.brierScore,
          })),
          timeUntilResolution: `${daysUntil} days`,
          researchBrief,
        };

        // ======== ROUND 1: Independent Forecasts ========
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

          let probability: number;

          if (researchCount > 0) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: "text",
                  agentId: persona.id,
                  content: `[Researched ${researchCount} data sources: ${sources.join(", ")}]\n\n`,
                })}\n\n`
              )
            );
          }

          const forecastContext = { ...baseContext, systemPrompt: persona.systemPrompt };

          const generator = useToolUse
            ? agenticForecastMarket(question, forecastContext)
            : forecastMarket(question, forecastContext);

          let result: any;
          while (true) {
            const { value, done } = await generator.next();
            if (done) {
              result = value;
              break;
            }
            if (useToolUse) {
              const event = value as AgenticForecastEvent;
              if (event.type === "reasoning_chunk") {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ type: "text", agentId: persona.id, content: event.content })}\n\n`
                  )
                );
              } else if (event.type === "tool_call") {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ type: "tool_call", agentId: persona.id, toolName: event.toolName, toolUseId: event.toolUseId, input: event.input })}\n\n`
                  )
                );
              } else if (event.type === "tool_result") {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: "tool_result",
                      agentId: persona.id,
                      toolName: event.toolName,
                      toolUseId: event.toolUseId,
                      result: event.result,
                      isError: event.isError,
                      source: event.source,
                      dataPoints: event.dataPoints,
                    })}\n\n`
                  )
                );
              }
            } else {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "text", agentId: persona.id, content: value as string })}\n\n`
                )
              );
            }
          }

          if (typeof result?.probability !== "number") {
            throw new Error(`Forecast missing probability for ${persona.name}`);
          }
          probability = result.probability;

          const brierScore = null;

          agentResults.push({
            agent: persona.id,
            name: persona.name,
            probability,
            brierScore,
          });

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "agent_complete",
                agentId: persona.id,
                agentName: persona.name,
                probability,
                brierScore,
              })}\n\n`
            )
          );
        }

        // ======== ROUND 2: Agent Debate ========
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "debate_start" })}\n\n`
          )
        );

        const round1Results: Round1Result[] = agentResults.map((a) => ({
          agentId: a.agent,
          agentName: a.name,
          probability: a.probability,
          brierScore: a.brierScore,
        }));

        const debateResults = await runDebateRound(round1Results, question, Object.fromEntries(
          AGENT_PERSONAS.map((p) => [p.id, p.systemPrompt])
        ));

        for (const debate of debateResults) {
          // Stream debate reasoning
          const chunks = debate.debateReasoning.split(/(?<=\n\n)/);
          for (const chunk of chunks) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: "debate_text",
                  agentId: debate.agentId,
                  content: chunk,
                })}\n\n`
              )
            );
            await new Promise((r) => setTimeout(r, 80));
          }

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "debate_complete",
                agentId: debate.agentId,
                agentName: debate.agentName,
                originalProbability: debate.originalProbability,
                revisedProbability: debate.revisedProbability,
              })}\n\n`
            )
          );

          // Update probability to revised estimate
          const idx = agentResults.findIndex((a) => a.agent === debate.agentId);
          if (idx >= 0) {
            agentResults[idx].probability = debate.revisedProbability;
          }
        }

        // ======== CONSENSUS (from Round 2 revised estimates) ========
        const totalWeight = agentResults.length || 1;
        const weightedProb =
          agentResults.reduce((sum, a) => sum + a.probability, 0) /
          totalWeight;

        const simpleAvg =
          agentResults.reduce((sum, a) => sum + a.probability, 0) /
          agentResults.length;

        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "consensus",
              weightedProbability: weightedProb,
              simpleProbability: simpleAvg,
              agentCount: agentResults.length,
              agents: agentResults.map((a) => ({
                id: a.agent,
                name: a.name,
                probability: a.probability,
                brierScore: a.brierScore,
                weight: 1 / totalWeight,
              })),
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
      "X-Accel-Buffering": "no",
    },
  });
}
