"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const market_reader_1 = require("@/lib/market-reader");
async function GET(_request, { params }) {
    try {
        const { id } = await params;
        const marketId = parseInt(id, 10);
        const markets = await (0, market_reader_1.getMarkets)();
        const market = markets.find((m) => m.id === marketId);
        if (!market) {
            return server_1.NextResponse.json({ error: "Market not found" }, { status: 404 });
        }
        const [predictions, weightedProb] = await Promise.all([
            (0, market_reader_1.getAgentPredictions)(marketId),
            (0, market_reader_1.getWeightedProbability)(marketId),
        ]);
        return server_1.NextResponse.json({
            market: {
                ...market,
                question: market_reader_1.DEMO_QUESTIONS[marketId] ?? `Market #${marketId}`,
                totalPool: market.totalPool.toString(),
                yesPool: market.yesPool.toString(),
                noPool: market.noPool.toString(),
            },
            predictions,
            weightedProbability: weightedProb,
        });
    }
    catch (err) {
        return server_1.NextResponse.json({ error: err.message }, { status: 500 });
    }
}
