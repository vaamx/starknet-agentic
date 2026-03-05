/**
 * Unified Data Sources — Aggregates real-world data for agent research.
 *
 * Each source fetches external data and falls back to demo data
 * when API keys are missing or requests fail.
 */
export interface DataPoint {
    label: string;
    value: string | number;
    url?: string;
    confidence?: number;
}
export interface DataSourceResult {
    source: string;
    query: string;
    timestamp: number;
    data: DataPoint[];
    summary: string;
}
export type DataSourceName = "polymarket" | "coingecko" | "news" | "social";
/**
 * Gather research from multiple data sources in parallel.
 * Returns results from all requested sources (defaults to all).
 */
export declare function gatherResearch(question: string, sources?: DataSourceName[]): Promise<DataSourceResult[]>;
/**
 * Build a concise research brief from data source results for injection into Claude prompts.
 */
export declare function buildResearchBrief(results: DataSourceResult[]): string;
