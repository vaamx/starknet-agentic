/**
 * hicecaster bet <market-id> <yes|no> <amount> — Place a bet on a prediction market.
 */

import pc from "picocolors";
import { Account, RpcProvider, CallData } from "starknet";
import { getNetwork, type ChainId } from "../chains.js";

export interface BetOptions {
  marketId: string;
  side: "yes" | "no";
  amount: number; // STRK
  privateKey: string;
  address: string;
  network: string;
  chain: ChainId;
  apiUrl: string;
}

export async function runBet(opts: BetOptions): Promise<void> {
  const net = getNetwork(opts.chain, opts.network);

  console.log(pc.cyan(`Placing bet on market ${opts.marketId}...`));
  console.log(pc.dim(`  Side:   ${opts.side.toUpperCase()}`));
  console.log(pc.dim(`  Amount: ${opts.amount} STRK`));
  console.log();

  // Fetch market address from API
  try {
    const res = await fetch(`${opts.apiUrl}/api/markets/${opts.marketId}`);
    if (!res.ok) throw new Error(`Market not found (${res.status})`);
    const market = (await res.json()) as { address: string; question: string };

    console.log(pc.dim(`  Market: ${market.question?.slice(0, 60) || opts.marketId}`));
    console.log(pc.dim(`  Contract: ${market.address}`));

    const provider = new RpcProvider({ nodeUrl: net.rpcUrl });
    const account = new Account({
      provider,
      address: opts.address,
      signer: opts.privateKey,
    });

    const amountWei = BigInt(Math.floor(opts.amount * 1e18));
    const outcome = opts.side === "yes" ? 0 : 1;

    const calls = [
      {
        contractAddress: net.strkTokenAddress,
        entrypoint: "approve",
        calldata: CallData.compile({
          spender: market.address,
          amount: { low: amountWei, high: 0n },
        }),
      },
      {
        contractAddress: market.address,
        entrypoint: "bet",
        calldata: CallData.compile({
          outcome,
          amount: { low: amountWei, high: 0n },
        }),
      },
    ];

    const result = await account.execute(calls);
    console.log(pc.dim(`  tx: ${result.transaction_hash}`));
    await provider.waitForTransaction(result.transaction_hash);

    console.log();
    console.log(pc.green(pc.bold("Bet placed!")));
    console.log(`  Explorer: ${net.explorerUrl}/tx/${result.transaction_hash}`);
  } catch (err) {
    console.error(pc.red("Bet failed:"), (err as Error).message);
    process.exit(1);
  }
}
