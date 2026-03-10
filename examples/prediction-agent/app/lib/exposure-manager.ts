/**
 * Exposure Manager — Portfolio-level risk and hedging gate.
 *
 * When the agent holds positions across correlated markets (e.g.,
 * "BTC > $100K in 5 min" and "BTC > $99K in 5 min"), this module
 * manages net exposure rather than treating each market independently.
 *
 * Runs as a post-Kelly gate: Kelly sizes the bet, then exposure
 * manager can reduce or veto it based on portfolio constraints.
 */

import type { MarketState } from "./market-reader";

// ── Exposure defaults (standalone — no config dependency) ──────────────
const exposureConfig = {
  exposureEnabled: true,
  exposureCorrelationThreshold: 0.7,
  exposureMaxTotalFraction: 0.5,
  exposureMaxGroupFraction: 0.25,
  exposureMaxPositionsPerGroup: 5,
  exposureScaleNearLimit: true,
};

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface Position {
  marketId: number;
  marketAddress: string;
  question: string;
  side: "YES" | "NO";
  /** Position size in wei */
  sizeWei: bigint;
  /** Agent's model probability for YES */
  modelProb: number;
  /** Current market implied probability */
  marketProb: number;
  /** Underlying asset (e.g., "bitcoin") or null for non-crypto */
  underlyingAsset: string | null;
  /** Strike price for crypto markets */
  strikePrice: number | null;
  /** Direction for crypto threshold markets */
  direction: "above" | "below" | null;
  /** Seconds until resolution */
  timeToResolution: number;
}

export interface ExposureGroup {
  /** Shared underlying asset (or "general" for non-crypto) */
  asset: string;
  /** Positions in this group */
  positions: Position[];
  /** Total capital at risk in this group (sum of position sizes) */
  totalExposureWei: bigint;
  /** Net directional exposure: YES positions minus NO positions */
  netDirectionalWei: bigint;
  /** Intra-group correlation score (0-1) */
  correlation: number;
}

export interface PortfolioMetrics {
  /** Total capital at risk across all open positions */
  totalExposureWei: bigint;
  /** As fraction of bankroll */
  exposureFraction: number;
  /** Number of distinct exposure groups */
  groupCount: number;
  /** Largest single-group exposure as fraction of bankroll */
  largestGroupFraction: number;
  /** Number of open positions */
  positionCount: number;
}

export interface ExposureDecision {
  /** Whether to proceed with the proposed bet */
  allow: boolean;
  /** Adjusted bet size (may be reduced) */
  adjustedBetWei: bigint;
  /** Original proposed bet size */
  proposedBetWei: bigint;
  /** Reason for adjustment or rejection */
  reason: string;
  /** Current portfolio metrics */
  metrics: PortfolioMetrics;
}

/* ------------------------------------------------------------------ */
/*  Underlying Asset Extraction                                         */
/* ------------------------------------------------------------------ */

const CRYPTO_ASSET_PATTERNS: [RegExp, string][] = [
  [/\b(bitcoin|btc)\b/i, "bitcoin"],
  [/\b(ethereum|eth)\b/i, "ethereum"],
  [/\b(solana|sol)\b/i, "solana"],
  [/\b(starknet|strk)\b/i, "starknet"],
  [/\b(avalanche|avax)\b/i, "avalanche"],
  [/\b(polygon|matic)\b/i, "polygon"],
];

const PRICE_THRESHOLD_REGEX =
  /(?:above|below|over|under|exceed)\s+\$?([\d,]+(?:\.\d+)?)/i;
const DIRECTION_REGEX = /\b(above|over|exceed|surpass)\b/i;

interface ParsedUnderlying {
  asset: string | null;
  strikePrice: number | null;
  direction: "above" | "below" | null;
}

