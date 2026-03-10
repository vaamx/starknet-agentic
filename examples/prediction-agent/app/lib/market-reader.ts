import { RpcProvider, Contract, shortString } from "starknet";
import { config } from "./config";
import { fromScaled, averageBrier } from "./accuracy";
import { getAllMarketQuestions } from "./market-db";
import {
  loadAllQuestions as loadQuestionsFromUpstash,
  persistQuestion as persistQuestionToUpstash,
} from "./market-questions-store";

// Create a fresh provider per invocation to avoid stale/corrupted state on Vercel serverless
function getProvider(): RpcProvider {
  return new RpcProvider({ nodeUrl: config.STARKNET_RPC_URL });
}

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
const CACHE_TTL_MS = 10_000;

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
    // Use raw callContract to avoid starknet.js Contract class JSON parsing issues on Vercel
    const countRaw = await getProvider().callContract({
      contractAddress: config.MARKET_FACTORY_ADDRESS,
      entrypoint: "get_market_count",
      calldata: [],
    });
    const count = Number(BigInt(countRaw[0] ?? "0"));
    if (!Number.isFinite(count) || count <= 0) {
      marketsCache = { data: [], fetchedAt: Date.now() };
      return [];
    }

    // Fetch addresses with concurrency limit
    const indices = Array.from({ length: count }, (_, i) => i);
    const addresses: string[] = await withConcurrencyLimit(indices, 20, async (i) => {
      const raw = await getProvider().callContract({
        contractAddress: config.MARKET_FACTORY_ADDRESS,
        entrypoint: "get_market",
        calldata: [String(i), "0"], // u256 = (low, high)
      });
      return toAddressHex(raw[0] ?? "0x0");
    });

    // Fetch market states with concurrency limit
    const pairs = addresses.map((addr, i) => ({ addr, i }));
    const states: (MarketState | null)[] = await withConcurrencyLimit(pairs, 20, async ({ addr, i }) =>
      addr && addr !== "0x0" ? getMarketState(i, addr) : null
    );
    const result = states.filter((s): s is MarketState => s !== null);

    marketsCache = { data: result, fetchedAt: Date.now() };
    return result;
  } catch (err) {
    console.error("[getMarkets] Failed to fetch on-chain markets:", err);
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
    const raw = await getProvider().callContract({
      contractAddress: config.MARKET_FACTORY_ADDRESS,
      entrypoint: "get_market",
      calldata: [String(id), "0"], // u256 = (low, high)
    });
    const addrHex = toAddressHex(raw[0] ?? "0x0");
    return await getMarketState(id, addrHex);
  } catch {
    return null;
  }
}

