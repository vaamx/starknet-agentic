import { NextRequest } from "next/server";
import { forecastMarket } from "@/lib/agent-forecaster";
import { agenticForecastMarket, type AgenticForecastEvent } from "@/lib/forecast-tools";
import { AGENT_PERSONAS } from "@/lib/agent-personas";
import {
  getMarketById,
  getAgentPredictions,
  resolveMarketQuestion,
  SUPER_BOWL_REGEX,
} from "@/lib/market-reader";
import { gatherResearch, buildResearchBrief } from "@/lib/data-sources/index";
import type { DataSourceName } from "@/lib/data-sources/index";
import { runDebateRound, type Round1Result } from "@/lib/agent-debate";
import { requireX402 } from "@/lib/x402-middleware";
import { config } from "@/lib/config";
import { getLlmConfigurationError } from "@/lib/llm-provider";
import { z } from "zod";
import { enforceRateLimit, jsonError } from "@/lib/api-guard";
import { getPolymarketMarketById } from "@/lib/polymarket-reader";
import { getPersistedExternalForecasts } from "@/lib/state-store";

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

  const onChainMarket = await getMarketById(marketId);
  let question: string;
  let impliedProbYes: number;
  let totalPoolDisplay: string;
  let resolutionTime: number;

  if (onChainMarket) {
    question = resolveMarketQuestion(marketId, onChainMarket.questionHash);
    impliedProbYes = onChainMarket.impliedProbYes;
    totalPoolDisplay = (onChainMarket.totalPool / 10n ** 18n).toString();
    resolutionTime = onChainMarket.resolutionTime;
  } else if (marketId >= 100_000) {
    const polyMarket = await getPolymarketMarketById(marketId);
    if (!polyMarket) return jsonError("Market not found", 404);
    question = polyMarket.question;
    impliedProbYes = polyMarket.impliedProbYes;
    totalPoolDisplay = polyMarket.volume24h
      ? `$${Math.round(polyMarket.volume24h).toLocaleString()} (Polymarket)`
      : "N/A";
    resolutionTime = polyMarket.resolutionTime;
  } else {
    return jsonError("Market not found", 404);
  }

  const predictions = await getAgentPredictions(marketId);

  const daysUntil = Math.max(
    0,
    Math.floor((resolutionTime - Date.now() / 1000) / 86400)
  );

  if (!config.llmConfigured) {
    return jsonError(getLlmConfigurationError(), 400);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // Safety timeout — kill stream before Vercel's 60s limit
      const streamTimeout = setTimeout(() => {
        try {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "error", message: "Swarm forecast timed out" })}\n\n`
            )
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch { /* stream may already be closed */ }
      }, 55_000);

      try {
        const agentResults: {
          agent: string;
          name: string;
          probability: number;
          brierScore: number | null;
        }[] = [];

        // ======== BYOK: Fetch network agent forecasts (free — they use their own keys) ========
        const externalForecasts = await getPersistedExternalForecasts(marketId, 24).catch(() => []);
        const validExternals = externalForecasts.filter(
          (f) => typeof f.probability === "number" && f.probability >= 0 && f.probability <= 1
        );

        // Dedup by agent name — keep most recent forecast per agent
        const seen = new Map<string, typeof validExternals[0]>();
        for (const f of validExternals) {
          const existing = seen.get(f.agentName);
          if (!existing || f.receivedAt > existing.receivedAt) {
            seen.set(f.agentName, f);
          }
        }
        const dedupedExternals = Array.from(seen.values()).slice(0, 10);

        // Stream external agent forecasts as instant participants (no API cost)
        for (const ext of dedupedExternals) {
          const extId = `ext_${ext.agentName.replace(/\s+/g, "_").toLowerCase()}`;
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "agent_start",
                agentId: extId,
                agentName: ext.agentName,
                agentType: "network-agent",
                model: "BYOK",
                isExternal: true,
              })}\n\n`
            )
          );

          // Stream their reasoning if available
          if (ext.reasoning) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: "text",
                  agentId: extId,
                  content: ext.reasoning.slice(0, 2000),
                })}\n\n`
              )
            );
          } else {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: "text",
                  agentId: extId,
                  content: `[Network agent forecast submitted via BYOK — ${ext.agentName} uses their own LLM]`,
                })}\n\n`
              )
            );
          }

          agentResults.push({
            agent: extId,
            name: ext.agentName,
            probability: ext.probability,
            brierScore: null,
          });

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "agent_complete",
                agentId: extId,
                agentName: ext.agentName,
                probability: ext.probability,
                brierScore: null,
                isExternal: true,
              })}\n\n`
            )
          );
        }

        // Reduce internal personas proportionally — each external agent saves one API call.
        // Always keep at least 1 internal persona for quality baseline.
        const maxInternal = Math.max(1, AGENT_PERSONAS.length - dedupedExternals.length);
        const activePersonas = AGENT_PERSONAS.slice(0, maxInternal);

        const sourceSet = new Set<DataSourceName>();
        for (const persona of activePersonas) {
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

        // Swarm mode: always disable tool-use. Research is gathered upfront and
        // passed via researchBrief, so per-agent tool-use is redundant and too slow
        // for Vercel's 60s limit (5 sequential agents × 20-40s each with native tools).
        const useToolUse = false;

        // Base context fields are identical across all personas; only systemPrompt varies.
        // Factoring avoids re-computing agentPredictions.map() 5× unnecessarily.
        const baseContext = {
          currentMarketProb: impliedProbYes,
          totalPool: totalPoolDisplay,
          agentPredictions: predictions.map((p) => ({
            agent: p.agent.slice(0, 10),
            prob: p.predictedProb,
            brier: p.brierScore,
          })),
          timeUntilResolution: `${daysUntil} days`,
          researchBrief,
        };

        // ======== ROUND 1: Independent Forecasts ========
        for (const persona of activePersonas) {
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

          // Run forecast with timeout + fallback (tool-use → no-tool-use → skip)
          async function runAgentForecast(withTools: boolean): Promise<any> {
            const generator = withTools
              ? agenticForecastMarket(question, forecastContext)
              : forecastMarket(question, forecastContext);

            // 8s per-agent timeout (no tool-use in swarm, just streaming LLM generation)
            // Budget: 5 agents × 8s = 40s + 10s debate + 5s overhead = 55s < 60s Vercel limit
            const deadline = Date.now() + 8_000;
            let result: any;
            while (true) {
              if (Date.now() > deadline) {
                throw new Error(`Agent ${persona.name} forecast timed out`);
              }
              const stepPromise = generator.next();
              const timeLeft = Math.max(1000, deadline - Date.now());
              const { value, done } = await Promise.race([
                stepPromise,
                new Promise<never>((_, reject) =>
                  setTimeout(() => reject(new Error(`Step timeout for ${persona.name}`)), timeLeft)
                ),
              ]);
              if (done) {
                result = value;
                break;
              }
              if (withTools) {
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
            return result;
          }

          let result: any;
          try {
            result = await runAgentForecast(useToolUse);
          } catch (primaryErr: any) {
            // Fallback: retry without tool-use for speed
            console.warn(`[multi-predict] ${persona.name} primary failed: ${primaryErr?.message}. Retrying without tools...`);
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "text", agentId: persona.id, content: `\n[Retrying ${persona.name} with fallback provider...]\n` })}\n\n`
              )
            );
            try {
              result = await runAgentForecast(false);
            } catch (fallbackErr: any) {
              console.error(`[multi-predict] ${persona.name} fallback also failed: ${fallbackErr?.message}`);
              // Skip this agent — use market prob as default
              result = { probability: impliedProbYes };
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "text", agentId: persona.id, content: `\n[${persona.name} forecast failed, using market probability]\n` })}\n\n`
                )
              );
            }
          }

          if (typeof result?.probability !== "number") {
            // Use market probability as safe default
            result = { probability: impliedProbYes };
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

        let debateResults: Awaited<ReturnType<typeof runDebateRound>>;
        try {
          debateResults = await Promise.race([
            runDebateRound(round1Results, question, {
              ...Object.fromEntries(
                activePersonas.map((p) => [p.id, p.systemPrompt])
              ),
              // External agents skip debate (no API cost) — their Round 1 estimate carries through
            }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("Debate round timed out")), 20_000)
            ),
          ]);
        } catch (debateErr: any) {
          console.warn(`[multi-predict] Debate failed: ${debateErr?.message}. Skipping debate.`);
          // Skip debate — just use Round 1 results as-is
          debateResults = round1Results.map((r) => ({
            agentId: r.agentId,
            agentName: r.agentName,
            originalProbability: r.probability,
            revisedProbability: r.probability,
            debateReasoning: "[Debate skipped due to timeout]",
          }));
        }

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
        const simpleAvg =
          agentResults.reduce((sum, a) => sum + a.probability, 0) /
          (agentResults.length || 1);

        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "consensus",
              weightedProbability: simpleAvg,
              simpleProbability: simpleAvg,
              agentCount: agentResults.length,
              agents: agentResults.map((a) => ({
                id: a.agent,
                name: a.name,
                probability: a.probability,
                brierScore: a.brierScore,
                weight: 1 / (agentResults.length || 1),
              })),
            })}\n\n`
          )
        );

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        clearTimeout(streamTimeout);
        controller.close();
      } catch (err: any) {
        clearTimeout(streamTimeout);
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
