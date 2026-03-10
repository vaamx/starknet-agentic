/**
 * $BUZZ Token Reward Engine
 *
 * Emission schedule — tokens minted per action:
 * - forecast_submit:       5 BUZZ  (base for any forecast)
 * - forecast_accurate:    25 BUZZ  bonus (Brier < 0.15)
 * - forecast_elite:       50 BUZZ  bonus (Brier < 0.10)
 * - byok_forecast:        10 BUZZ  (network agent, saves API cost)
 * - debate_participate:    3 BUZZ
 * - market_create:        10 BUZZ
 * - winning_claim:         2% of STRK winnings equivalent
 * - research_contribute:   2 BUZZ
 * - starkcast_post:        1 BUZZ
 * - weekly_top5:         500 BUZZ  bonus (distributed to top 5 leaderboard)
 */

import { RpcProvider, CallData, Account } from "starknet";
import { config } from "./config";

// ── Types ────────────────────────────────────────────────────────────────────

export type BuzzRewardType =
  | "forecast_submit"
  | "forecast_accurate"
  | "forecast_elite"
  | "byok_forecast"
  | "debate_participate"
  | "market_create"
  | "winning_claim"
  | "research_contribute"
  | "starkcast_post"
  | "weekly_top5";

export interface BuzzReward {
  id: string;
  type: BuzzRewardType;
  amount: number; // in BUZZ (not wei)
  recipientAddress: string;
  marketId?: number;
  reason: string;
  timestamp: number;
  distributed: boolean;
  txHash?: string;
}

export interface BuzzTxResult {
  txHash: string;
  status: "success" | "error";
  error?: string;
}

export interface BuzzLeaderboardEntry {
  address: string;
  totalEarned: number;
  rewardBreakdown: Partial<Record<BuzzRewardType, number>>;
  rank: number;
}

// ── Config ───────────────────────────────────────────────────────────────────

const BUZZ_TOKEN_ADDRESS =
  process.env.BUZZ_TOKEN_ADDRESS ?? "0x0";
const BUZZ_REWARDS_ENABLED =
  (process.env.BUZZ_REWARDS_ENABLED ?? "true") === "true";
const BUZZ_EMISSION_MULTIPLIER =
  parseFloat(process.env.BUZZ_EMISSION_MULTIPLIER ?? "1.0") || 1.0;

/** Base emission amounts (before multiplier). */
export const BUZZ_REWARD_AMOUNTS: Record<BuzzRewardType, number> = {
  forecast_submit: 5,
  forecast_accurate: 25,
  forecast_elite: 50,
  byok_forecast: 10,
  debate_participate: 3,
  market_create: 10,
  winning_claim: 0, // dynamic — 2% of STRK winnings
  research_contribute: 2,
  starkcast_post: 1,
  weekly_top5: 500,
} as const;

const BRIER_ACCURATE_THRESHOLD = 0.15;
const BRIER_ELITE_THRESHOLD = 0.10;
const WINNING_CLAIM_PERCENT = 0.02;

// ── In-memory pending queue (persists across ticks within same process) ──────

let pendingRewards: BuzzReward[] = [];
let rewardHistory: BuzzReward[] = [];
const MAX_HISTORY = 2000;

// ── RPC helpers (same pattern as starknet-executor.ts) ───────────────────────

const providerCache = new Map<string, RpcProvider>();

function getRpcProvider(nodeUrl: string): RpcProvider {
  const key = nodeUrl.trim().replace(/\/+$/, "");
  const cached = providerCache.get(key);
  if (cached) return cached;
  const created = new RpcProvider({ nodeUrl: key });
  providerCache.set(key, created);
  return created;
}

function getOrderedRpcUrls(): string[] {
  const urls: string[] = [];
  urls.push(config.STARKNET_RPC_URL);
  const fallbacks = (process.env.STARKNET_RPC_FALLBACK_URLS ?? "")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
  for (const u of fallbacks) {
    if (!urls.includes(u)) urls.push(u);
  }
  return urls;
}

// ── Core functions ───────────────────────────────────────────────────────────

function generateRewardId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `buzz_${ts}_${rand}`;
}

/**
 * Compute the BUZZ reward for a forecast submission.
 *
 * Returns the total amount including accuracy bonuses.
 * `brierScore` should be provided only after resolution (undefined while pending).
 * `isExternal` flags BYOK network-agent forecasts.
 */
