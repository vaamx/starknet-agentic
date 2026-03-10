/**
 * $BUZZ Token Reward Engine
 *
 * Max supply: 100,000,000 BUZZ
 * Halving: every 6 months, emission multiplier drops 50%
 * Burns: market creation (10 BUZZ), boost post (5), persona unlock (50), priority resolution (25)
 *
 * Emission schedule — tokens minted per action (epoch 0, before halving):
 * - forecast_submit:       5 BUZZ   (base for any forecast)
 * - forecast_accurate:    25 BUZZ   bonus (Brier < 0.15)
 * - forecast_elite:       75 BUZZ   bonus (Brier < 0.10)
 * - byok_forecast:        15 BUZZ   (network agent, saves API cost)
 * - debate_participate:    5 BUZZ
 * - market_create:        25 BUZZ   (net +15 after 10 BUZZ burn cost)
 * - winning_claim:         1% of STRK winnings equivalent
 * - research_contribute:  10 BUZZ
 * - starkcast_post:        2.5 BUZZ
 * - weekly_top5:         250 BUZZ   bonus (distributed to top 5 leaderboard)
 * - task_complete:        10 BUZZ   (ProveWork task completion)
 * - token_launch:         25 BUZZ   (StarkMint token launch)
 * - guild_participate:     5 BUZZ   (Guilds join/vote/propose)
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
  | "weekly_top5"
  | "task_complete"
  | "token_launch"
  | "guild_participate";

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
  retryCount?: number;
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

// ── Config (use validated config.ts values, not raw process.env) ─────────────

const BUZZ_TOKEN_ADDRESS = config.buzzTokenAddress ?? "0x0";
const BUZZ_REWARDS_ENABLED = config.buzzRewardsEnabled;
const BUZZ_EMISSION_MULTIPLIER = config.buzzEmissionMultiplier;

/** Base emission amounts per action (epoch 0, before halving). */
export const BUZZ_REWARD_AMOUNTS: Record<BuzzRewardType, number> = {
  forecast_submit: 5,
  forecast_accurate: 25,
  forecast_elite: 75,
  byok_forecast: 15,
  debate_participate: 5,
  market_create: 25,
  winning_claim: 0, // dynamic — 1% of STRK winnings
  research_contribute: 10,
  starkcast_post: 2.5,
  weekly_top5: 250,
  task_complete: 10,     // ProveWork task completion
  token_launch: 25,      // StarkMint token launch
  guild_participate: 5,  // Guilds join/vote/propose
} as const;

/** Burn costs for platform actions (in BUZZ). */
export const BUZZ_BURN_COSTS = {
  market_create: 10,       // net reward = 25 - 10 = 15 BUZZ
  boost_post: 5,           // boost a StarkCast post
  persona_unlock: 50,      // unlock a custom agent persona
  priority_resolution: 25, // request priority market resolution
} as const;

export type BuzzBurnAction = keyof typeof BUZZ_BURN_COSTS;

const BRIER_ACCURATE_THRESHOLD = 0.15;
const BRIER_ELITE_THRESHOLD = 0.10;
const WINNING_CLAIM_PERCENT = 0.01; // 1% of STRK winnings

// Halving: epoch duration matches contract (6 months = 15,768,000s)
const EPOCH_DURATION_MS = 15_768_000 * 1000;
let epochStartTime = Date.now(); // updated from contract on first query

/** Compute halving multiplier: epoch 0 = 1.0, epoch 1 = 0.5, epoch 2 = 0.25, etc. */
function getHalvingMultiplier(): number {
  const elapsed = Date.now() - epochStartTime;
  const epoch = Math.max(0, Math.floor(elapsed / EPOCH_DURATION_MS)); // clamp negative
  const capped = Math.min(epoch, 10);
  return 1 / Math.pow(2, capped);
}

// ── In-memory pending queue (persists across ticks within same process) ──────

let pendingRewards: BuzzReward[] = [];
let rewardHistory: BuzzReward[] = [];
const MAX_HISTORY = 2000;
const MAX_PENDING = 500; // hard cap to prevent unbounded growth
const MAX_RETRIES = 3;   // drop rewards after N failed mint attempts

// Dedup: prevent same address+market+type from earning twice within a window
const DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const dedupTimestamps = new Map<string, number>();

