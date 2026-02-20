/**
 * Accuracy Mining — Reward computation for prediction accuracy.
 *
 * Rewards are distributed inversely proportional to Brier score:
 * - Lower Brier = better accuracy = higher reward share
 * - Agents with 0 predictions get 0 rewards
 * - Reward shares sum to the total pool
 */

interface LeaderboardEntry {
  agent: string;
  avgBrier: number;
  predictionCount: number;
}

/**
 * Compute reward shares based on inverse Brier score.
 * Returns a Map of agent -> estimated reward amount.
 */
export function computeRewardShares(
  entries: LeaderboardEntry[],
  rewardPool: number
): Map<string, number> {
  const rewards = new Map<string, number>();

  // Only agents with predictions are eligible
  const eligible = entries.filter((e) => e.predictionCount > 0 && e.avgBrier > 0);

  if (eligible.length === 0) {
    return rewards;
  }

  // Inverse Brier: higher is better (1 / avgBrier)
  // Weight by prediction count to reward participation
  const scores = eligible.map((e) => ({
    agent: e.agent,
    score: (1 / e.avgBrier) * Math.sqrt(e.predictionCount),
  }));

  const totalScore = scores.reduce((sum, s) => sum + s.score, 0);

  if (totalScore === 0) return rewards;

  for (const s of scores) {
    const share = (s.score / totalScore) * rewardPool;
    rewards.set(s.agent, Math.round(share * 100) / 100);
  }

  return rewards;
}
