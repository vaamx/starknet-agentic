import { RpcProvider, Contract, shortString } from "starknet";
import { config } from "./config";
import { fromScaled, averageBrier } from "./accuracy";

const provider = new RpcProvider({ nodeUrl: config.STARKNET_RPC_URL });

// Simplified ABIs for read-only calls
const MARKET_ABI = [
  {
    name: "get_status",
    type: "function",
    inputs: [],
    outputs: [{ type: "core::integer::u8" }],
    state_mutability: "view",
  },
  {
    name: "get_total_pool",
    type: "function",
    inputs: [],
    outputs: [{ type: "core::integer::u256" }],
    state_mutability: "view",
  },
  {
    name: "get_implied_probs",
    type: "function",
    inputs: [],
    outputs: [{ type: "core::array::Array::<(core::integer::u8, core::integer::u256)>" }],
    state_mutability: "view",
  },
  {
    name: "get_market_info",
    type: "function",
    inputs: [],
    outputs: [
      { type: "core::felt252" },
      { type: "core::integer::u64" },
      { type: "core::starknet::contract_address::ContractAddress" },
      { type: "core::starknet::contract_address::ContractAddress" },
      { type: "core::integer::u16" },
    ],
    state_mutability: "view",
  },
  {
    name: "get_bet",
    type: "function",
    inputs: [
      { name: "user", type: "core::starknet::contract_address::ContractAddress" },
      { name: "outcome", type: "core::integer::u8" },
    ],
    outputs: [{ type: "core::integer::u256" }],
    state_mutability: "view",
  },
  {
    name: "get_winning_outcome",
    type: "function",
    inputs: [],
    outputs: [{ type: "core::integer::u8" }],
    state_mutability: "view",
  },
] as const;

const FACTORY_ABI = [
  {
    name: "get_market_count",
    type: "function",
    inputs: [],
    outputs: [{ type: "core::integer::u256" }],
    state_mutability: "view",
  },
  {
    name: "get_market",
    type: "function",
    inputs: [{ name: "id", type: "core::integer::u256" }],
    outputs: [{ type: "core::starknet::contract_address::ContractAddress" }],
    state_mutability: "view",
  },
] as const;

const ACCURACY_ABI = [
  {
    name: "get_brier_score",
    type: "function",
    inputs: [{ name: "agent", type: "core::starknet::contract_address::ContractAddress" }],
    outputs: [{ type: "core::integer::u256" }, { type: "core::integer::u64" }],
    state_mutability: "view",
  },
  {
    name: "get_prediction",
    type: "function",
    inputs: [
      { name: "agent", type: "core::starknet::contract_address::ContractAddress" },
      { name: "market_id", type: "core::integer::u256" },
    ],
    outputs: [{ type: "core::integer::u256" }],
    state_mutability: "view",
  },
  {
    name: "get_market_predictor_count",
    type: "function",
    inputs: [{ name: "market_id", type: "core::integer::u256" }],
    outputs: [{ type: "core::integer::u64" }],
    state_mutability: "view",
  },
  {
    name: "get_market_predictor",
    type: "function",
    inputs: [
      { name: "market_id", type: "core::integer::u256" },
      { name: "index", type: "core::integer::u64" },
    ],
    outputs: [{ type: "core::starknet::contract_address::ContractAddress" }],
    state_mutability: "view",
  },
  {
    name: "get_weighted_probability",
    type: "function",
    inputs: [{ name: "market_id", type: "core::integer::u256" }],
    outputs: [{ type: "core::integer::u256" }],
    state_mutability: "view",
  },
  {
    name: "is_finalized",
    type: "function",
    inputs: [{ name: "market_id", type: "core::integer::u256" }],
    outputs: [{ type: "core::bool" }],
    state_mutability: "view",
  },
] as const;

export interface MarketState {
  id: number;
  address: string;
  questionHash: string;
  resolutionTime: number;
  oracle: string;
  collateralToken: string;
  feeBps: number;
  status: number; // 0=OPEN, 1=CLOSED, 2=RESOLVED
  totalPool: bigint;
  yesPool: bigint;
  noPool: bigint;
  impliedProbYes: number;
  impliedProbNo: number;
  winningOutcome?: number;
}

export interface AgentPrediction {
  agent: string;
  marketId: number;
  predictedProb: number;
  brierScore: number;
  predictionCount: number;
}

export interface AgentBrierStats {
  brierScore: number;
  predictionCount: number;
}

