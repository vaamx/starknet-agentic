/**
 * Bayesian Update Engine — Incremental belief updating for prediction markets.
 *
 * Instead of one-shot forecasting (research → single probability → bet),
 * maintains a running belief per market in log-odds space. Each tick,
 * new evidence shifts the belief via Bayes' rule without re-running the
 * full LLM forecast pipeline.
 *
 * Log-odds representation: logit(p) = ln(p / (1-p))
 * Bayesian update in log-odds: logit(posterior) = logit(prior) + ln(LR)
 * where LR = P(evidence | YES) / P(evidence | NO)
 */

// Bayesian engine uses hardcoded defaults — no config dependency needed.

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface BeliefUpdate {
  timestamp: number;
  source: string;
  /** Likelihood ratio: P(evidence | YES) / P(evidence | NO) */
  likelihoodRatio: number;
  /** Log-odds shift from this evidence = ln(LR) */
  logOddsShift: number;
  /** Human-readable description */
  description: string;
}

export interface BeliefState {
  marketId: number;
  /** Current posterior probability (0-1) */
  posterior: number;
  /** Initial prior from first forecast */
  initialPrior: number;
  /** Log-odds representation of posterior */
  logOdds: number;
  /** All evidence updates applied */
  updates: BeliefUpdate[];
  /** Timestamp of creation */
  createdAt: number;
  /** Timestamp of last update */
  updatedAt: number;
  /** Total evidence items processed */
  updateCount: number;
}

export interface EvidenceItem {
  source: string;
  /** Likelihood ratio: >1 favors YES, <1 favors NO, =1 neutral */
  likelihoodRatio: number;
  description: string;
}

/* ------------------------------------------------------------------ */
/*  Math Utilities                                                      */
/* ------------------------------------------------------------------ */

/** Convert probability to log-odds: ln(p / (1-p)) */
export function probToLogOdds(p: number): number {
  const clamped = Math.max(1e-9, Math.min(1 - 1e-9, p));
  return Math.log(clamped / (1 - clamped));
}

/** Convert log-odds to probability: 1 / (1 + e^(-lo)) */
export function logOddsToProb(lo: number): number {
  if (lo > 20) return 1 - 1e-9;
  if (lo < -20) return 1e-9;
  return 1 / (1 + Math.exp(-lo));
}

/* ------------------------------------------------------------------ */
/*  Belief Store (in-memory)                                            */
/* ------------------------------------------------------------------ */

const beliefs = new Map<number, BeliefState>();

/** Get belief for a market, or null if none exists. */
export function getBelief(marketId: number): BeliefState | null {
  return beliefs.get(marketId) ?? null;
}

/** Get all active beliefs. */
export function getAllBeliefs(): BeliefState[] {
  return Array.from(beliefs.values());
}

/** Remove belief for a resolved/expired market. */
export function removeBelief(marketId: number): void {
  beliefs.delete(marketId);
}

/** Clear all beliefs (e.g., on reset). */
export function clearBeliefs(): void {
  beliefs.clear();
}

/* ------------------------------------------------------------------ */
/*  Core Engine                                                         */
/* ------------------------------------------------------------------ */

/**
 * Initialize a belief from the agent's first forecast on a market.
 * This is the starting prior that subsequent evidence will update.
 */
export function initBelief(marketId: number, prior: number): BeliefState {
  const now = Date.now();
  const state: BeliefState = {
    marketId,
    posterior: prior,
    initialPrior: prior,
    logOdds: probToLogOdds(prior),
    updates: [],
    createdAt: now,
    updatedAt: now,
    updateCount: 0,
  };
  beliefs.set(marketId, state);
  return state;
}

/**
 * Apply a single evidence item to a belief via Bayesian update.
 *
 * In log-odds space, Bayes' rule is additive:
 *   logit(posterior) = logit(prior) + ln(LR)
 *
 * The shift is clamped to prevent any single piece of evidence
 * from overwhelming the prior (max single shift configurable).
 */
