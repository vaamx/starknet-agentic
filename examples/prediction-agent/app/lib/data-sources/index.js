"use strict";
/**
 * Unified Data Sources — Aggregates real-world data for agent research.
 *
 * Each source fetches external data and falls back to demo data
 * when API keys are missing or requests fail.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.gatherResearch = gatherResearch;
exports.buildResearchBrief = buildResearchBrief;
const polymarket_1 = require("./polymarket");
const crypto_prices_1 = require("./crypto-prices");
const news_search_1 = require("./news-search");
const social_trends_1 = require("./social-trends");
const SOURCE_FETCHERS = {
    polymarket: polymarket_1.fetchPolymarketData,
    coingecko: crypto_prices_1.fetchCryptoPrices,
    news: news_search_1.fetchNewsData,
    social: social_trends_1.fetchSocialTrends,
};
const ALL_SOURCES = [
    "polymarket",
    "coingecko",
    "news",
    "social",
];
/**
 * Gather research from multiple data sources in parallel.
 * Returns results from all requested sources (defaults to all).
 */
async function gatherResearch(question, sources) {
    const selectedSources = sources ?? ALL_SOURCES;
    const results = await Promise.allSettled(selectedSources.map((source) => {
        const fetcher = SOURCE_FETCHERS[source];
        return fetcher(question);
    }));
    return results
        .filter((r) => r.status === "fulfilled")
        .map((r) => r.value);
}
/**
 * Build a concise research brief from data source results for injection into Claude prompts.
 */
function buildResearchBrief(results) {
    if (results.length === 0)
        return "";
    const sections = results.map((r) => {
        const points = r.data
            .slice(0, 5)
            .map((d) => `  - ${d.label}: ${d.value}`)
            .join("\n");
        return `### ${r.source.toUpperCase()} Data\n${r.summary}\n${points}`;
    });
    return `## Real-World Research Data (gathered ${new Date().toISOString()})\n\n${sections.join("\n\n")}`;
}
