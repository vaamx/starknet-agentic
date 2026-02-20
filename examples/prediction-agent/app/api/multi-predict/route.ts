import { NextRequest } from "next/server";
import { forecastMarket } from "@/lib/agent-forecaster";
import { AGENT_PERSONAS } from "@/lib/agent-personas";
import { getMarketById, getAgentPredictions, MARKET_QUESTIONS, SUPER_BOWL_REGEX } from "@/lib/market-reader";
import { gatherResearch, buildResearchBrief } from "@/lib/data-sources/index";
import type { DataSourceName } from "@/lib/data-sources/index";
import { runDebateRound, type Round1Result } from "@/lib/agent-debate";

/**
 * Multi-agent forecast endpoint.
 * Runs all agent personas on a market and streams their reasoning.
 * Round 1: Independent forecasts. Round 2: Debate with revisions.
 * Final output: reputation-weighted consensus from Round 2 estimates.
 */
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const body = await request.json();
  const marketId = body.marketId as number;

  const market = await getMarketById(marketId);

  if (!market) {
    return new Response(JSON.stringify({ error: "Market not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const predictions = await getAgentPredictions(marketId);
  const question = MARKET_QUESTIONS[marketId] ?? `Market #${marketId}`;

  const daysUntil = Math.max(
    0,
    Math.floor((market.resolutionTime - Date.now() / 1000) / 86400)
  );

  const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
  if (!hasApiKey) {
    return new Response(JSON.stringify({ error: "Anthropic API key not configured" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
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
            systemPrompt: persona.systemPrompt,
          });

          let result: any;
          while (true) {
            const { value, done } = await generator.next();
            if (done) {
              result = value;
              break;
            }
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
    },
  });
}