export function computeForecastReward(
  brierScore: number | undefined,
  isExternal: boolean
): { amount: number; types: BuzzRewardType[] } {
  if (!BUZZ_REWARDS_ENABLED) return { amount: 0, types: [] };

  const types: BuzzRewardType[] = [];
  let amount = 0;

  // Base submission reward
  if (isExternal) {
    types.push("byok_forecast");
    amount += BUZZ_REWARD_AMOUNTS.byok_forecast;
  } else {
    types.push("forecast_submit");
    amount += BUZZ_REWARD_AMOUNTS.forecast_submit;
  }

  // Accuracy bonuses (only when brierScore is known)
  if (brierScore !== undefined) {
    if (brierScore < BRIER_ELITE_THRESHOLD) {
      types.push("forecast_elite");
      amount += BUZZ_REWARD_AMOUNTS.forecast_elite;
    } else if (brierScore < BRIER_ACCURATE_THRESHOLD) {
      types.push("forecast_accurate");
      amount += BUZZ_REWARD_AMOUNTS.forecast_accurate;
    }
  }

  return {
    amount: Math.round(amount * BUZZ_EMISSION_MULTIPLIER),
    types,
  };
}

/**
 * Compute BUZZ reward for a winning claim.
 * Returns 2% of the STRK winnings converted to BUZZ-equivalent amount.
 */
export function computeWinningClaimReward(strkWinnings: number): number {
  if (!BUZZ_REWARDS_ENABLED || strkWinnings <= 0) return 0;
  return Math.round(strkWinnings * WINNING_CLAIM_PERCENT * BUZZ_EMISSION_MULTIPLIER);
}

/**
 * Queue a BUZZ reward for batch minting.
 * Returns the created reward record.
 */
export function queueBuzzReward(
  type: BuzzRewardType,
  recipientAddress: string,
  reason: string,
  options?: {
    amount?: number; // override base amount
    marketId?: number;
  }
): BuzzReward | null {
  if (!BUZZ_REWARDS_ENABLED) return null;

  const baseAmount = options?.amount ?? BUZZ_REWARD_AMOUNTS[type];
  const amount = Math.round(baseAmount * BUZZ_EMISSION_MULTIPLIER);
  if (amount <= 0) return null;

  const reward: BuzzReward = {
    id: generateRewardId(),
    type,
    amount,
    recipientAddress,
    marketId: options?.marketId,
    reason,
    timestamp: Date.now(),
    distributed: false,
  };

  pendingRewards.push(reward);
  return reward;
}

/**
 * Process pending BUZZ rewards — batch mints up to `batchSize` per call.
 * Designed to be called once per agent tick for gas efficiency.
 */
export async function processPendingBuzzRewards(
  batchSize = 10
): Promise<BuzzTxResult[]> {
  if (!BUZZ_REWARDS_ENABLED || pendingRewards.length === 0) return [];
  if (BUZZ_TOKEN_ADDRESS === "0x0") {
    // No contract deployed yet — mark rewards as distributed (dry run)
    const batch = pendingRewards.splice(0, batchSize);
    for (const r of batch) {
      r.distributed = true;
      pushToHistory(r);
    }
    return batch.map((r) => ({
      txHash: "",
      status: "success" as const,
      error: "dry-run: no BUZZ contract deployed",
    }));
  }

  const batch = pendingRewards.splice(0, batchSize);
  const results: BuzzTxResult[] = [];

  for (const reward of batch) {
    const result = await mintBuzzReward(reward);
    reward.distributed = result.status === "success";
    reward.txHash = result.txHash || undefined;
    pushToHistory(reward);
    results.push(result);

    // Re-queue on failure so it can be retried next tick
    if (result.status === "error") {
      reward.distributed = false;
      pendingRewards.push(reward);
    }
  }

  return results;
}

/**
 * Mint BUZZ tokens to a recipient by calling the contract's `mint(to, amount)`.
 * Uses RPC failover like starknet-executor.ts.
 */
async function mintBuzzReward(reward: BuzzReward): Promise<BuzzTxResult> {
  const privateKey = process.env.AGENT_PRIVATE_KEY;
  const agentAddress = config.AGENT_ADDRESS;
  if (!privateKey || !agentAddress) {
    return { txHash: "", status: "error", error: "No agent account configured" };
  }

  const amountWei = BigInt(reward.amount) * 10n ** 18n;
  const rpcUrls = getOrderedRpcUrls();

  for (const rpcUrl of rpcUrls) {
    try {
      const provider = getRpcProvider(rpcUrl);
      const account = new Account({ provider, address: agentAddress, signer: privateKey });

      const tx = {
        contractAddress: BUZZ_TOKEN_ADDRESS,
        entrypoint: "mint",
        calldata: CallData.compile({
          to: reward.recipientAddress,
          amount: { low: amountWei, high: 0n },
        }),
      };

      const result = await account.execute([tx]);
      await provider.waitForTransaction(result.transaction_hash, {
        retryInterval: 3000,
      });

      return { txHash: result.transaction_hash, status: "success" };
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      // Retry on RPC-level errors, not contract reverts
      if (!/timeout|timed out|network|502|503|504|429|ECONN/i.test(msg)) {
        return { txHash: "", status: "error", error: msg };
      }
    }
  }

  return { txHash: "", status: "error", error: "All RPC providers failed" };
}