/** Get a single market's state. */
export async function getMarketState(id: number, address: string): Promise<MarketState> {
  // Use raw callContract with fresh provider to avoid JSON parsing issues on Vercel
  const p = new RpcProvider({ nodeUrl: config.STARKNET_RPC_URL });
  const call = (entrypoint: string, calldata: string[] = []) =>
    p.callContract({ contractAddress: address, entrypoint, calldata });

  const [statusRaw, poolRaw, probsRaw, infoRaw] = await Promise.all([
    call("get_status"),
    call("get_total_pool"),
    call("get_implied_probs"),
    call("get_market_info"),
  ]);

  const statusNum = Number(BigInt(statusRaw[0] ?? "0"));
  let winningOutcome: number | undefined;
  if (statusNum === 2) {
    try {
      const wo = await call("get_winning_outcome");
      winningOutcome = Number(BigInt(wo[0] ?? "0"));
    } catch {
      winningOutcome = undefined;
    }
  }

  const HALF = BigInt("500000000000000000");
  const ONE = BigInt("1000000000000000000");

  // get_total_pool returns u256 (low, high)
  const poolLow = BigInt(poolRaw[0] ?? "0");
  const poolHigh = BigInt(poolRaw[1] ?? "0");
  const pool = poolLow + (poolHigh << 128n);

  // get_implied_probs returns Array<(u8, u256)> — serialized as flat felts:
  // [array_len, outcome0, prob0_low, prob0_high, outcome1, prob1_low, prob1_high, ...]
  const probsFelts = probsRaw;
  const arrayLen = Number(BigInt(probsFelts[0] ?? "0"));
  let rawProbYes = HALF;
  let rawProbNo = HALF;
  if (arrayLen >= 2) {
    // Each tuple: (outcome_u8, prob_u256_low, prob_u256_high)
    const outcome0 = Number(BigInt(probsFelts[1] ?? "0"));
    const prob0 = BigInt(probsFelts[2] ?? "0") + (BigInt(probsFelts[3] ?? "0") << 128n);
    const outcome1 = Number(BigInt(probsFelts[4] ?? "0"));
    const prob1 = BigInt(probsFelts[5] ?? "0") + (BigInt(probsFelts[6] ?? "0") << 128n);
    // outcome 0 = No, outcome 1 = Yes
    if (outcome0 === 0) { rawProbNo = prob0; rawProbYes = prob1; }
    else { rawProbYes = prob0; rawProbNo = prob1; }
  }

  // get_market_info returns (felt252, u64, ContractAddress, ContractAddress, u16)
  const questionHash = toAddressHex(infoRaw[0] ?? "0x0");
  const resolutionTime = Number(BigInt(infoRaw[1] ?? "0"));
  const oracle = toAddressHex(infoRaw[2] ?? "0x0");
  const collateralToken = toAddressHex(infoRaw[3] ?? "0x0");
  const feeBps = Number(BigInt(infoRaw[4] ?? "0"));

  return {
    id,
    address,
    questionHash,
    resolutionTime,
    oracle,
    collateralToken,
    feeBps,
    status: statusNum,
    totalPool: pool,
    yesPool: pool * rawProbYes / ONE,
    noPool: pool * rawProbNo / ONE,
    impliedProbYes: fromScaled(rawProbYes),
    impliedProbNo: fromScaled(rawProbNo),
    winningOutcome,
  };
}

// Fallback RPC URLs for when primary (Lava) is rate-limited after heavy load
const FALLBACK_RPC_URLS = [
  config.STARKNET_RPC_URL,
  "https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_7/GUBwFqKhSgn4mwVbN6Sbn",
  "https://free-rpc.nethermind.io/sepolia-juno/v0_7",
];

/** Get a user's bet amounts for a market. */
export async function getUserPosition(
  marketAddress: string,
  userAddress: string
): Promise<{ yesBet: bigint; noBet: bigint }> {
  const callBet = async (outcome: number): Promise<bigint> => {
    // Try each RPC URL until one works (Lava can return malformed JSON after heavy load)
    for (const rpcUrl of FALLBACK_RPC_URLS) {
      try {
        const p = new RpcProvider({ nodeUrl: rpcUrl });
        const result = await p.callContract({
          contractAddress: marketAddress,
          entrypoint: "get_bet",
          calldata: [userAddress, String(outcome)],
        });
        const low = BigInt(result[0] ?? "0");
        const high = BigInt(result[1] ?? "0");
        return low + (high << 128n);
      } catch {
        continue;
      }
    }
    return 0n;
  };
  const [yesBet, noBet] = await Promise.all([callBet(1), callBet(0)]);
  return { yesBet, noBet };
}

/** Get agent predictions for a market. */
export async function getAgentPredictions(marketId: number): Promise<AgentPrediction[]> {
  if (config.ACCURACY_TRACKER_ADDRESS === "0x0") return [];

  const tracker = new Contract({ abi: ACCURACY_ABI as any, address: config.ACCURACY_TRACKER_ADDRESS, providerOrAccount: getProvider() });
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
      providerOrAccount: getProvider(),
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

  const tracker = new Contract({ abi: ACCURACY_ABI as any, address: config.ACCURACY_TRACKER_ADDRESS, providerOrAccount: getProvider() });
  const result = await tracker.get_weighted_probability(marketId);
  return fromScaled(parseBigNumberish(result));
}

