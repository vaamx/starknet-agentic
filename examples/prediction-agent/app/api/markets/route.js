"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const market_reader_1 = require("@/lib/market-reader");
async function GET() {
    try {
        const markets = await (0, market_reader_1.getMarkets)();
        const enriched = markets.map((m) => ({
            ...m,
            question: market_reader_1.DEMO_QUESTIONS[m.id] ?? `Market #${m.id}`,
            totalPool: m.totalPool.toString(),
            yesPool: m.yesPool.toString(),
            noPool: m.noPool.toString(),
        }));
        return server_1.NextResponse.json({ markets: enriched });
    }
    catch (err) {
        return server_1.NextResponse.json({ error: err.message }, { status: 500 });
    }
}