/** Extract underlying asset, strike price, and direction from a market question. */
export function extractUnderlying(question: string): ParsedUnderlying {
  let asset: string | null = null;
  for (const [regex, id] of CRYPTO_ASSET_PATTERNS) {
    if (regex.test(question)) {
      asset = id;
      break;
    }
  }

  let strikePrice: number | null = null;
  let direction: "above" | "below" | null = null;

  const priceMatch = question.match(PRICE_THRESHOLD_REGEX);
  if (priceMatch) {
    strikePrice = parseFloat(priceMatch[1].replace(/,/g, ""));
    if (isNaN(strikePrice)) strikePrice = null;
  }

  if (DIRECTION_REGEX.test(question)) {
    direction = "above";
  } else if (/\b(below|under|drop)\b/i.test(question)) {
    direction = "below";
  }

  return { asset, strikePrice, direction };
}

/* ------------------------------------------------------------------ */
/*  Correlation Model                                                   */
/* ------------------------------------------------------------------ */

/**
 * Compute correlation between two positions.
 *
 * Same-asset positions are correlated. The correlation is higher when:
 * - Strike prices are close (for crypto threshold markets)
 * - Resolution times overlap
 * - Both are in the same direction (above/above or below/below)
 */
export function computeCorrelation(a: Position, b: Position): number {
  // Different underlying assets = uncorrelated
  if (!a.underlyingAsset || !b.underlyingAsset) return 0;
  if (a.underlyingAsset !== b.underlyingAsset) return 0;

  let corr = 0.5; // Base correlation for same asset

  // Strike price proximity boost
  if (a.strikePrice && b.strikePrice) {
    const priceDiff =
      Math.abs(a.strikePrice - b.strikePrice) /
      Math.max(a.strikePrice, b.strikePrice);
    // Within 5% = high correlation, beyond 20% = low
    corr += Math.max(0, 0.3 * (1 - priceDiff / 0.2));
  }

  // Same direction boost
  if (a.direction && b.direction) {
    corr += a.direction === b.direction ? 0.15 : -0.1;
  }

  // Overlapping resolution time boost
  const timeOverlap = Math.min(a.timeToResolution, b.timeToResolution);
  const maxTime = Math.max(a.timeToResolution, b.timeToResolution);
  if (maxTime > 0) {
    corr += 0.05 * (timeOverlap / maxTime);
  }

  return Math.max(0, Math.min(1, corr));
}

/* ------------------------------------------------------------------ */
/*  Position Grouping                                                   */
/* ------------------------------------------------------------------ */

/**
 * Group positions by underlying asset with correlation-based clustering.
 */
export function groupPositions(
  positions: Position[],
  correlationThreshold = exposureConfig.exposureCorrelationThreshold
): ExposureGroup[] {
  const assetGroups = new Map<string, Position[]>();

  for (const pos of positions) {
    const key = pos.underlyingAsset ?? "general";
    if (!assetGroups.has(key)) assetGroups.set(key, []);
    assetGroups.get(key)!.push(pos);
  }

  const groups: ExposureGroup[] = [];

  for (const [asset, groupPositions] of assetGroups.entries()) {
    // Compute average intra-group correlation
    let totalCorr = 0;
    let corrPairs = 0;
    for (let i = 0; i < groupPositions.length; i++) {
      for (let j = i + 1; j < groupPositions.length; j++) {
        totalCorr += computeCorrelation(groupPositions[i], groupPositions[j]);
        corrPairs++;
      }
    }
    const avgCorr = corrPairs > 0 ? totalCorr / corrPairs : 1;

    // Only group if correlation exceeds threshold
    if (avgCorr < correlationThreshold && groupPositions.length > 1) {
      // Split into individual "groups" if correlation is low
      for (const pos of groupPositions) {
        groups.push({
          asset,
          positions: [pos],
          totalExposureWei: pos.sizeWei,
          netDirectionalWei: pos.side === "YES" ? pos.sizeWei : -pos.sizeWei,
          correlation: 1,
        });
      }
    } else {
      let totalExposure = 0n;
      let netDirectional = 0n;
      for (const pos of groupPositions) {
        totalExposure += pos.sizeWei;
        netDirectional += pos.side === "YES" ? pos.sizeWei : -pos.sizeWei;
      }
      groups.push({
        asset,
        positions: groupPositions,
        totalExposureWei: totalExposure,
        netDirectionalWei: netDirectional,
        correlation: avgCorr,
      });
    }
  }

  return groups;
}