function dedupKey(type: BuzzRewardType, address: string, marketId?: number): string {
  return `${type}:${address.toLowerCase()}:${marketId ?? "global"}`;
}

function isDuplicate(type: BuzzRewardType, address: string, marketId?: number): boolean {
  const key = dedupKey(type, address, marketId);
  const ts = dedupTimestamps.get(key);
  if (ts && Date.now() - ts < DEDUP_WINDOW_MS) return true;
  return false;
}

function markRewarded(type: BuzzRewardType, address: string, marketId?: number): void {
  const key = dedupKey(type, address, marketId);
  dedupTimestamps.set(key, Date.now());
  // Prune old entries periodically
  if (dedupTimestamps.size > 1000) {
    const now = Date.now();
    for (const [k, t] of dedupTimestamps) {
      if (now - t > DEDUP_WINDOW_MS) {
        dedupTimestamps.delete(k);
      }
    }
  }
}

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

  const halvingMul = getHalvingMultiplier();
  return {
    amount: Math.max(0, Math.round(amount * BUZZ_EMISSION_MULTIPLIER * halvingMul * 100) / 100),
    types,
  };
}

/**
 * Compute BUZZ reward for a winning claim.
 * Returns 1% of the STRK winnings converted to BUZZ-equivalent amount.
 */
