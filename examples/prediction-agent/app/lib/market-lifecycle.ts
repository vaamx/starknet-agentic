/**
 * Market Lifecycle Engine
 *
 * Manages the full lifecycle of prediction markets:
 * - OPEN → EXPIRED → RESOLVING → RESOLVED → SETTLED
 * - Auto-claim sweep for agent winnings after resolution
 * - Recurring market creation (crypto 5-min intervals auto-renew)
 * - Sports markets are one-shot (no renewal)
 * - Lifecycle-aware resolution buffer per market type
 */

import { categorizeMarket, type MarketCategory } from "./categories";
import type { MarketState } from "./market-reader";

/* ------------------------------------------------------------------ */
/*  Lifecycle States                                                    */
/* ------------------------------------------------------------------ */

export type LifecyclePhase =
  | "open"       // Accepting bets, before resolution_time
  | "closing"    // < 2 minutes to resolution_time
  | "expired"    // Past resolution_time but not yet resolved (status=0)
  | "resolving"  // Resolution in progress (oracle attempting)
  | "resolved"   // Oracle has resolved (status=2), claims open
  | "settled";   // All major claims processed (informational)

export interface MarketLifecycle {
  phase: LifecyclePhase;
  /** Seconds until next phase transition (0 if already past) */
  secsToTransition: number;
  /** Whether this market type can spawn a successor */
  canRecur: boolean;
  /** Market type determines resolution strategy + lifecycle */
  marketType: MarketType;
  /** Resolution buffer in seconds for this market type */
  resolutionBufferSecs: number;
  /** Whether auto-claim should be attempted */
  claimable: boolean;
  /** Human label for current phase */
  label: string;
}

/* ------------------------------------------------------------------ */
/*  Market Types                                                        */
/* ------------------------------------------------------------------ */

export type MarketType =
  | "crypto_recurring"  // 5m/15m crypto price → auto-renews
  | "crypto_milestone"  // "BTC above $200K" → one-shot
  | "sports_live"       // Live game → one-shot, resolve on FINAL
  | "sports_future"     // "Who wins Super Bowl" → one-shot
  | "general"           // Politics, tech, etc. → one-shot
  | "quick"             // Any market < 30min
  | "long";             // Any market > 7 days

/** Resolution buffer per market type (seconds after expiry before oracle attempts) */
const RESOLUTION_BUFFER: Record<MarketType, number> = {
  crypto_recurring: 30,    // Price data is near-instant
  crypto_milestone: 60,
  sports_live: 120,        // Wait for ESPN to mark FINAL
  sports_future: 300,      // May take longer to propagate
  general: 120,
  quick: 30,               // Fast markets need fast resolution
  long: 300,
};

/** Whether a market type can create a successor after resolution */
const CAN_RECUR: Record<MarketType, boolean> = {
  crypto_recurring: true,
  crypto_milestone: false,
  sports_live: false,
  sports_future: false,
  general: false,
  quick: false, // could recur but user-created, don't auto-spawn
  long: false,
};

/* ------------------------------------------------------------------ */
/*  Classification                                                      */
/* ------------------------------------------------------------------ */

/** Classify a market into a lifecycle type based on question + duration. */
export function classifyMarketType(
  question: string,
  durationSecs: number
): MarketType {
  const category = categorizeMarket(question);
  const q = question.toLowerCase();

  // Quick markets (< 30 min) that aren't sports
  if (durationSecs <= 1800 && category !== "sports") {
    // Crypto recurring patterns: "BTC above/below $X in 5 min"
    if (
      category === "crypto" &&
      durationSecs <= 900 &&
      /\b(above|below|over|under)\b.*\$[\d,.]+/i.test(question)
    ) {
      return "crypto_recurring";
    }
    return "quick";
  }

  if (category === "sports") {
    // Live game: references specific matchup or "tonight" / "today"
    if (/\b(tonight|today|live|game\s+\d|vs\.?|@)\b/i.test(q)) {
      return "sports_live";
    }
    return "sports_future";
  }

  if (category === "crypto") {
    // Milestone: explicit price targets without short duration
    if (/\b(above|below|exceed|reach|hit)\b.*\$[\d,.]+/i.test(q)) {
      return "crypto_milestone";
    }
    return "crypto_recurring";
  }

  if (durationSecs > 7 * 86400) {
    return "long";
  }

  return "general";
}

/* ------------------------------------------------------------------ */
/*  Lifecycle Computation                                               */
/* ------------------------------------------------------------------ */

