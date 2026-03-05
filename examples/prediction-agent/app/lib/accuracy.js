"use strict";
/**
 * Brier score utilities for prediction accuracy tracking.
 *
 * Brier score = (predicted_probability - actual_outcome)^2
 * Range: 0 (perfect) to 1 (worst).
 * Lower is better.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.brierScore = brierScore;
exports.averageBrier = averageBrier;
exports.fromScaled = fromScaled;
exports.toScaled = toScaled;
exports.impliedProbability = impliedProbability;
exports.computePayout = computePayout;
exports.formatBrier = formatBrier;
exports.accuracyTier = accuracyTier;
exports.computeEdgeBps = computeEdgeBps;
const SCALE = 1e18;
/** Compute a single Brier score (off-chain). */
function brierScore(predictedProb, actualOutcome) {
    return (predictedProb - actualOutcome) ** 2;
}
/** Compute average Brier score from cumulative values (matches on-chain representation). */
function averageBrier(cumulativeScaled, count) {
    if (count === 0n)
        return 0;
    return Number(cumulativeScaled) / Number(count) / SCALE;
}
/** Convert on-chain scaled probability (0..1e18) to a 0..1 float. */
function fromScaled(scaled) {
    return Number(scaled) / SCALE;
}
/** Convert a 0..1 float to on-chain scaled probability (0..1e18). */
function toScaled(prob) {
    return BigInt(Math.round(prob * SCALE));
}
/** Compute implied probability from pool sizes. */
function impliedProbability(yesPool, noPool) {
    const total = yesPool + noPool;
    if (total === 0n)
        return 0.5;
    return Number(yesPool) / Number(total);
}
/** Compute payout for a winning bet. */
function computePayout(userBet, totalPool, winningPool, feeBps) {
    if (winningPool === 0n)
        return 0n;
    return (userBet * totalPool * BigInt(10000 - feeBps)) / (winningPool * 10000n);
}
/** Format Brier score for display. */
function formatBrier(score) {
    return score.toFixed(3);
}
/** Get accuracy tier based on Brier score. */
function accuracyTier(avgBrier) {
    if (avgBrier < 0.1)
        return { label: "Excellent", color: "text-neo-green" };
    if (avgBrier < 0.2)
        return { label: "Good", color: "text-neo-blue" };
    if (avgBrier < 0.3)
        return { label: "Fair", color: "text-neo-yellow" };
    return { label: "Poor", color: "text-neo-pink" };
}
/** Edge BPS between two probability estimates (reuses prediction-arb-scanner pattern). */
function computeEdgeBps(probA, probB) {
    return Math.abs(probA - probB) * 10000;
}