export interface LeaderboardEntry {
  agent: string;
  avgBrier: number;
  predictionCount: number;
  rank: number;
}

// ── Server-side market cache ──────────────────────────────────────────────────
// Shared by /api/markets, /api/markets/[id], singleTick(), etc.
// Prevents 76+ parallel RPC calls per consumer per page load.

let marketsCache: { data: MarketState[]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 30_000;

/** Invalidate the market cache (e.g. after a bet or market creation). */
export function invalidateMarketsCache(): void {
  marketsCache = null;
}

const PRINTABLE_ASCII_REGEX = /^[\x20-\x7E]+$/;

function normalizeQuestion(value: string): string {
  return value.replace(/\0/g, "").replace(/\s+/g, " ").trim();
}

function stripLegacyDurationHashSuffix(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^(.+?)\s+\d+d\s+[0-9a-f]{4}$/i);
  return match ? match[1].trim() : trimmed;
}

function sanitizeDisplayQuestion(value: string): string {
  let cleaned = normalizeQuestion(stripLegacyDurationHashSuffix(value));
  cleaned = cleaned
    .replace(/\bwin t$/i, "win")
    .replace(/\s+[:([{-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned;
}

function parseBigNumberish(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return 0n;
    return BigInt(Math.trunc(value));
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return 0n;
    try {
      return BigInt(trimmed);
    } catch {
      return 0n;
    }
  }
  if (Array.isArray(value) && value.length > 0) {
    return parseBigNumberish(value[0]);
  }
  if (value && typeof value === "object") {
    const low =
      (value as any).low ??
      (value as any).lo ??
      (value as any).l ??
      (value as any).value?.low;
    const high =
      (value as any).high ??
      (value as any).hi ??
      (value as any).h ??
      (value as any).value?.high;
    if (low !== undefined || high !== undefined) {
      const lo = parseBigNumberish(low ?? 0);
      const hi = parseBigNumberish(high ?? 0);
      return lo + (hi << 128n);
    }
    const nested =
      (value as any).value ??
      (value as any).result ??
      (value as any).res;
    if (nested !== undefined && nested !== value) {
      return parseBigNumberish(nested);
    }
  }
  if (value && typeof (value as any).toString === "function") {
    const raw = String((value as any).toString());
    if (raw && raw !== "[object Object]") {
      try {
        return BigInt(raw);
      } catch {
        return 0n;
      }
    }
  }
  return 0n;
}

function toAddressHex(value: unknown): string {
  const parsed = parseBigNumberish(value);
  return `0x${parsed.toString(16)}`;
}

function toSafeNumber(value: unknown): number {
  const parsed = parseBigNumberish(value);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number.MAX_SAFE_INTEGER;
  }
  if (parsed < BigInt(Number.MIN_SAFE_INTEGER)) {
    return Number.MIN_SAFE_INTEGER;
  }
  return Number(parsed);
}

function parseBrierScoreTuple(result: unknown): {
  cumulative: bigint;
  predictionCount: bigint;
} {
  if (Array.isArray(result) && result.length >= 2) {
    return {
      cumulative: parseBigNumberish(result[0]),
      predictionCount: parseBigNumberish(result[1]),
    };
  }

  if (result && typeof result === "object") {
    const row = result as Record<string, unknown>;
    const cumulativeRaw =
      row[0] ??
      row.cumulative ??
      row.cumulative_score ??
      row.total_brier ??
      row.totalBrier ??
      row.brier_sum;
    const predictionCountRaw =
      row[1] ??
      row.prediction_count ??
      row.predictionCount ??
      row.count;

    if (cumulativeRaw !== undefined && predictionCountRaw !== undefined) {
      return {
        cumulative: parseBigNumberish(cumulativeRaw),
        predictionCount: parseBigNumberish(predictionCountRaw),
      };
    }
  }

  return {
    cumulative: 0n,
    predictionCount: 0n,
  };
}

/**
 * Fetch items with a concurrency limit to avoid RPC rate-limiting.
 * Processes at most `concurrency` promises at a time.
 */
async function withConcurrencyLimit<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<any>
): Promise<any[]> {
  const results: any[] = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      try {
        results[idx] = await fn(items[idx]);
      } catch {
        results[idx] = null;
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

/** Get all markets from the factory (cached for 30s, concurrency-limited). */
export async function getMarkets(): Promise<MarketState[]> {
  if (config.MARKET_FACTORY_ADDRESS === "0x0") return [];

  // Return cached data if fresh
  if (marketsCache && Date.now() - marketsCache.fetchedAt < CACHE_TTL_MS) {
    return marketsCache.data;
  }

  try {
    const factory = new Contract({ abi: FACTORY_ABI as any, address: config.MARKET_FACTORY_ADDRESS, providerOrAccount: provider });
    const countResult = await factory.get_market_count();
    const count = toSafeNumber(countResult);
    if (!Number.isFinite(count) || count <= 0) {
      marketsCache = { data: [], fetchedAt: Date.now() };
      return [];
    }

    // Fetch addresses with concurrency limit (8 at a time)
    const indices = Array.from({ length: count }, (_, i) => i);
    const addresses: string[] = await withConcurrencyLimit(indices, 8, async (i) =>
      factory.get_market(i).then((addr: any) => toAddressHex(addr))
    );

    // Fetch market states with concurrency limit (8 at a time)
    const pairs = addresses.map((addr, i) => ({ addr, i }));
    const states: (MarketState | null)[] = await withConcurrencyLimit(pairs, 8, async ({ addr, i }) =>
      addr ? getMarketState(i, addr) : null
    );
    const result = states.filter((s): s is MarketState => s !== null);

    marketsCache = { data: result, fetchedAt: Date.now() };
    return result;
  } catch (err) {
    console.error("Failed to fetch on-chain markets:", err);
    return [];
  }
}

/** Get a single market by ID — uses cache when available, falls back to RPC. */
export async function getMarketById(id: number): Promise<MarketState | null> {
  if (config.MARKET_FACTORY_ADDRESS === "0x0") return null;

  // Check cache first to avoid redundant RPC calls
  if (marketsCache && Date.now() - marketsCache.fetchedAt < CACHE_TTL_MS) {
    const cached = marketsCache.data.find((m) => m.id === id);
    if (cached) return cached;
  }

  try {
    const factory = new Contract({ abi: FACTORY_ABI as any, address: config.MARKET_FACTORY_ADDRESS, providerOrAccount: provider });
    const addr = await factory.get_market(id);
    const addrHex = toAddressHex(addr);
    return await getMarketState(id, addrHex);
  } catch {
    return null;
  }
}

/** Get a single market's state. */
export async function getMarketState(id: number, address: string): Promise<MarketState> {
  const market = new Contract({ abi: MARKET_ABI as any, address, providerOrAccount: provider });

  const [status, totalPool, probs, info] = await Promise.all([
    market.get_status(),
    market.get_total_pool(),
    market.get_implied_probs(),
    market.get_market_info(),
  ]);
  const statusNum = Number(status);
  let winningOutcome: number | undefined;
  if (statusNum === 2) {
    try {
      winningOutcome = Number(await market.get_winning_outcome());
    } catch {
      winningOutcome = undefined;
    }
  }

  const numericStatus = Number(status);
  const winningOutcome =
    numericStatus === 2 ? Number(await market.get_winning_outcome()) : undefined;

  return {
    id,
    address,
    questionHash: toAddressHex(info[0]),
    resolutionTime: toSafeNumber(info[1]),
    oracle: toAddressHex(info[2]),
    collateralToken: toAddressHex(info[3]),
    feeBps: toSafeNumber(info[4]),
    status: statusNum,
    totalPool: parseBigNumberish(totalPool),
    yesPool: parseBigNumberish(probs[1]?.[1] ?? 0),
    noPool: parseBigNumberish(probs[0]?.[1] ?? 0),
    impliedProbYes: fromScaled(
      parseBigNumberish(probs[1]?.[1] ?? "500000000000000000")
    ),
    impliedProbNo: fromScaled(
      parseBigNumberish(probs[0]?.[1] ?? "500000000000000000")
    ),
    winningOutcome,
  };
}

/** Get agent predictions for a market. */
export async function getAgentPredictions(marketId: number): Promise<AgentPrediction[]> {
  if (config.ACCURACY_TRACKER_ADDRESS === "0x0") return [];

  const tracker = new Contract({ abi: ACCURACY_ABI as any, address: config.ACCURACY_TRACKER_ADDRESS, providerOrAccount: provider });
  const count = toSafeNumber(await tracker.get_market_predictor_count(marketId));

  const predictions: AgentPrediction[] = [];
  for (let i = 0; i < count; i++) {
    const agentRaw = await tracker.get_market_predictor(marketId, i);
    const agent = toAddressHex(agentRaw);
    const prediction = await tracker.get_prediction(agent, marketId);
    const { cumulative, predictionCount } = parseBrierScoreTuple(
      await tracker.get_brier_score(agent)
    );

    predictions.push({
      agent,
      marketId,
      predictedProb: fromScaled(parseBigNumberish(prediction)),
      brierScore: averageBrier(cumulative, predictionCount),
      predictionCount: Number(predictionCount),
    });
  }
  return predictions;
}

/** Get historical Brier stats for one agent address. */
export async function getAgentBrierStats(
  agentAddress: string
): Promise<AgentBrierStats | null> {
  if (config.ACCURACY_TRACKER_ADDRESS === "0x0") return null;
  if (!agentAddress) return null;

  try {
    const tracker = new Contract({
      abi: ACCURACY_ABI as any,
      address: config.ACCURACY_TRACKER_ADDRESS,
      providerOrAccount: provider,
    });
    const { cumulative, predictionCount } = parseBrierScoreTuple(
      await tracker.get_brier_score(agentAddress)
    );
    const count = Number(predictionCount);

    return {
      brierScore: averageBrier(cumulative, predictionCount),
      predictionCount: Number.isFinite(count) ? count : 0,
    };
  } catch {
    return null;
  }
}

/** Get reputation-weighted probability. */
export async function getWeightedProbability(marketId: number): Promise<number | null> {
  if (config.ACCURACY_TRACKER_ADDRESS === "0x0") return null;

  const tracker = new Contract({ abi: ACCURACY_ABI as any, address: config.ACCURACY_TRACKER_ADDRESS, providerOrAccount: provider });
  const result = await tracker.get_weighted_probability(marketId);
  return fromScaled(parseBigNumberish(result));
}

/** Build a leaderboard from on-chain AccuracyTracker data across all markets. */
export async function getOnChainLeaderboard(): Promise<LeaderboardEntry[]> {
  if (config.ACCURACY_TRACKER_ADDRESS === "0x0" || config.MARKET_FACTORY_ADDRESS === "0x0") {
    return [];
  }

  try {
    const factory = new Contract({ abi: FACTORY_ABI as any, address: config.MARKET_FACTORY_ADDRESS, providerOrAccount: provider });
    const tracker = new Contract({ abi: ACCURACY_ABI as any, address: config.ACCURACY_TRACKER_ADDRESS, providerOrAccount: provider });

    const countResult = await factory.get_market_count();
    const marketCount = toSafeNumber(countResult);

    // Collect all unique agents and their scores across all markets
    const agentMap = new Map<string, { cumBrier: number; totalPreds: number }>();

    for (let mId = 0; mId < marketCount; mId++) {
      try {
        const predCount = toSafeNumber(
          await tracker.get_market_predictor_count(mId)
        );
        for (let i = 0; i < predCount; i++) {
          const agentRaw = await tracker.get_market_predictor(mId, i);
          const agent = toAddressHex(agentRaw);
          const { cumulative, predictionCount } = parseBrierScoreTuple(
            await tracker.get_brier_score(agent)
          );
          const cumulativeNum = Number(cumulative) / 1e18;
          const predCountNum = Number(predictionCount);

          // Use global Brier stats (not per-market) to avoid double-counting
          agentMap.set(agent, {
            cumBrier: cumulativeNum,
            totalPreds: predCountNum,
          });
        }
      } catch {
        // Skip markets with errors
      }
    }

    if (agentMap.size === 0) {
      return [];
    }

    // Build sorted leaderboard
    const entries: LeaderboardEntry[] = Array.from(agentMap.entries())
      .map(([agent, data]) => ({
        agent,
        avgBrier: data.totalPreds > 0 ? data.cumBrier / data.totalPreds : 0,
        predictionCount: data.totalPreds,
        rank: 0,
      }))
      .sort((a, b) => {
        if (a.predictionCount > 0 && b.predictionCount === 0) return -1;
        if (a.predictionCount === 0 && b.predictionCount > 0) return 1;
        return a.avgBrier - b.avgBrier;
      });

    entries.forEach((e, i) => (e.rank = i + 1));
    return entries;
  } catch (err) {
    console.error("Failed to fetch on-chain leaderboard:", err);
    return [];
  }
}

// Question text mapping (off-chain metadata)
export const MARKET_QUESTIONS: Record<number, string> = {};

// ── Seed known market questions ───────────────────────────────────────────────
// Hardcoded fallback for the 14 original hand-created markets (IDs 0-13).
// These are the readable originals that produced the truncated 31-char on-chain hashes.

const SEED_QUESTIONS: Record<number, string> = {
  0: "Will the Seahawks win Super Bowl LX?",
  1: "Will the total score be over 45.5 in Super Bowl LX?",
  2: "Will any player rush for 100+ yards in Super Bowl LX?",
  3: "Will halftime last over 15 minutes in Super Bowl LX?",
  4: "Will the Super Bowl LX MVP be a quarterback?",
  5: "Will there be a defensive/special teams touchdown in Super Bowl LX?",
  6: "Will the Seahawks cover -4.5 in Super Bowl LX?",
  7: "Will the first score be a touchdown in Super Bowl LX?",
  8: "Will there be a score in the last 2 minutes of the first half in Super Bowl LX?",
  9: "Will Super Bowl LX go to overtime?",
  10: "Will ETH be above $5,000 in March 2026?",
  11: "Will STRK be above $2 in Q3 2026?",
  12: "Will Starknet reach 100 TPS in February 2026?",
  13: "Will BTC be above $90k in February 2026?",
};

let seeded = false;

/**
 * Pre-populate readable questions for known markets.
 * Sources: hardcoded seed map → persisted state file → decoded shortString.
 * Safe to call multiple times (no-op after first).
 */
export function seedKnownQuestions(): void {
  if (seeded) return;
  seeded = true;

  for (const [id, question] of Object.entries(SEED_QUESTIONS)) {
    const numId = Number(id);
    if (!MARKET_QUESTIONS[numId]) {
      MARKET_QUESTIONS[numId] = question;
    }
  }
}

/**
 * Strip the hash suffix appended by toOnChainQuestion() for auto-created markets.
 * e.g. "Will Joel Embiid win t 30d 8ab6" → "Will Joel Embiid win t"
 * Only applied when the decoded text looks like it has the suffix pattern.
 */
/** Register a custom question text for a new market ID. */
export function registerQuestion(marketId: number, question: string) {
  const normalized = sanitizeDisplayQuestion(question);
  if (normalized) {
    MARKET_QUESTIONS[marketId] = normalized;
  }
}

/** Decode a market question hash into readable text when possible. */
export function decodeQuestionHash(questionHash: string): string {
  if (!questionHash || questionHash === "0x0") return "";

  // Preferred path for short-string felt encoding used by create_market.
  try {
    const felt =
      questionHash.startsWith("0x")
        ? (questionHash as `0x${string}`)
        : (`0x${questionHash}` as `0x${string}`);
    const decoded = sanitizeDisplayQuestion(shortString.decodeShortString(felt));
    if (decoded && PRINTABLE_ASCII_REGEX.test(decoded)) {
      return decoded;
    }
  } catch {
    // Fall through to raw hex decoding.
  }

  // Fallback path for older/non-shortString encodings.
  try {
    const clean = questionHash.startsWith("0x")
      ? questionHash.slice(2)
      : questionHash;
    if (!clean || !/^[0-9a-fA-F]+$/.test(clean)) return "";
    const padded = clean.length % 2 === 0 ? clean : `0${clean}`;
    const decoded = sanitizeDisplayQuestion(
      Buffer.from(padded, "hex").toString("utf8")
    );
    return decoded && PRINTABLE_ASCII_REGEX.test(decoded) ? decoded : "";
  } catch {
    return "";
  }
}

/** Resolve display question text from in-memory metadata and on-chain question hash. */
export function resolveMarketQuestion(
  marketId: number,
  questionHash?: string | null
): string {
  // Ensure seed data is loaded
  seedKnownQuestions();

  const mapped = normalizeQuestion(MARKET_QUESTIONS[marketId] ?? "");
  if (mapped) return mapped;

  if (questionHash) {
    const decoded = decodeQuestionHash(questionHash);
    if (decoded) {
      const display = sanitizeDisplayQuestion(decoded);
      MARKET_QUESTIONS[marketId] = display;
      return display;
    }
  }

  return `Market #${marketId}`;
}

/** Check if a market question is Super Bowl related. */
export function isSuperBowlMarket(marketId: number): boolean {
  return marketId >= 0 && marketId <= 9;
}

/** Regex to detect Super Bowl related questions. */
export const SUPER_BOWL_REGEX =
  /super bowl|nfl|seahawks|patriots|touchdown|quarterback|mvp|halftime|spread|overtime|rushing|first score|defensive/i;
