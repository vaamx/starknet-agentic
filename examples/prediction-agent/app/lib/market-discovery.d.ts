/**
 * Market Discovery — Auto-discovers interesting markets from real-world events.
 *
 * Generates suggested prediction market questions from trending topics
 * across crypto, politics, sports, tech, and entertainment.
 */
export interface SuggestedMarket {
    question: string;
    category: "crypto" | "politics" | "sports" | "tech" | "entertainment";
    suggestedResolutionDays: number;
    sourceUrl?: string;
    estimatedProbability?: number;
    reasoning?: string;
}
/**
 * Discover suggested markets. Returns a rotating set based on time.
 * In the future, this could pull from Polymarket trending + news events.
 */
export declare function discoverMarkets(category?: string, limit?: number): Promise<SuggestedMarket[]>;
/**
 * Get all available categories.
 */
export declare function getCategories(): string[];