/** Build a leaderboard from on-chain AccuracyTracker data across all markets. */
export async function getOnChainLeaderboard(): Promise<LeaderboardEntry[]> {
  if (config.ACCURACY_TRACKER_ADDRESS === "0x0" || config.MARKET_FACTORY_ADDRESS === "0x0") {
    return [];
  }

  try {
    const factory = new Contract({ abi: FACTORY_ABI as any, address: config.MARKET_FACTORY_ADDRESS, providerOrAccount: getProvider() });
    const tracker = new Contract({ abi: ACCURACY_ABI as any, address: config.ACCURACY_TRACKER_ADDRESS, providerOrAccount: getProvider() });

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

/**
 * Hydrate MARKET_QUESTIONS from SQLite.
 * Fills in questions for markets 14+ that were created at runtime
 * and lost on Vercel cold starts.
 */
async function hydrateQuestionsFromDb(): Promise<void> {
  try {
    const dbQuestions = await getAllMarketQuestions();
    for (const row of dbQuestions) {
      if (!MARKET_QUESTIONS[row.id] && row.question) {
        MARKET_QUESTIONS[row.id] = row.question;
      }
    }
  } catch {
    // SQLite unavailable (e.g. Vercel edge) — fall through gracefully
  }
}

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

  // Hydrate from SQLite — fills in questions for markets 14+ that were
  // created at runtime and lost on Vercel cold starts.
  hydrateQuestionsFromDb().catch(() => {});

  // Async hydration from Upstash — resolves after seed but fills in-memory map
  // for subsequent resolveMarketQuestion() calls within the same request.
  hydrateQuestionsFromUpstash().catch(() => {});
}

let upstashHydrated = false;

async function hydrateQuestionsFromUpstash(): Promise<void> {
  if (upstashHydrated) return;
  upstashHydrated = true;
  try {
    const questions = await loadQuestionsFromUpstash();
    for (const [idStr, question] of Object.entries(questions)) {
      const id = Number(idStr);
      if (!MARKET_QUESTIONS[id] || /^Market #\d+$/.test(MARKET_QUESTIONS[id])) {
        MARKET_QUESTIONS[id] = question;
      }
    }
    if (Object.keys(questions).length > 0) {
      console.log(`[market-reader] Hydrated ${Object.keys(questions).length} questions from Upstash`);
    }
  } catch {
    // Upstash unavailable — no-op
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
  if (normalized && !/^Market #\d+$/.test(normalized)) {
    MARKET_QUESTIONS[marketId] = normalized;
    // Fire-and-forget persist to Upstash for cold-start resilience
    persistQuestionToUpstash(marketId, normalized).catch(() => {});
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
  if (mapped && !/^Market #\d+$/.test(mapped)) return mapped;

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

/**
 * Async version that also checks Upstash before falling back to placeholder.
 * Use this in API routes where you can await.
 */
export async function resolveMarketQuestionAsync(
  marketId: number,
  questionHash?: string | null
): Promise<string> {
  const sync = resolveMarketQuestion(marketId, questionHash);
  if (!/^Market #\d+$/.test(sync)) return sync;

  // Last resort: check Upstash directly
  try {
    const { getQuestion } = await import("./market-questions-store");
    const fromUpstash = await getQuestion(marketId);
    if (fromUpstash) {
      MARKET_QUESTIONS[marketId] = fromUpstash;
      return fromUpstash;
    }
  } catch {
    // Upstash unavailable
  }

  return sync;
}

/** Check if a market question is Super Bowl related. */
export function isSuperBowlMarket(marketId: number): boolean {
  return marketId >= 0 && marketId <= 9;
}

/** Regex to detect Super Bowl related questions. */
export const SUPER_BOWL_REGEX =
  /super bowl|nfl|seahawks|patriots|touchdown|quarterback|mvp|halftime|spread|overtime|rushing|first score|defensive/i;
