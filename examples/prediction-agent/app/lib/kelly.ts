/**
 * Kelly Criterion — Optimal bet sizing for prediction markets.
 *
 * Computes the fraction of bankroll to wager based on estimated edge
 * over market-implied probability. Uses fractional Kelly (default half)
 * to reduce variance at the cost of ~25% slower growth.
 *
 * Formula: f* = (p · b − q) / b
 *   p = model's probability of the chosen outcome winning
 *   q = 1 − p
 *   b = net odds = (1 / market_prob_chosen) − 1
 */

import type { SurvivalTier } from "./survival-engine";

// ── Types ────────────────────────────────────────────────────────────────────

export interface KellyInput {
  /** Agent's model probability for the event (0–1) */
  modelProb: number;
  /** Market-implied probability for YES outcome (0–1) */
  marketProb: number;
  /** Fractional Kelly multiplier (0–1, 0.5 = half-Kelly) */
  fraction: number;
  /** Agent's current bankroll in wei */
  bankrollWei: bigint;
  /** Minimum bet in STRK (human units) */
  minBetStrk: number;
  /** Maximum bet as fraction of bankroll (0–1) */
  maxBetFraction: number;
  /** Hard maximum bet in STRK (human units) */
  maxBetStrk: number;
  /** Current survival tier — gates dead/critical behaviour */
  survivalTier: SurvivalTier;
}

export interface KellyResult {
  /** Raw Kelly fraction before fractional scaling (negative = no edge) */
  rawFraction: number;
  /** Scaled Kelly fraction after applying fractional multiplier */
  scaledFraction: number;
  /** Final bet amount in wei */
  betWei: bigint;
  /** Final bet amount in STRK */
  betStrk: number;
  /** Whether Kelly says to bet at all */
  shouldBet: boolean;
  /** Edge: model prob of winning minus market prob of winning */
  edge: number;
  /** Expected value per unit risked */
  evPerUnit: number;
  /** Which side the model favours */
  side: "YES" | "NO";
}

// ── Core ─────────────────────────────────────────────────────────────────────

export function computeKellyBet(input: KellyInput): KellyResult {
  const {
    modelProb,
    marketProb,
    fraction,
    bankrollWei,
    minBetStrk,
    maxBetFraction,
    maxBetStrk,
    survivalTier,
  } = input;

  // Dead tier → absolute zero
  if (survivalTier === "dead") {
    return noBet(modelProb, marketProb);
  }

  // Determine side
  const bettingYes = modelProb > marketProb;
  const side: "YES" | "NO" = bettingYes ? "YES" : "NO";

  // p = model's probability of winning the chosen side
  // marketProbChosen = what the market thinks the chosen side is worth
  const p = bettingYes ? modelProb : 1 - modelProb;
  const marketProbChosen = bettingYes ? marketProb : 1 - marketProb;
  const q = 1 - p;

  // Clamp market prob to avoid division by zero
  const clamped = Math.max(0.01, Math.min(0.99, marketProbChosen));

  // Net odds: payout per unit wagered
  const b = (1 / clamped) - 1;

  // Raw Kelly fraction
  const rawFraction = b > 0 ? (p * b - q) / b : 0;
  const edge = p - clamped;
  const evPerUnit = b > 0 ? (p * (1 + b) - 1) : 0;

  // No edge → skip
  if (rawFraction <= 0) {
    return { rawFraction, scaledFraction: 0, betWei: 0n, betStrk: 0, shouldBet: false, edge, evPerUnit, side };
  }

  // Apply fractional Kelly
  let scaledFraction = rawFraction * fraction;

  // Critical tier → force minimum only (survive mode)
  const bankrollStrk = Number(bankrollWei) / 1e18;
  const effectiveMaxStrk = survivalTier === "critical"
    ? Math.min(minBetStrk, maxBetStrk)
    : maxBetStrk;

  // Compute bet size
  let betStrk = scaledFraction * bankrollStrk;

  // Cap at max fraction of bankroll
  betStrk = Math.min(betStrk, bankrollStrk * maxBetFraction);

  // Cap at hard max
  betStrk = Math.min(betStrk, effectiveMaxStrk);

  // Floor at minimum
  if (betStrk < minBetStrk) {
    if (bankrollStrk >= minBetStrk) {
      betStrk = minBetStrk;
    } else {
      // Can't afford minimum → skip
      return { rawFraction, scaledFraction, betWei: 0n, betStrk: 0, shouldBet: false, edge, evPerUnit, side };
    }
  }

  const betWei = BigInt(Math.round(betStrk * 1e18));

  return {
    rawFraction,
    scaledFraction,
    betWei,
    betStrk,
    shouldBet: true,
    edge,
    evPerUnit,
    side,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function noBet(modelProb: number, marketProb: number): KellyResult {
  const bettingYes = modelProb > marketProb;
  const p = bettingYes ? modelProb : 1 - modelProb;
  const clamped = Math.max(0.01, Math.min(0.99, bettingYes ? marketProb : 1 - marketProb));
  return {
    rawFraction: 0,
    scaledFraction: 0,
    betWei: 0n,
    betStrk: 0,
    shouldBet: false,
    edge: p - clamped,
    evPerUnit: 0,
    side: bettingYes ? "YES" : "NO",
  };
}