/** Compute current lifecycle phase for a market. */
export function getMarketLifecycle(
  market: MarketState,
  question: string,
  nowSec = Math.floor(Date.now() / 1000)
): MarketLifecycle {
  const durationSecs = market.resolutionTime - (nowSec - 300); // approximate
  const marketType = classifyMarketType(question, Math.max(60, durationSecs));
  const resolutionBufferSecs = RESOLUTION_BUFFER[marketType];
  const canRecur = CAN_RECUR[marketType];

  // Resolved
  if (market.status === 2) {
    return {
      phase: "resolved",
      secsToTransition: 0,
      canRecur,
      marketType,
      resolutionBufferSecs,
      claimable: true,
      label: "Resolved",
    };
  }

  const secsToExpiry = market.resolutionTime - nowSec;

  // Past resolution time but not resolved yet
  if (secsToExpiry <= 0) {
    const secsSinceExpiry = -secsToExpiry;
    const inResolutionWindow = secsSinceExpiry >= resolutionBufferSecs;
    return {
      phase: inResolutionWindow ? "resolving" : "expired",
      secsToTransition: inResolutionWindow ? 0 : resolutionBufferSecs - secsSinceExpiry,
      canRecur,
      marketType,
      resolutionBufferSecs,
      claimable: false,
      label: inResolutionWindow ? "Resolving..." : "Awaiting resolution",
    };
  }

  // Closing soon (< 2 min)
  if (secsToExpiry <= 120) {
    return {
      phase: "closing",
      secsToTransition: secsToExpiry,
      canRecur,
      marketType,
      resolutionBufferSecs,
      claimable: false,
      label: `Closing in ${secsToExpiry}s`,
    };
  }

  // Open
  return {
    phase: "open",
    secsToTransition: secsToExpiry - 120,
    canRecur,
    marketType,
    resolutionBufferSecs,
    claimable: false,
    label: formatTimeLeft(secsToExpiry),
  };
}

/* ------------------------------------------------------------------ */
/*  Recurring Market Templates                                          */
/* ------------------------------------------------------------------ */

export interface RecurringTemplate {
  /** Original question pattern with ${price} placeholder */
  pattern: string;
  /** Token id for price lookup */
  tokenId: string;
  /** Duration in seconds for successor market */
  durationSecs: number;
  /** Fee in bps */
  feeBps: number;
  /** Category for discovery */
  category: MarketCategory;
}

/** Extract a recurring template from a resolved market's question. */
export function extractRecurringTemplate(
  question: string,
  durationSecs: number
): RecurringTemplate | null {
  // Only crypto recurring markets auto-renew
  const marketType = classifyMarketType(question, durationSecs);
  if (marketType !== "crypto_recurring") return null;

  // Parse: "Will BTC be above $97,500 in 5 minutes?"
  const match = question.match(
    /will\s+(btc|bitcoin|eth|ethereum|strk|starknet|sol|solana)\s+(?:be\s+)?(above|below)\s+\$[\d,.]+\s+in\s+(\d+)\s*(min|minute|hour|h|m)/i
  );
  if (!match) return null;

  const tokenMap: Record<string, string> = {
    btc: "bitcoin", bitcoin: "bitcoin",
    eth: "ethereum", ethereum: "ethereum",
    strk: "starknet", starknet: "starknet",
    sol: "solana", solana: "solana",
  };
  const tokenId = tokenMap[match[1].toLowerCase()];
  if (!tokenId) return null;

  const direction = match[2].toLowerCase(); // "above" or "below"
  const tokenLabel = match[1].toUpperCase();

  return {
    pattern: `Will ${tokenLabel} be ${direction} \${price} in ${match[3]} ${match[4]}?`,
    tokenId,
    durationSecs,
    feeBps: 200,
    category: "crypto",
  };
}

/** Generate successor question from template + current price. */
export function generateSuccessorQuestion(
  template: RecurringTemplate,
  currentPrice: number
): string {
  // Round price to reasonable precision
  const formatted = currentPrice >= 100
    ? `$${Math.round(currentPrice).toLocaleString("en-US")}`
    : currentPrice >= 1
      ? `$${currentPrice.toFixed(2)}`
      : `$${currentPrice.toFixed(4)}`;

  return template.pattern.replace("${price}", formatted);
}

/* ------------------------------------------------------------------ */
/*  Auto-Claim Logic                                                    */
/* ------------------------------------------------------------------ */

export interface ClaimCandidate {
  marketId: number;
  marketAddress: string;
  question: string;
  winningOutcome: number;
}

/** Find resolved markets where the agent likely has unclaimed winnings. */
export function findClaimCandidates(
  markets: MarketState[],
  agentAddress: string | null
): ClaimCandidate[] {
  if (!agentAddress) return [];

  return markets
    .filter((m) => m.status === 2 && m.winningOutcome !== undefined)
    .map((m) => ({
      marketId: m.id,
      marketAddress: m.address,
      question: "",
      winningOutcome: m.winningOutcome ?? 0,
    }));
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function formatTimeLeft(secs: number): string {
  if (secs < 60) return `${Math.floor(secs)}s left`;
  if (secs < 3600) return `${Math.ceil(secs / 60)}m left`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h left`;
  return `${Math.floor(secs / 86400)}d left`;
}