/* ------------------------------------------------------------------ */
/*  Portfolio Metrics                                                    */
/* ------------------------------------------------------------------ */

function computePortfolioMetrics(
  groups: ExposureGroup[],
  bankrollWei: bigint
): PortfolioMetrics {
  let totalExposure = 0n;
  let positionCount = 0;
  let largestGroupExposure = 0n;

  for (const group of groups) {
    totalExposure += group.totalExposureWei;
    positionCount += group.positions.length;
    if (group.totalExposureWei > largestGroupExposure) {
      largestGroupExposure = group.totalExposureWei;
    }
  }

  const bankrollF = Number(bankrollWei / 10n ** 14n) / 10_000 || 1;
  return {
    totalExposureWei: totalExposure,
    exposureFraction: Number(totalExposure / 10n ** 14n) / 10_000 / bankrollF,
    groupCount: groups.length,
    largestGroupFraction: Number(largestGroupExposure / 10n ** 14n) / 10_000 / bankrollF,
    positionCount,
  };
}

/* ------------------------------------------------------------------ */
/*  Bet Evaluation Gate                                                 */
/* ------------------------------------------------------------------ */

/**
 * Evaluate whether a proposed bet should proceed given the current
 * portfolio state. Returns an ExposureDecision that may allow, reduce,
 * or reject the bet.
 *
 * @param proposedBetWei - Kelly-sized bet amount
 * @param proposedSide - YES or NO
 * @param proposedMarket - The market being bet on
 * @param question - Market question text
 * @param currentPositions - All agent's open positions
 * @param bankrollWei - Agent's total bankroll
 */
