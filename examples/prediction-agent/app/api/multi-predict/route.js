"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
const agent_forecaster_1 = require("@/lib/agent-forecaster");
const agent_personas_1 = require("@/lib/agent-personas");
const market_reader_1 = require("@/lib/market-reader");
const index_1 = require("@/lib/data-sources/index");
/**
 * Multi-agent forecast endpoint.
 * Runs all agent personas on a market and streams their reasoning.
 * Each agent produces an independent probability estimate.
 * The final output includes a reputation-weighted consensus.
 */
async function POST(request) {
    const body = await request.json();
    const marketId = body.marketId;
    const markets = await (0, market_reader_1.getMarkets)();
    const market = markets.find((m) => m.id === marketId);
    if (!market) {
        return new Response(JSON.stringify({ error: "Market not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
        });
    }
    const predictions = await (0, market_reader_1.getAgentPredictions)(marketId);
    const question = market_reader_1.DEMO_QUESTIONS[marketId] ?? `Market #${marketId}`;
    const daysUntil = Math.max(0, Math.floor((market.resolutionTime - Date.now() / 1000) / 86400));
    const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            try {
                const agentResults = [];
                // Process each persona
                for (const persona of agent_personas_1.AGENT_PERSONAS) {
                    // Signal which agent is starting
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                        type: "agent_start",
                        agentId: persona.id,
                        agentName: persona.name,
                        agentType: persona.agentType,
                        model: persona.model,
                    })}\n\n`));
                    let probability;
                    if (hasApiKey && persona.id === "alpha") {
                        // Gather research data for the primary agent
                        const sources = (persona.preferredSources ?? ["polymarket", "coingecko", "news", "social"]);
                        let researchBrief = "";
                        try {
                            const research = await (0, index_1.gatherResearch)(question, sources);
                            researchBrief = (0, index_1.buildResearchBrief)(research);
                            // Stream a research summary event
                            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                                type: "text",
                                agentId: persona.id,
                                content: `[Researched ${research.length} data sources: ${research.map((r) => r.source).join(", ")}]\n\n`,
                            })}\n\n`));
                        }
                        catch {
                            // Research failed, continue without it
                        }
                        const generator = (0, agent_forecaster_1.forecastMarket)(question, {
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
                        let result;
                        while (true) {
                            const { value, done } = await generator.next();
                            if (done) {
                                result = value;
                                break;
                            }
                            fullText += value;
                            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                                type: "text",
                                agentId: persona.id,
                                content: value,
                            })}\n\n`));
                        }
                        probability = result?.probability ?? (0, agent_forecaster_1.extractProbability)(fullText);
                    }
                    else {
                        // Simulated forecast for other agents
                        const forecast = (0, agent_personas_1.simulatePersonaForecast)(persona, market.impliedProbYes, question);
                        probability = forecast.probability;
                        // Stream the simulated reasoning in chunks for visual effect
                        const chunks = forecast.reasoning.split(/(?<=\n\n)/);
                        for (const chunk of chunks) {
                            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                                type: "text",
                                agentId: persona.id,
                                content: chunk,
                            })}\n\n`));
                            await new Promise((r) => setTimeout(r, 100));
                        }
                    }
                    // Find this agent's existing Brier score from predictions
                    const existing = predictions.find((p) => p.agent === `0x${persona.id.charAt(0).toUpperCase()}${persona.id.slice(1)}`);
                    const brierScore = existing?.brierScore ?? 0.2 + Math.random() * 0.15;
                    agentResults.push({
                        agent: persona.id,
                        name: persona.name,
                        probability,
                        brierScore,
                    });
                    // Signal agent completion
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                        type: "agent_complete",
                        agentId: persona.id,
                        agentName: persona.name,
                        probability,
                        brierScore,
                    })}\n\n`));
                }
                // Compute reputation-weighted consensus
                const totalInverseWeight = agentResults.reduce((sum, a) => sum + (a.brierScore > 0 ? 1 / a.brierScore : 10), 0);
                const weightedProb = agentResults.reduce((sum, a) => sum +
                    a.probability *
                        (a.brierScore > 0 ? 1 / a.brierScore : 10), 0) / totalInverseWeight;
                const simpleAvg = agentResults.reduce((sum, a) => sum + a.probability, 0) /
                    agentResults.length;
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                    type: "consensus",
                    weightedProbability: weightedProb,
                    simpleProbability: simpleAvg,
                    agentCount: agentResults.length,
                    agents: agentResults.map((a) => ({
                        id: a.agent,
                        name: a.name,
                        probability: a.probability,
                        brierScore: a.brierScore,
                        weight: a.brierScore > 0 ? (1 / a.brierScore / totalInverseWeight) : 0,
                    })),
                })}\n\n`));
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                controller.close();
            }
            catch (err) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", message: err.message })}\n\n`));
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
