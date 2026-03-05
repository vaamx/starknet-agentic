/**
 * Research Agent — Enriches forecasting with real-world data.
 *
 * Gathers data from multiple sources before invoking Claude for analysis,
 * producing a research-backed forecast rather than a pure LLM prediction.
 */
import { type DataSourceResult, type DataSourceName } from "./data-sources/index";
import { type ForecastResult } from "./agent-forecaster";
import type { AgentPersona } from "./agent-personas";
export interface ResearchEvent {
    type: "research_start" | "research_complete" | "forecast_text" | "forecast_complete";
    sources?: DataSourceName[];
    results?: DataSourceResult[];
    content?: string;
    probability?: number;
    reasoning?: string;
}
export interface MarketContext {
    currentMarketProb?: number;
    totalPool?: string;
    agentPredictions?: {
        agent: string;
        prob: number;
        brier: number;
    }[];
    timeUntilResolution?: string;
}
/**
 * Research and forecast pipeline for a single agent persona.
 * Yields events as research progresses through data gathering and analysis.
 */
export declare function researchAndForecast(persona: AgentPersona, question: string, marketContext: MarketContext): AsyncGenerator<ResearchEvent, ForecastResult>;
/**
 * Quick research-only call (no forecast) — used by the data-sources API endpoint.
 */
export declare function quickResearch(question: string, sources?: DataSourceName[]): Promise<DataSourceResult[]>;
