"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
const agent_forecaster_1 = require("@/lib/agent-forecaster");
const market_reader_1 = require("@/lib/market-reader");
const starknet_executor_1 = require("@/lib/starknet-executor");
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
    // Stream the reasoning via SSE
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            try {
                const generator = (0, agent_forecaster_1.forecastMarket)(question, {
                    currentMarketProb: market.impliedProbYes,
                    totalPool: (market.totalPool / 10n ** 18n).toString(),
                    agentPredictions: predictions.map((p) => ({
                        agent: p.agent.slice(0, 10),
                        prob: p.predictedProb,
                        brier: p.brierScore,
                    })),
                    timeUntilResolution: `${daysUntil} days`,
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
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "text", content: value })}\n\n`));
                }
                const probability = result?.probability ?? (0, agent_forecaster_1.extractProbability)(fullText);
                // Attempt to record prediction on-chain
                const txResult = await (0, starknet_executor_1.recordPrediction)(marketId, probability);
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                    type: "result",
                    probability,
                    txHash: txResult.txHash,
                    txStatus: txResult.status,
                    txError: txResult.error,
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