export function computeWinningClaimReward(strkWinnings: number): number {
  if (!BUZZ_REWARDS_ENABLED || strkWinnings <= 0) return 0;
  const halvingMul = getHalvingMultiplier();
  return Math.max(0, Math.round(strkWinnings * WINNING_CLAIM_PERCENT * BUZZ_EMISSION_MULTIPLIER * halvingMul * 100) / 100);
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
  if (!recipientAddress || !recipientAddress.startsWith("0x") || recipientAddress === "0x0") return null;

  // Dedup: skip if same address+market+type was rewarded within window
  if (isDuplicate(type, recipientAddress, options?.marketId)) return null;

  // Queue cap: prevent unbounded growth
  if (pendingRewards.length >= MAX_PENDING) return null;

  const baseAmount = options?.amount ?? BUZZ_REWARD_AMOUNTS[type];
  // If caller provided a pre-computed amount (e.g. computeWinningClaimReward), skip halving
  const amount = options?.amount !== undefined
    ? Math.max(0, Math.round(baseAmount * 100) / 100)
    : Math.max(0, Math.round(baseAmount * BUZZ_EMISSION_MULTIPLIER * getHalvingMultiplier() * 100) / 100);
  if (amount <= 0) return null;

  markRewarded(type, recipientAddress, options?.marketId);

  const reward: BuzzReward = {
    id: generateRewardId(),
    type,
    amount,
    recipientAddress,
    marketId: options?.marketId,
    reason,
    timestamp: Date.now(),
    distributed: false,
    retryCount: 0,
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

  const results: BuzzTxResult[] = [];
  let processed = 0;

  while (processed < batchSize && pendingRewards.length > 0) {
    const reward = pendingRewards.shift()!;
    processed++;

    const result = await mintBuzzReward(reward);
    results.push(result);

    if (result.status === "success") {
      reward.distributed = true;
      reward.txHash = result.txHash || undefined;
      pushToHistory(reward);
    } else {
      reward.retryCount = (reward.retryCount ?? 0) + 1;
      if (reward.retryCount < MAX_RETRIES) {
        pendingRewards.push(reward); // re-queue for retry
      } else {
        reward.distributed = false;
        pushToHistory(reward); // final failure — log once
      }
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

  // Safe BigInt conversion for fractional amounts (e.g. 0.5 BUZZ)
  // BigInt(0.5) throws RangeError — multiply first to get integer cents
  const amountWei = BigInt(Math.round(reward.amount * 1e4)) * 10n ** 14n;
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
      await Promise.race([
        provider.waitForTransaction(result.transaction_hash, { retryInterval: 3000 }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("tx wait timeout")), 30_000)),
      ]);

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

const balanceCache = new Map<string, { balance: bigint; fetchedAt: number }>();
const BALANCE_CACHE_TTL_MS = 15_000;
const BALANCE_CACHE_MAX = 100;

/**
 * Read BUZZ token balance for an address. Uses RPC failover with 15s cache.
 */
export async function getBuzzBalance(address: string): Promise<bigint> {
  if (BUZZ_TOKEN_ADDRESS === "0x0") return 0n;

  const normalizedAddr = address.toLowerCase();
  const cached = balanceCache.get(normalizedAddr);
  if (cached && Date.now() - cached.fetchedAt < BALANCE_CACHE_TTL_MS) {
    return cached.balance;
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
      if (balanceCache.size >= BALANCE_CACHE_MAX) {
        const oldest = balanceCache.keys().next().value;
        if (oldest) balanceCache.delete(oldest);
      }
      balanceCache.set(normalizedAddr, { balance, fetchedAt: Date.now() });
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
  while (rewardHistory.length > MAX_HISTORY) {
    rewardHistory.pop();
  }
}

/** Format BUZZ balance from wei (18 decimals) to human-readable string. */
export function formatBuzzBalance(weiBalance: bigint): string {
  const whole = weiBalance / 10n ** 18n;
  const frac = weiBalance % 10n ** 18n;
  const fracStr = frac.toString().padStart(18, "0").slice(0, 2);
  return `${whole.toString()}.${fracStr}`;
}

// ── Burn sink ──────────────────────────────────────────────────────────────

/**
 * Execute a BUZZ burn for a platform action.
 * Calls burn() on the contract from the user's perspective.
 * Returns the burn tx hash or null on failure.
 */
export async function executeBuzzBurn(
  action: BuzzBurnAction,
  userAddress: string,
): Promise<{ txHash: string; amount: number } | null> {
  if (BUZZ_TOKEN_ADDRESS === "0x0") return null;

  const amount = BUZZ_BURN_COSTS[action];
  const amountWei = BigInt(Math.round(amount * 1e4)) * 10n ** 14n; // amount * 1e18
  const rpcUrls = getOrderedRpcUrls();

  // Note: burn is called by the token holder, so this would need the user's
  // account. For now, the agent burns on behalf (agent must hold BUZZ).
  const privateKey = process.env.AGENT_PRIVATE_KEY;
  const agentAddress = config.AGENT_ADDRESS;
  if (!privateKey || !agentAddress) return null;

  for (const rpcUrl of rpcUrls) {
    try {
      const provider = getRpcProvider(rpcUrl);
      const account = new Account({ provider, address: agentAddress, signer: privateKey });

      const tx = {
        contractAddress: BUZZ_TOKEN_ADDRESS,
        entrypoint: "burn",
        calldata: CallData.compile({
          amount: { low: amountWei, high: 0n },
        }),
      };

      const result = await account.execute([tx]);
      await provider.waitForTransaction(result.transaction_hash, {
        retryInterval: 3000,
      });

      return { txHash: result.transaction_hash, amount };
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (!/timeout|timed out|network|502|503|504|429|ECONN/i.test(msg)) {
        return null;
      }
    }
  }
  return null;
}

// ── Epoch sync ─────────────────────────────────────────────────────────────

/**
 * Sync epoch start time from the on-chain contract.
 * Call once at startup to align halving schedule.
 */
export async function syncEpochFromContract(): Promise<void> {
  if (BUZZ_TOKEN_ADDRESS === "0x0") return;
  const rpcUrls = getOrderedRpcUrls();
  for (const rpcUrl of rpcUrls) {
    try {
      const result = await getRpcProvider(rpcUrl).callContract({
        contractAddress: BUZZ_TOKEN_ADDRESS,
        entrypoint: "get_epoch_start_time",
        calldata: [],
      });
      const epochSec = Number(BigInt(result[0] ?? "0"));
      if (epochSec > 0) {
        epochStartTime = epochSec * 1000;
      }
      return;
    } catch {
      // Try next
    }
  }
}

/** Returns current halving info for the UI. */
export function getHalvingInfo(): {
  epoch: number;
  multiplier: number;
  nextHalvingAt: number;
} {
  const elapsed = Date.now() - epochStartTime;
  const epoch = Math.max(0, Math.floor(elapsed / EPOCH_DURATION_MS));
  const multiplier = getHalvingMultiplier();
  const nextHalvingAt = epochStartTime + (epoch + 1) * EPOCH_DURATION_MS;
  return { epoch, multiplier, nextHalvingAt };
}