export function evaluateProposedBet(
  proposedBetWei: bigint,
  proposedSide: "YES" | "NO",
  proposedMarket: MarketState,
  question: string,
  currentPositions: Position[],
  bankrollWei: bigint
): ExposureDecision {
  if (!exposureConfig.exposureEnabled || proposedBetWei <= 0n) {
    return {
      allow: true,
      adjustedBetWei: proposedBetWei,
      proposedBetWei,
      reason: "Exposure manager disabled",
      metrics: computePortfolioMetrics(groupPositions(currentPositions), bankrollWei),
    };
  }

  const underlying = extractUnderlying(question);
  const nowSec = Math.floor(Date.now() / 1000);

  // Build simulated position for the proposed bet
  const proposedPos: Position = {
    marketId: proposedMarket.id,
    marketAddress: proposedMarket.address,
    question,
    side: proposedSide,
    sizeWei: proposedBetWei,
    modelProb: 0,
    marketProb: proposedMarket.impliedProbYes,
    underlyingAsset: underlying.asset,
    strikePrice: underlying.strikePrice,
    direction: underlying.direction,
    timeToResolution: Math.max(0, proposedMarket.resolutionTime - nowSec),
  };

  // Group all positions including the proposed one
  const allPositions = [...currentPositions, proposedPos];
  const groups = groupPositions(allPositions);
  const metrics = computePortfolioMetrics(groups, bankrollWei);

  // ── Gate 1: Total portfolio exposure limit ──
  if (metrics.exposureFraction > exposureConfig.exposureMaxTotalFraction) {
    // Scale down to fit within limit
    const currentExposure = Number((metrics.totalExposureWei - proposedBetWei) / 10n ** 14n) / 10_000;
    const maxTotal = Number(bankrollWei / 10n ** 14n) / 10_000 * exposureConfig.exposureMaxTotalFraction;
    const headroom = Math.max(0, maxTotal - currentExposure);

    if (headroom <= 0) {
      return {
        allow: false,
        adjustedBetWei: 0n,
        proposedBetWei,
        reason: `Portfolio at ${(metrics.exposureFraction * 100).toFixed(1)}% exposure (max ${(exposureConfig.exposureMaxTotalFraction * 100).toFixed(0)}%)`,
        metrics,
      };
    }

    const adjusted = BigInt(Math.floor(headroom));
    if (adjusted < proposedBetWei) {
      return {
        allow: true,
        adjustedBetWei: adjusted,
        proposedBetWei,
        reason: `Reduced from ${formatStrk(proposedBetWei)} to ${formatStrk(adjusted)} (portfolio exposure limit)`,
        metrics,
      };
    }
  }

  // ── Gate 2: Per-group exposure limit ──
  if (underlying.asset) {
    const assetGroup = groups.find((g) => g.asset === underlying.asset);
    if (assetGroup) {
      const groupFraction =
        Number(assetGroup.totalExposureWei / 10n ** 14n) / 10_000 / (Number(bankrollWei / 10n ** 14n) / 10_000 || 1);

      if (groupFraction > exposureConfig.exposureMaxGroupFraction) {
        const currentGroupExposure = Number(
          (assetGroup.totalExposureWei - proposedBetWei) / 10n ** 14n
        ) / 10_000;
        const maxGroupTotal =
          Number(bankrollWei / 10n ** 14n) / 10_000 * exposureConfig.exposureMaxGroupFraction;
        const headroom = Math.max(0, maxGroupTotal - currentGroupExposure);

        if (headroom <= 0) {
          return {
            allow: false,
            adjustedBetWei: 0n,
            proposedBetWei,
            reason: `${underlying.asset} group at ${(groupFraction * 100).toFixed(1)}% exposure (max ${(exposureConfig.exposureMaxGroupFraction * 100).toFixed(0)}%)`,
            metrics,
          };
        }

        const adjusted = BigInt(Math.floor(headroom));
        if (adjusted < proposedBetWei) {
          return {
            allow: true,
            adjustedBetWei: adjusted,
            proposedBetWei,
            reason: `Reduced from ${formatStrk(proposedBetWei)} to ${formatStrk(adjusted)} (${underlying.asset} group limit)`,
            metrics,
          };
        }
      }

      // ── Gate 3: Max positions per group ──
      if (assetGroup.positions.length > exposureConfig.exposureMaxPositionsPerGroup) {
        return {
          allow: false,
          adjustedBetWei: 0n,
          proposedBetWei,
          reason: `${underlying.asset} group has ${assetGroup.positions.length} positions (max ${exposureConfig.exposureMaxPositionsPerGroup})`,
          metrics,
        };
      }
    }
  }

  // ── Gate 4: Scale near limit (gentle reduction as exposure approaches cap) ──
  if (exposureConfig.exposureScaleNearLimit) {
    const usedFraction =
      metrics.exposureFraction > 0
        ? metrics.exposureFraction / exposureConfig.exposureMaxTotalFraction
        : 0;
    // Start scaling at 80% of limit
    if (usedFraction > 0.8) {
      const scaleFactor = Math.max(0.1, 1 - (usedFraction - 0.8) / 0.2);
      const scaled = BigInt(
        Math.floor(Number(proposedBetWei / 10n ** 14n) / 10_000 * scaleFactor * 1e18)
      );
      if (scaled < proposedBetWei) {
        return {
          allow: true,
          adjustedBetWei: scaled,
          proposedBetWei,
          reason: `Scaled to ${(scaleFactor * 100).toFixed(0)}% (portfolio at ${(metrics.exposureFraction * 100).toFixed(1)}% of ${(exposureConfig.exposureMaxTotalFraction * 100).toFixed(0)}% limit)`,
          metrics,
        };
      }
    }
  }

  return {
    allow: true,
    adjustedBetWei: proposedBetWei,
    proposedBetWei,
    reason: "Within all exposure limits",
    metrics,
  };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function formatStrk(wei: bigint): string {
  const strk = Number(wei) / 1e18;
  return `${strk.toFixed(2)} STRK`;
}
