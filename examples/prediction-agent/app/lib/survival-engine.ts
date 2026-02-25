/**
 * Survival Engine — Economic pressure system for the autonomous agent.
 *
 * Reads the agent's real STRK wallet balance each N ticks.
 * Maps balance to a survival tier which controls:
 *   - Which Claude model is used (opus/sonnet/haiku)
 *   - Bet size multiplier (2x / 1x / 0.5x / 0 / 0)
 *   - Whether replication is eligible
 *
 * Tier smoothing: rolling window of the last 3 tier readings.
 * Only changes effective tier when 2/3 readings agree — prevents
 * a single RPC blip from killing bets.
 *
 * Caching: balance is only re-read every SURVIVAL_CHECK_INTERVAL ticks.
 * On RPC failure: returns cached state (or dead if no cache exists).
 */

import { CallData, RpcProvider } from "starknet";
import { config } from "./config";

// ── Types ────────────────────────────────────────────────────────────────────

export type SurvivalTier = "thriving" | "healthy" | "low" | "critical" | "dead";

export interface SurvivalState {
  tier: SurvivalTier;
  balanceStrk: number;
  balanceWei: bigint;
  /** true when tier is "thriving" — gate for replication logic */
  replicationEligible: boolean;
  lastCheckedAt: number;
}

// ── Module state ─────────────────────────────────────────────────────────────

const provider = new RpcProvider({ nodeUrl: config.STARKNET_RPC_URL });

let cachedState: SurvivalState | null = null;
let lastCheckedTick = -1;

/** Rolling window of raw tier strings for smoothing */
const tierWindow: SurvivalTier[] = [];
const TIER_WINDOW_SIZE = 3;

/** Total STRK earned from bets this session */
let sessionEarningsWei = 0n;

/** Timestamp of last compute sweep */
export let lastSweepAt = 0;

// ── Tier helpers ──────────────────────────────────────────────────────────────

function parseTierThreshold(key: string, defaultStrk: number): bigint {
  const raw = (config as any)[key];
  const n = raw !== undefined ? parseFloat(String(raw)) : defaultStrk;
  return BigInt(Math.round((Number.isFinite(n) ? n : defaultStrk) * 1e18));
}

function balanceToRawTier(balanceWei: bigint): SurvivalTier {
  const thriving = parseTierThreshold("SURVIVAL_TIER_THRIVING", 1000);
  const healthy  = parseTierThreshold("SURVIVAL_TIER_HEALTHY",  100);
  const low      = parseTierThreshold("SURVIVAL_TIER_LOW",      10);
  const critical = parseTierThreshold("SURVIVAL_TIER_CRITICAL", 1);

  if (balanceWei >= thriving) return "thriving";
  if (balanceWei >= healthy)  return "healthy";
  if (balanceWei >= low)      return "low";
  if (balanceWei >= critical) return "critical";
  return "dead";
}

/** Apply 3-tick smoothing: only change tier when 2/3 readings agree. */
function smoothTier(rawTier: SurvivalTier): SurvivalTier {
  tierWindow.push(rawTier);
  if (tierWindow.length > TIER_WINDOW_SIZE) tierWindow.shift();
  if (tierWindow.length < TIER_WINDOW_SIZE) return rawTier; // not enough data yet

  // Count occurrences
  const counts = new Map<SurvivalTier, number>();
  for (const t of tierWindow) counts.set(t, (counts.get(t) ?? 0) + 1);

  // Return first tier with count >= 2
  for (const [tier, count] of counts) {
    if (count >= 2) return tier;
  }

  // No majority — keep most recent
  return rawTier;
}

// ── Balance reading ───────────────────────────────────────────────────────────

/**
 * Read STRK balance for the given address from the STRK ERC-20 contract.
 * Returns 0n on any RPC error.
 */
export async function readStrkBalance(address: string): Promise<bigint> {
  try {
    const result = await provider.callContract({
      contractAddress: config.COLLATERAL_TOKEN_ADDRESS,
      entrypoint: "balanceOf",
      calldata: CallData.compile({ account: address }),
    });
    // u256 returned as [low, high]
    const low  = BigInt(result[0] ?? "0x0");
    const high = BigInt(result[1] ?? "0x0");
    return low + high * (2n ** 128n);
  } catch (err: any) {
    console.warn("[survival] balanceOf RPC error:", err?.message ?? String(err));
    return 0n;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Get the current survival state for the agent.
 *
 * Reads on-chain balance every SURVIVAL_CHECK_INTERVAL ticks.
 * Between checks: returns cached state.
 * On RPC failure: returns cached state (or dead if no cache).
 */
export async function getSurvivalState(tickCount: number): Promise<SurvivalState> {
  const checkInterval = parseInt(String((config as any).SURVIVAL_CHECK_INTERVAL ?? "3"), 10) || 3;
  const shouldCheck =
    cachedState === null || tickCount - lastCheckedTick >= checkInterval;

  if (!shouldCheck && cachedState) return cachedState;

  const agentAddress = config.AGENT_ADDRESS;
  if (!agentAddress) {
    const dead: SurvivalState = {
      tier: "dead", balanceStrk: 0, balanceWei: 0n,
      replicationEligible: false, lastCheckedAt: Date.now(),
    };
    return dead;
  }

  const balanceWei = await readStrkBalance(agentAddress);
  lastCheckedTick = tickCount;

  const rawTier   = balanceToRawTier(balanceWei);
  const tier      = smoothTier(rawTier);
  const balanceStrk = Number(balanceWei) / 1e18;

  const state: SurvivalState = {
    tier,
    balanceStrk,
    balanceWei,
    replicationEligible: tier === "thriving",
    lastCheckedAt: Date.now(),
  };

  cachedState = state;
  return state;
}

/** Get bet multiplier for a given tier. */
export function getBetMultiplier(tier: SurvivalTier): number {
  switch (tier) {
    case "thriving":  return 2.0;
    case "healthy":   return 1.0;
    case "low":       return 0.5;
    case "critical":  return 0.0;
    case "dead":      return 0.0;
  }
}

/** Get the Claude model identifier for a given tier. */
export function getModelForTier(tier: SurvivalTier): string {
  const raw = config as any;
  switch (tier) {
    case "thriving":  return raw.SURVIVAL_MODEL_THRIVING ?? "claude-opus-4-6";
    case "healthy":   return raw.SURVIVAL_MODEL_HEALTHY  ?? "claude-sonnet-4-6";
    case "low":
    case "critical":
    case "dead":
    default:          return raw.SURVIVAL_MODEL_LOW      ?? "claude-sonnet-4-6";
  }
}

/** Record the outcome of a bet for session earnings tracking. */
export function recordBetOutcome(amount: bigint, won: boolean): void {
  if (won) sessionEarningsWei += amount;
  else     sessionEarningsWei -= amount;
}

/** Session net STRK earnings (positive = profit). */
export function getSessionEarnings(): bigint {
  return sessionEarningsWei;
}

/** Mark that the last sweep happened now. */
export function markSweepCompleted(): void {
  lastSweepAt = Date.now();
}

/** Get the timestamp of the last compute sweep. */
export function getLastSweepAt(): number {
  return lastSweepAt;
}
