"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
const server_1 = require("next/server");
const zod_1 = require("zod");
const starknet_executor_1 = require("@/lib/starknet-executor");
const market_reader_1 = require("@/lib/market-reader");
const BetSchema = zod_1.z.object({
    marketId: zod_1.z.number().int().min(0),
    outcome: zod_1.z.union([zod_1.z.literal(0), zod_1.z.literal(1)]),
    amount: zod_1.z.string(), // bigint as string
    executionSurface: zod_1.z.enum(["direct", "starkzap", "avnu"]).optional(),
});
async function POST(request) {
    try {
        const body = await request.json();
        const parsed = BetSchema.parse(body);
        const markets = await (0, market_reader_1.getMarkets)();
        const market = markets.find((m) => m.id === parsed.marketId);
        if (!market) {
            return server_1.NextResponse.json({ error: "Market not found" }, { status: 404 });
        }
        if (market.status !== 0) {
            return server_1.NextResponse.json({ error: "Market is not open" }, { status: 400 });
        }
        const result = await (0, starknet_executor_1.placeBet)(market.address, parsed.outcome, BigInt(parsed.amount), market.collateralToken, parsed.executionSurface);
        return server_1.NextResponse.json(result);
    }
    catch (err) {
        if (err instanceof zod_1.z.ZodError) {
            return server_1.NextResponse.json({ error: err.errors }, { status: 400 });
        }
        return server_1.NextResponse.json({ error: err.message }, { status: 500 });
    }
}
