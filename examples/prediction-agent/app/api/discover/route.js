"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const market_discovery_1 = require("@/lib/market-discovery");
/**
 * Market Discovery endpoint.
 * GET: Returns suggested markets from the discovery engine.
 * Optional query params: ?category=crypto&limit=5
 */
async function GET(request) {
    const category = request.nextUrl.searchParams.get("category") ?? undefined;
    const limitStr = request.nextUrl.searchParams.get("limit");
    const limit = limitStr ? parseInt(limitStr, 10) : undefined;
    const markets = await (0, market_discovery_1.discoverMarkets)(category, limit);
    return Response.json({
        markets,
        count: markets.length,
        categories: (0, market_discovery_1.getCategories)(),
        timestamp: Date.now(),
    });
}