// ── Balance reader ───────────────────────────────────────────────────────────

let balanceCache: { address: string; balance: bigint; fetchedAt: number } | null = null;
const BALANCE_CACHE_TTL_MS = 15_000;

/**
 * Read BUZZ token balance for an address. Uses RPC failover with 15s cache.
 */
export async function getBuzzBalance(address: string): Promise<bigint> {
  if (BUZZ_TOKEN_ADDRESS === "0x0") return 0n;

  if (
    balanceCache &&
    balanceCache.address === address &&
    Date.now() - balanceCache.fetchedAt < BALANCE_CACHE_TTL_MS
  ) {
    return balanceCache.balance;
  }

  const rpcUrls = getOrderedRpcUrls();
  for (const rpcUrl of rpcUrls) {
    try {
      const result = await getRpcProvider(rpcUrl).callContract({
        contractAddress: BUZZ_TOKEN_ADDRESS,
        entrypoint: "balanceOf",
        calldata: CallData.compile({ account: address }),
      });
      const low = BigInt(result[0] ?? "0x0");
      const high = BigInt(result[1] ?? "0x0");
      const balance = low + high * (2n ** 128n);
      balanceCache = { address, balance, fetchedAt: Date.now() };
      return balance;
    } catch {
      // Try next RPC provider
    }
  }
  return 0n;
}

// ── Query helpers ────────────────────────────────────────────────────────────

/** Returns pending (not yet minted) rewards for a wallet. */
export function getPendingRewards(walletAddress: string): BuzzReward[] {
  const addr = walletAddress.toLowerCase();
  return pendingRewards.filter(
    (r) => r.recipientAddress.toLowerCase() === addr
  );
}

/** Returns reward history for a wallet (most recent first). */
export function getBuzzRewardHistory(
  walletAddress: string,
  limit = 50
): BuzzReward[] {
  const addr = walletAddress.toLowerCase();
  return rewardHistory
    .filter((r) => r.recipientAddress.toLowerCase() === addr)
    .slice(0, Math.max(1, limit));
}

/** Returns total BUZZ earned by a wallet (from history). */
export function getTotalBuzzEarned(walletAddress: string): number {
  const addr = walletAddress.toLowerCase();
  return rewardHistory
    .filter(
      (r) => r.recipientAddress.toLowerCase() === addr && r.distributed
    )
    .reduce((sum, r) => sum + r.amount, 0);
}

/** Returns the top earners leaderboard. */
export function getBuzzLeaderboard(limit = 20): BuzzLeaderboardEntry[] {
  const earnerMap = new Map<
    string,
    { total: number; breakdown: Partial<Record<BuzzRewardType, number>> }
  >();

  for (const r of rewardHistory) {
    if (!r.distributed) continue;
    const addr = r.recipientAddress.toLowerCase();
    const entry = earnerMap.get(addr) ?? { total: 0, breakdown: {} };
    entry.total += r.amount;
    entry.breakdown[r.type] = (entry.breakdown[r.type] ?? 0) + r.amount;
    earnerMap.set(addr, entry);
  }

  const sorted = Array.from(earnerMap.entries())
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, Math.max(1, limit));

  return sorted.map(([address, data], idx) => ({
    address,
    totalEarned: data.total,
    rewardBreakdown: data.breakdown,
    rank: idx + 1,
  }));
}

/** Returns aggregate stats. */
export function getBuzzStats(): {
  totalDistributed: number;
  totalPending: number;
  uniqueRecipients: number;
  rewardCountByType: Partial<Record<BuzzRewardType, number>>;
} {
  const byType: Partial<Record<BuzzRewardType, number>> = {};
  const recipients = new Set<string>();
  let totalDistributed = 0;

  for (const r of rewardHistory) {
    if (r.distributed) {
      totalDistributed += r.amount;
      recipients.add(r.recipientAddress.toLowerCase());
      byType[r.type] = (byType[r.type] ?? 0) + 1;
    }
  }

  return {
    totalDistributed,
    totalPending: pendingRewards.reduce((s, r) => s + r.amount, 0),
    uniqueRecipients: recipients.size,
    rewardCountByType: byType,
  };
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function pushToHistory(reward: BuzzReward): void {
  rewardHistory.unshift(reward);
  if (rewardHistory.length > MAX_HISTORY) {
    rewardHistory = rewardHistory.slice(0, MAX_HISTORY);
  }
}

/** Format BUZZ balance from wei (18 decimals) to human-readable string. */
export function formatBuzzBalance(weiBalance: bigint): string {
  const whole = weiBalance / 10n ** 18n;
  const frac = weiBalance % 10n ** 18n;
  const fracStr = frac.toString().padStart(18, "0").slice(0, 2);
  return `${whole.toString()}.${fracStr}`;
}
