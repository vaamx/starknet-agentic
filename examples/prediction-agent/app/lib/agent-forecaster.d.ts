export interface ForecastResult {
    reasoning: string;
    probability: number;
}
/** Stream a forecast analysis from Claude. Yields reasoning text chunks. */
export declare function forecastMarket(question: string, context: {
    currentMarketProb?: number;
    totalPool?: string;
    agentPredictions?: {
        agent: string;
        prob: number;
        brier: number;
    }[];
    timeUntilResolution?: string;
    researchBrief?: string;
}): AsyncGenerator<string, ForecastResult>;
/** Extract probability from Claude's response. */
export declare function extractProbability(text: string): number;
