/**
 * Brier score utilities for prediction accuracy tracking.
 *
 * Brier score = (predicted_probability - actual_outcome)^2
 * Range: 0 (perfect) to 1 (worst).
 * Lower is better.
 */
/** Compute a single Brier score (off-chain). */
export declare function brierScore(predictedProb: number, actualOutcome: 0 | 1): number;
/** Compute average Brier score from cumulative values (matches on-chain representation). */
export declare function averageBrier(cumulativeScaled: bigint, count: bigint): number;
/** Convert on-chain scaled probability (0..1e18) to a 0..1 float. */
export declare function fromScaled(scaled: bigint): number;
/** Convert a 0..1 float to on-chain scaled probability (0..1e18). */
export declare function toScaled(prob: number): bigint;
/** Compute implied probability from pool sizes. */
export declare function impliedProbability(yesPool: bigint, noPool: bigint): number;
/** Compute payout for a winning bet. */
export declare function computePayout(userBet: bigint, totalPool: bigint, winningPool: bigint, feeBps: number): bigint;
/** Format Brier score for display. */
export declare function formatBrier(score: number): string;
/** Get accuracy tier based on Brier score. */
export declare function accuracyTier(avgBrier: number): {
    label: string;
    color: string;
};
/** Edge BPS between two probability estimates (reuses prediction-arb-scanner pattern). */
export declare function computeEdgeBps(probA: number, probB: number): number;
