/**
 * LMSR (Logarithmic Market Scoring Rule) — Off-chain pricing model.
 *
 * Provides theoretically-grounded fair price and slippage estimates
 * for pari-mutuel prediction markets. The on-chain contract uses simple
 * pool-ratio pricing; LMSR acts as a shadow model the agent uses to
 * evaluate edge and execution cost before betting.
 *
 * Reference: Hanson, "Combinatorial Information Market Design" (2003)
 *
 * Key formula:
 *   Cost function:  C(q) = b · ln(e^(q_yes/b) + e^(q_no/b))
 *   Marginal price: p_yes = e^(q_yes/b) / (e^(q_yes/b) + e^(q_no/b))
 *   Trade cost:     cost = C(q + Δ) − C(q)
 */

import type { MarketState } from "./market-reader";

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface LmsrPriceResult {
  /** LMSR fair price for YES (0-1) */
  priceYes: number;
  /** LMSR fair price for NO (0-1) */
  priceNo: number;
  /** Naive pool-ratio implied probability (for comparison) */
  naiveProb: number;
  /** Price impact of buying `tradeSize` YES shares */
  slippageYes: number;
  /** Price impact of buying `tradeSize` NO shares */
  slippageNo: number;
  /** Post-trade YES price after agent buys YES */
  postTradePriceYes: number;
  /** Post-trade NO price after agent buys NO */
  postTradePriceNo: number;
  /** Effective b (liquidity parameter) used */
  b: number;
  /** Liquidity score (0-1): how resilient the market is to trades */
  liquidityScore: number;
  /** Cost in pool units to buy `tradeSize` YES shares */
  costYes: number;
  /** Cost in pool units to buy `tradeSize` NO shares */
  costNo: number;
}

/* ------------------------------------------------------------------ */
/*  Core LMSR Math                                                      */
/* ------------------------------------------------------------------ */

/**
 * LMSR cost function: C(q) = b · ln(e^(q_yes/b) + e^(q_no/b))
 *
 * Uses log-sum-exp trick for numerical stability:
 *   ln(e^a + e^b) = max(a,b) + ln(1 + e^(-|a-b|))
 */
export function lmsrCost(b: number, qYes: number, qNo: number): number {
  const a = qYes / b;
  const c = qNo / b;
  const maxVal = Math.max(a, c);
  return b * (maxVal + Math.log(Math.exp(a - maxVal) + Math.exp(c - maxVal)));
}

/**
 * LMSR marginal price for YES outcome.
 *   p_yes = e^(q_yes/b) / (e^(q_yes/b) + e^(q_no/b))
 *
 * Equivalent to softmax(q_yes/b, q_no/b)[0].
 */
export function lmsrPriceYes(b: number, qYes: number, qNo: number): number {
  // Numerically stable: subtract max
  const diff = (qYes - qNo) / b;
  if (diff > 20) return 1 - 1e-9; // overflow guard
  if (diff < -20) return 1e-9;
  return 1 / (1 + Math.exp(-diff));
}

/**
 * Cost to execute a trade: buy `deltaYes` YES shares and `deltaNo` NO shares.
 *   cost = C(q + Δ) − C(q)
 */
export function lmsrTradeCost(
  b: number,
  qYes: number,
  qNo: number,
  deltaYes: number,
  deltaNo: number
): number {
  return lmsrCost(b, qYes + deltaYes, qNo + deltaNo) - lmsrCost(b, qYes, qNo);
}

/* ------------------------------------------------------------------ */
/*  Calibration                                                         */
/* ------------------------------------------------------------------ */

/**
 * Calibrate the LMSR liquidity parameter `b` from on-chain pool state.
 *
 * The goal: make the LMSR price at current pool ratio approximately
 * match the naive implied probability, so LMSR acts as a refinement
 * (adding slippage awareness) rather than contradicting the market.
 *
 * Approach: b = totalPool / CALIBRATION_DIVISOR
 * - Higher divisor = lower b = more price-sensitive (thin market)
 * - Lower divisor = higher b = more price-stable (deep market)
 *
 * The divisor is tuned so that a bet of ~1% of the pool moves the
 * price by roughly 0.5-2%, matching empirical pari-mutuel dynamics.
 */
export function calibrateLiquidity(
  totalPoolUnits: number,
  baseLiquidityB: number,
  minB: number,
  maxB: number
): number {
  // Scale b with pool size: larger pools are more liquid
  const raw = totalPoolUnits / baseLiquidityB;
  return Math.max(minB, Math.min(maxB, raw));
}

/* ------------------------------------------------------------------ */
/*  High-level API                                                      */
/* ------------------------------------------------------------------ */

const WEI_PER_STRK = 1e18;

