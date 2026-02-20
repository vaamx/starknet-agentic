/**
 * Starknet On-chain Pulse — Pulls latest block metadata for real-time signals.
 */

import { RpcProvider } from "starknet";
import type { DataPoint, DataSourceResult } from "./index";
import { config } from "../config";

const provider = new RpcProvider({ nodeUrl: config.STARKNET_RPC_URL });

export async function fetchStarknetOnchain(_question: string): Promise<DataSourceResult> {
  try {
    const blockNumber = await provider.getBlockNumber();
    const block = await provider.getBlock(blockNumber);
    const timestamp = Number((block as any).timestamp ?? 0) * 1000;
    const txCount = Array.isArray((block as any).transactions)
      ? (block as any).transactions.length
      : Array.isArray((block as any).transaction_hashes)
        ? (block as any).transaction_hashes.length
        : 0;

    const data: DataPoint[] = [
      {
        label: "Latest Block",
        value: `#${blockNumber}`,
      },
      {
        label: "Tx Count",
        value: txCount,
      },
      {
        label: "Block Time",
        value: timestamp ? new Date(timestamp).toLocaleString() : "Unknown",
      },
    ];

    return {
      source: "onchain",
      query: "starknet",
      timestamp: Date.now(),
      data,
      summary: "Latest Starknet block metrics.",
    };
  } catch (err: any) {
    return {
      source: "onchain",
      query: "starknet",
      timestamp: Date.now(),
      data: [],
      summary: `No on-chain data (${err?.message ?? "request failed"}).`,
    };
  }
}