export function updateBelief(
  state: BeliefState,
  evidence: EvidenceItem,
  maxSingleShift = 2.0,
  maxCumulativeShift = 4.0
): BeliefState {
  // Compute raw log-odds shift
  const rawShift = Math.log(Math.max(1e-6, evidence.likelihoodRatio));

  // Clamp single-update shift
  const clampedShift = Math.max(-maxSingleShift, Math.min(maxSingleShift, rawShift));

  // Check cumulative shift from initial prior
  const initialLogOdds = probToLogOdds(state.initialPrior);
  const proposedLogOdds = state.logOdds + clampedShift;
  const cumulativeShift = Math.abs(proposedLogOdds - initialLogOdds);

  // If cumulative shift would exceed max, reduce this update proportionally
  let finalShift = clampedShift;
  if (cumulativeShift > maxCumulativeShift) {
    const currentShift = Math.abs(state.logOdds - initialLogOdds);
    const remaining = Math.max(0, maxCumulativeShift - currentShift);
    finalShift = Math.sign(clampedShift) * Math.min(Math.abs(clampedShift), remaining);
  }

  // Skip negligible updates
  if (Math.abs(finalShift) < 0.001) return state;

  const newLogOdds = state.logOdds + finalShift;
  const now = Date.now();

  const update: BeliefUpdate = {
    timestamp: now,
    source: evidence.source,
    likelihoodRatio: evidence.likelihoodRatio,
    logOddsShift: finalShift,
    description: evidence.description,
  };

  state.logOdds = newLogOdds;
  state.posterior = logOddsToProb(newLogOdds);
  state.updates.push(update);
  state.updatedAt = now;
  state.updateCount++;

  // Keep update history bounded
  if (state.updates.length > 50) {
    state.updates = state.updates.slice(-50);
  }

  return state;
}

/**
 * Apply temporal decay to a belief. Older evidence contributes less,
 * causing the belief to drift back toward 50% (maximum entropy).
 *
 * Decay model: each update's effective shift is multiplied by
 * 2^(-age / halfLife). The belief is recomputed from the decayed shifts.
 */
export function decayBelief(
  state: BeliefState,
  nowMs = Date.now(),
  halfLifeSecs = 3600
): BeliefState {
  if (state.updates.length === 0) return state;

  const halfLifeMs = halfLifeSecs * 1000;
  let logOdds = probToLogOdds(state.initialPrior);

  for (const update of state.updates) {
    const age = nowMs - update.timestamp;
    const decayFactor = Math.pow(0.5, age / halfLifeMs);
    logOdds += update.logOddsShift * decayFactor;
  }

  state.logOdds = logOdds;
  state.posterior = logOddsToProb(logOdds);
  state.updatedAt = nowMs;
  return state;
}

/* ------------------------------------------------------------------ */
/*  Evidence Likelihood Ratio Estimation                                */
/* ------------------------------------------------------------------ */

/**
 * Estimate likelihood ratio for a crypto price movement relative to
 * a strike price. This is deterministic — no LLM call needed.
 *
 * For "Will BTC be above $100K?":
 * - If BTC is now at $101K (1% above strike): LR ≈ 2.7 (favors YES)
 * - If BTC is now at $99K (1% below strike): LR ≈ 0.37 (favors NO)
 * - If BTC is exactly at $100K: LR = 1.0 (neutral)
 *
 * Model: LR = e^(k * (price - strike) / strike)
 * where k is a sensitivity parameter (default 3.0).
 */
export function cryptoPriceLikelihoodRatio(
  currentPrice: number,
  strikePrice: number,
  isAbove: boolean,
  sensitivityK = 3.0
): number {
  if (strikePrice <= 0) return 1.0;

  const pctDiff = (currentPrice - strikePrice) / strikePrice;
  // For "above" markets: price above strike favors YES (positive LR exponent)
  // For "below" markets: price below strike favors YES (flip sign)
  const direction = isAbove ? 1 : -1;
  const lr = Math.exp(sensitivityK * direction * pctDiff);

  // Clamp to reasonable range [0.01, 100]
  return Math.max(0.01, Math.min(100, lr));
}

/**
 * Check whether a market's belief should be re-evaluated this tick.
 * Returns true if enough has changed to warrant an update.
 */
export function shouldReEvaluate(
  state: BeliefState,
  currentMarketProb: number,
  nowMs = Date.now()
): boolean {
  // Re-evaluate if market price moved significantly from our belief
  const probDrift = Math.abs(state.posterior - currentMarketProb);
  if (probDrift > 0.1) return true; // >10pp drift

  // Re-evaluate if enough time has passed since last update
  const ageMs = nowMs - state.updatedAt;
  if (ageMs > 120_000) return true; // >2 min since last update

  return false;
}

/**
 * Get the usable probability from the belief engine.
 * If the belief has insufficient updates, returns null to signal
 * that the full forecast pipeline should run instead.
 */
export function getBeliefProbability(
  marketId: number,
  minUpdates = 3
): number | null {
  const state = beliefs.get(marketId);
  if (!state) return null;

  // The initial forecast counts as 1 update, evidence adds more
  if (state.updateCount < minUpdates) return null;

  return state.posterior;
}