/**
 * Compute LMSR fair price and slippage for a market, given a proposed
 * trade size. Returns pricing data that can replace naive impliedProbYes
 * as the `marketProb` input to Kelly criterion.
 *
 * @param market - On-chain market state (yesPool, noPool, totalPool)
 * @param tradeSizeWei - Proposed bet size in wei (for slippage estimate)
 * @param lmsrConfig - LMSR configuration (b params)
 */
export function computeLmsrPrice(
  market: MarketState,
  tradeSizeWei: bigint,
  lmsrConfig: {
    baseLiquidityB: number;
    minB: number;
    maxB: number;
  }
): LmsrPriceResult {
  // Convert pool values from wei to float units for LMSR math
  const yesPool = Number(market.yesPool) / WEI_PER_STRK;
  const noPool = Number(market.noPool) / WEI_PER_STRK;
  const totalPool = yesPool + noPool;
  const tradeSize = Number(tradeSizeWei) / WEI_PER_STRK;

  // Handle edge cases: empty or near-empty pools
  if (totalPool < 0.001) {
    return {
      priceYes: 0.5,
      priceNo: 0.5,
      naiveProb: 0.5,
      slippageYes: 0,
      slippageNo: 0,
      postTradePriceYes: 0.5,
      postTradePriceNo: 0.5,
      b: lmsrConfig.minB,
      liquidityScore: 0,
      costYes: tradeSize,
      costNo: tradeSize,
    };
  }

  // Calibrate b from pool depth
  const b = calibrateLiquidity(
    totalPool,
    lmsrConfig.baseLiquidityB,
    lmsrConfig.minB,
    lmsrConfig.maxB
  );

  // Pre-trade LMSR price
  const priceYes = lmsrPriceYes(b, yesPool, noPool);
  const priceNo = 1 - priceYes;
  const naiveProb = market.impliedProbYes;

  // Post-trade prices (simulate buying YES or NO shares)
  const postTradePriceYes = lmsrPriceYes(b, yesPool + tradeSize, noPool);
  const postTradePriceNo = 1 - lmsrPriceYes(b, yesPool, noPool + tradeSize);

  // Slippage = post-trade price - pre-trade price
  const slippageYes = postTradePriceYes - priceYes;
  const slippageNo = (1 - lmsrPriceYes(b, yesPool, noPool + tradeSize)) - priceNo;

  // Cost to execute each side
  const costYes = lmsrTradeCost(b, yesPool, noPool, tradeSize, 0);
  const costNo = lmsrTradeCost(b, yesPool, noPool, 0, tradeSize);

  // Liquidity score: how much a 1% pool trade moves the price
  // High score = deep market, low impact
  const testTradeSize = totalPool * 0.01;
  const testSlippage = Math.abs(
    lmsrPriceYes(b, yesPool + testTradeSize, noPool) - priceYes
  );
  // Map slippage to 0-1 score: 0 slippage = 1.0, 5%+ slippage = ~0
  const liquidityScore = Math.max(0, Math.min(1, 1 - testSlippage * 20));

  return {
    priceYes,
    priceNo,
    naiveProb,
    slippageYes,
    slippageNo,
    postTradePriceYes,
    postTradePriceNo,
    b,
    liquidityScore,
    costYes,
    costNo,
  };
}

/**
 * Gate check: should the agent skip a bet due to excessive slippage?
 */
export function slippageGate(
  slippage: number,
  maxSlippage: number
): { pass: boolean; reason?: string } {
  if (Math.abs(slippage) <= maxSlippage) {
    return { pass: true };
  }
  return {
    pass: false,
    reason: `Slippage ${(Math.abs(slippage) * 100).toFixed(2)}% exceeds max ${(maxSlippage * 100).toFixed(1)}%`,
  };
}

/**
 * Get the LMSR-adjusted market probability for Kelly input.
 * When LMSR is enabled and useForKelly is true, returns LMSR price.
 * Otherwise falls back to naive pool-ratio implied probability.
 */
export function getLmsrMarketProb(
  market: MarketState,
  tradeSizeWei: bigint,
  lmsrConfig: {
    enabled: boolean;
    useForKelly: boolean;
    baseLiquidityB: number;
    minB: number;
    maxB: number;
  }
): { marketProb: number; lmsr?: LmsrPriceResult } {
  if (!lmsrConfig.enabled) {
    return { marketProb: market.impliedProbYes };
  }

  const lmsr = computeLmsrPrice(market, tradeSizeWei, lmsrConfig);

  if (!lmsrConfig.useForKelly) {
    return { marketProb: market.impliedProbYes, lmsr };
  }

  return { marketProb: lmsr.priceYes, lmsr };
}
