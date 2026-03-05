"use strict";
/**
 * Research Agent — Enriches forecasting with real-world data.
 *
 * Gathers data from multiple sources before invoking Claude for analysis,
 * producing a research-backed forecast rather than a pure LLM prediction.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.researchAndForecast = researchAndForecast;
exports.quickResearch = quickResearch;
const index_1 = require("./data-sources/index");
const agent_forecaster_1 = require("./agent-forecaster");
/**
 * Research and forecast pipeline for a single agent persona.
 * Yields events as research progresses through data gathering and analysis.
 */
async function* researchAndForecast(persona, question, marketContext) {
    const sources = persona.preferredSources ?? [
        "polymarket",
        "coingecko",
        "news",
        "social",
    ];
    // 1. Signal research start
    yield {
        type: "research_start",
        sources: sources,
    };
    // 2. Gather data from relevant sources
    const results = await (0, index_1.gatherResearch)(question, sources);
    yield {
        type: "research_complete",
        results,
    };
    // 3. Build research brief
    const brief = (0, index_1.buildResearchBrief)(results);
    // 4. Run forecast with enriched context
    const generator = (0, agent_forecaster_1.forecastMarket)(question, {
        ...marketContext,
        researchBrief: brief,
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
        yield { type: "forecast_text", content: value };
    }
    const finalResult = result ?? { reasoning: fullText, probability: 0.5 };
    yield {
        type: "forecast_complete",
        probability: finalResult.probability,
        reasoning: finalResult.reasoning,
    };
    return finalResult;
}
/**
 * Quick research-only call (no forecast) — used by the data-sources API endpoint.
 */
async function quickResearch(question, sources) {
    return (0, index_1.gatherResearch)(question, sources);
}
