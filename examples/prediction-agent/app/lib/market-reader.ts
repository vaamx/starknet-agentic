import { RpcProvider, Contract } from "starknet";
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

export interface LeaderboardEntry {
  agent: string;
  avgBrier: number;
  predictionCount: number;
  rank: number;
}

/** Get all markets from the factory. */
export async function getMarkets(): Promise<MarketState[]> {
  if (config.MARKET_FACTORY_ADDRESS === "0x0") return [];

  try {
    const factory = new Contract({ abi: FACTORY_ABI as any, address: config.MARKET_FACTORY_ADDRESS, providerOrAccount: provider });
    const countResult = await factory.get_market_count();
    const count = Number(countResult);

    // Fetch all addresses in parallel
    const addrPromises = Array.from({ length: count }, (_, i) =>
      factory.get_market(i).then((addr: any) => "0x" + BigInt(addr.toString()).toString(16))
    );
    const addresses = await Promise.all(addrPromises);

    // Fetch all market states in parallel
    const statePromises = addresses.map((addr, i) => getMarketState(i, addr));
    return await Promise.all(statePromises);
  } catch (err) {
    console.error("Failed to fetch on-chain markets:", err);
    return [];
  }
}

/** Get a single market by ID from the factory. */
export async function getMarketById(id: number): Promise<MarketState | null> {
  if (config.MARKET_FACTORY_ADDRESS === "0x0") return null;

  try {
    const factory = new Contract({ abi: FACTORY_ABI as any, address: config.MARKET_FACTORY_ADDRESS, providerOrAccount: provider });
    const addr = await factory.get_market(id);
    const addrHex = "0x" + BigInt(addr.toString()).toString(16);
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

  return {
    id,
    address,
    questionHash: "0x" + BigInt(info[0].toString()).toString(16),
    resolutionTime: Number(info[1]),
    oracle: "0x" + BigInt(info[2].toString()).toString(16),
    collateralToken: "0x" + BigInt(info[3].toString()).toString(16),
    feeBps: Number(info[4]),
    status: Number(status),
    totalPool: BigInt(totalPool.toString()),
    yesPool: BigInt(probs[1]?.[1]?.toString() ?? "0"),
    noPool: BigInt(probs[0]?.[1]?.toString() ?? "0"),
    impliedProbYes: fromScaled(BigInt(probs[1]?.[1]?.toString() ?? "500000000000000000")),
    impliedProbNo: fromScaled(BigInt(probs[0]?.[1]?.toString() ?? "500000000000000000")),
  };
}

/** Get agent predictions for a market. */
export async function getAgentPredictions(marketId: number): Promise<AgentPrediction[]> {
  if (config.ACCURACY_TRACKER_ADDRESS === "0x0") return [];

  const tracker = new Contract({ abi: ACCURACY_ABI as any, address: config.ACCURACY_TRACKER_ADDRESS, providerOrAccount: provider });
  const count = Number(await tracker.get_market_predictor_count(marketId));

  const predictions: AgentPrediction[] = [];
  for (let i = 0; i < count; i++) {
    const agentRaw = await tracker.get_market_predictor(marketId, i);
    const agent = "0x" + BigInt(agentRaw.toString()).toString(16);
    const prediction = await tracker.get_prediction(agent, marketId);
    const [cumulative, predCount] = await tracker.get_brier_score(agent);

    predictions.push({
      agent,
      marketId,
      predictedProb: fromScaled(BigInt(prediction.toString())),
      brierScore: averageBrier(BigInt(cumulative.toString()), BigInt(predCount.toString())),
      predictionCount: Number(predCount),
    });
  }
  return predictions;
}

/** Get reputation-weighted probability. */
export async function getWeightedProbability(marketId: number): Promise<number | null> {
  if (config.ACCURACY_TRACKER_ADDRESS === "0x0") return null;

  const tracker = new Contract({ abi: ACCURACY_ABI as any, address: config.ACCURACY_TRACKER_ADDRESS, providerOrAccount: provider });
  const result = await tracker.get_weighted_probability(marketId);
  return fromScaled(BigInt(result.toString()));
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
    const marketCount = Number(countResult);

    // Collect all unique agents and their scores across all markets
    const agentMap = new Map<string, { cumBrier: number; totalPreds: number }>();

    for (let mId = 0; mId < marketCount; mId++) {
      try {
        const predCount = Number(await tracker.get_market_predictor_count(mId));
        for (let i = 0; i < predCount; i++) {
          const agentRaw = await tracker.get_market_predictor(mId, i);
          const agent = "0x" + BigInt(agentRaw.toString()).toString(16);
          const [cumulative, pCount] = await tracker.get_brier_score(agent);
          const cumulativeNum = Number(BigInt(cumulative.toString())) / 1e18;
          const predCountNum = Number(pCount);

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

/** Register a custom question text for a new market ID. */
export function registerQuestion(marketId: number, question: string) {
  MARKET_QUESTIONS[marketId] = question;
}

/** Check if a market question is Super Bowl related. */
export function isSuperBowlMarket(marketId: number): boolean {
  return marketId >= 0 && marketId <= 9;
}

/** Regex to detect Super Bowl related questions. */
export const SUPER_BOWL_REGEX =
  /super bowl|nfl|seahawks|patriots|touchdown|quarterback|mvp|halftime|spread|overtime|rushing|first score|defensive/i;
