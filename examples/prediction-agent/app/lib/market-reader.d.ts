export interface MarketState {
    id: number;
    address: string;
    questionHash: string;
    resolutionTime: number;
    oracle: string;
    collateralToken: string;
    feeBps: number;
    status: number;
    totalPool: bigint;
    yesPool: bigint;
    noPool: bigint;
    impliedProbYes: number;
    impliedProbNo: number;
    winningOutcome?: number;
}
export interface AgentPrediction {
    agent: string;
    marketId: number;
    predictedProb: number;
    brierScore: number;
    predictionCount: number;
}
export interface LeaderboardEntry {
    agent: string;
    avgBrier: number;
    predictionCount: number;
    rank: number;
}
/** Get all markets from the factory. */
export declare function getMarkets(): Promise<MarketState[]>;
/** Get a single market's state. */
export declare function getMarketState(id: number, address: string): Promise<MarketState>;
/** Get agent predictions for a market. */
export declare function getAgentPredictions(marketId: number): Promise<AgentPrediction[]>;
/** Get reputation-weighted probability. */
export declare function getWeightedProbability(marketId: number): Promise<number>;
/** Demo leaderboard data. */
export declare function getDemoLeaderboard(): LeaderboardEntry[];
export declare const DEMO_QUESTIONS: Record<number, string>;
