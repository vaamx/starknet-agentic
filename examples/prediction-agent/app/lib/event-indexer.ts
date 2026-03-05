/**
 * On-chain event indexer — fetches real BetPlaced and PredictionRecorded events
 * from Starknet RPC using provider.getEvents().
 */

import { RpcProvider, hash } from "starknet";
import { config } from "./config";

const provider = new RpcProvider({ nodeUrl: config.STARKNET_RPC_URL });

export interface OnChainActivity {
  id: string;
  type: "bet" | "prediction" | "market_creation";
  actor: string;
  marketAddress: string;
  marketId?: number;
  outcome?: number;
  amount?: string;
  probability?: number;
  txHash: string;
  timestamp: number;
  blockNumber: number;
}

const BET_PLACED_SELECTOR = hash.getSelectorFromName("BetPlaced");
const PREDICTION_RECORDED_SELECTOR = hash.getSelectorFromName("PredictionRecorded");
const MARKET_CREATED_SELECTOR = hash.getSelectorFromName("MarketCreated");

// Module-level cache
let cachedActivities: OnChainActivity[] = [];
let cacheTimestamp = 0;
const CACHE_TTL_MS = 30_000;
const blockTimestampCache = new Map<number, number>();

/**
 * Fetch on-chain events from all known market addresses.
 * Returns cached results if within TTL.
 */
export async function getOnChainActivities(
  marketAddresses: string[],
  limit = 50,
  factoryAddress?: string
): Promise<OnChainActivity[]> {
  const now = Date.now();
  if (now - cacheTimestamp < CACHE_TTL_MS && cachedActivities.length > 0) {
    return cachedActivities.slice(-limit);
  }

  if (marketAddresses.length === 0) {
    return [];
  }

  try {
    const latestBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, latestBlock - 5000);

    const activities: OnChainActivity[] = [];

    // Fetch events in parallel for all market addresses
    const eventPromises = marketAddresses.flatMap((addr) => [
      fetchEvents(addr, BET_PLACED_SELECTOR, fromBlock, latestBlock, "bet"),
      fetchEvents(addr, PREDICTION_RECORDED_SELECTOR, fromBlock, latestBlock, "prediction"),
    ]);

    if (factoryAddress && factoryAddress !== "0x0") {
      eventPromises.push(
        fetchFactoryEvents(factoryAddress, fromBlock, latestBlock)
      );
    }

    const results = await Promise.allSettled(eventPromises);
    for (const result of results) {
      if (result.status === "fulfilled") {
        activities.push(...result.value);
      }
    }

    await populateTimestamps(activities);

    // Sort chronologically (newest first)
    activities.sort((a, b) => b.timestamp - a.timestamp);

    cachedActivities = activities;
    cacheTimestamp = now;

    return activities.slice(0, limit);
  } catch (err) {
    console.error("Event indexer error:", err);
    return cachedActivities.slice(-limit);
  }
}

async function fetchEvents(
  contractAddress: string,
  eventSelector: string,
  fromBlock: number,
  toBlock: number,
  type: "bet" | "prediction"
): Promise<OnChainActivity[]> {
  try {
    const response = await provider.getEvents({
      address: contractAddress,
      keys: [[eventSelector]],
      from_block: { block_number: fromBlock },
      to_block: { block_number: toBlock },
      chunk_size: 100,
    });

    return response.events.map((event, i) => {
      const actor = event.keys[1] ?? "0x0";
      const txHash = event.transaction_hash;

      if (type === "bet") {
        return {
          id: `${txHash}_${i}`,
          type: "bet" as const,
          actor,
          marketAddress: contractAddress,
          outcome: event.data[0] ? Number(BigInt(event.data[0])) : undefined,
          amount: event.data[1] ?? "0",
          txHash,
          timestamp: 0,
          blockNumber: event.block_number ?? toBlock,
        };
      }

      return {
        id: `${txHash}_${i}`,
        type: "prediction" as const,
        actor,
        marketAddress: contractAddress,
        probability: event.data[0] ? Number(BigInt(event.data[0])) / 1e18 : undefined,
        txHash,
        timestamp: 0,
        blockNumber: event.block_number ?? toBlock,
      };
    });
  } catch {
    return [];
  }
}

async function fetchFactoryEvents(
  contractAddress: string,
  fromBlock: number,
  toBlock: number
): Promise<OnChainActivity[]> {
  try {
    const response = await provider.getEvents({
      address: contractAddress,
      keys: [[MARKET_CREATED_SELECTOR]],
      from_block: { block_number: fromBlock },
      to_block: { block_number: toBlock },
      chunk_size: 100,
    });

    return response.events.map((event, i) => {
      const marketId = event.keys[1] ? Number(BigInt(event.keys[1])) : undefined;
      const marketAddress =
        event.data[0] ? "0x" + BigInt(event.data[0]).toString(16) : contractAddress;
      const creator = event.data[1] ?? "0x0";

      return {
        id: `${event.transaction_hash}_${i}`,
        type: "market_creation" as const,
        actor: creator,
        marketAddress,
        marketId,
        txHash: event.transaction_hash,
        timestamp: 0,
        blockNumber: event.block_number ?? toBlock,
      };
    });
  } catch {
    return [];
  }
}

/** Clear the cache (useful for testing or force-refresh). */
export function clearEventCache() {
  cachedActivities = [];
  cacheTimestamp = 0;
}

async function getBlockTimestamp(blockNumber: number): Promise<number> {
  if (blockTimestampCache.has(blockNumber)) {
    return blockTimestampCache.get(blockNumber) ?? 0;
  }
  try {
    const block = await provider.getBlock(blockNumber);
    const tsSeconds = Number((block as any).timestamp ?? 0);
    const tsMs = tsSeconds > 0 ? tsSeconds * 1000 : Date.now();
    blockTimestampCache.set(blockNumber, tsMs);
    return tsMs;
  } catch {
    return Date.now();
  }
}

async function populateTimestamps(activities: OnChainActivity[]) {
  const uniqueBlocks = Array.from(
    new Set(activities.map((a) => a.blockNumber))
  );
  const timestamps = await Promise.all(
    uniqueBlocks.map(async (bn) => [bn, await getBlockTimestamp(bn)] as const)
  );
  const map = new Map(timestamps);
  for (const activity of activities) {
    activity.timestamp = map.get(activity.blockNumber) ?? Date.now();
  }
}

/** Get simple bet counts per market address from cached events. */
export async function getOnChainActivityCounts(
  marketAddresses: string[]
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const addr of marketAddresses) counts[addr] = 0;

  const activities = await getOnChainActivities(
    marketAddresses,
    Number.MAX_SAFE_INTEGER
  );
  for (const activity of activities) {
    if (activity.type !== "bet") continue;
    counts[activity.marketAddress] = (counts[activity.marketAddress] ?? 0) + 1;
  }
  return counts;
}
