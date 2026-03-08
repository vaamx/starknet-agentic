/**
 * hicecaster fund — Transfer STRK to your agent.
 */

import pc from "picocolors";
import { Account, RpcProvider, CallData } from "starknet";
import { getNetwork, type ChainId } from "../chains.js";
import { createSpinner } from "../spinner.js";

export interface FundOptions {
  to: string;
  amount: number;
  privateKey: string;
  address: string;
  network: string;
  chain: ChainId;
}

export async function runFund(opts: FundOptions): Promise<void> {
  const net = getNetwork(opts.chain, opts.network);

  console.log(pc.cyan("Funding agent..."));
  console.log(pc.dim(`  From:   ${opts.address.slice(0, 12)}...`));
  console.log(pc.dim(`  To:     ${opts.to.slice(0, 12)}...`));
  console.log(pc.dim(`  Amount: ${opts.amount} STRK`));
  console.log();

  const provider = new RpcProvider({ nodeUrl: net.rpcUrl });
  const account = new Account({
    provider,
    address: opts.address,
    signer: opts.privateKey,
  });

  const amountWei = BigInt(Math.floor(opts.amount * 1e18));

  const spinner = createSpinner("Sending transaction");
  spinner.start();

  try {
    const result = await account.execute([
      {
        contractAddress: net.strkTokenAddress,
        entrypoint: "transfer",
        calldata: CallData.compile({
          recipient: opts.to,
          amount: { low: amountWei, high: 0n },
        }),
      },
    ]);

    spinner.stop(pc.dim(`tx: ${result.transaction_hash}`));
    await provider.waitForTransaction(result.transaction_hash);

    console.log();
    console.log(pc.green(pc.bold("Funded!")));
    console.log(`  ${opts.amount} STRK sent to ${opts.to.slice(0, 16)}...`);
    console.log(`  Explorer: ${net.explorerUrl}/tx/${result.transaction_hash}`);
  } catch (err) {
    spinner.stop(pc.red("Failed"));
    console.error(pc.red("Fund failed:"), (err as Error).message);
    process.exit(1);
  }
}
