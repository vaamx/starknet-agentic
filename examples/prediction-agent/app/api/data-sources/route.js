"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const research_agent_1 = require("@/lib/research-agent");
/**
 * Data Sources endpoint.
 * GET ?question=...&sources=polymarket,coingecko
 * Returns aggregated data from all requested sources.
 */
async function GET(request) {
    const question = request.nextUrl.searchParams.get("question");
    if (!question) {
        return Response.json({ error: "Missing 'question' query parameter" }, { status: 400 });
    }
    const sourcesParam = request.nextUrl.searchParams.get("sources");
    const sources = sourcesParam
        ? sourcesParam.split(",")
        : undefined;
    const results = await (0, research_agent_1.quickResearch)(question, sources);
    return Response.json({
        question,
        timestamp: Date.now(),
        sourceCount: results.length,
        results,
    });
}
