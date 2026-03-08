/**
 * hicecaster mint — Launch an agent token on a bonding curve.
 */

import pc from "picocolors";
import { Account, RpcProvider, CallData, shortString } from "starknet";
import { getNetwork, type ChainId } from "../chains.js";

export interface MintOptions {
  name: string;
  symbol: string;
  curve: "linear" | "quadratic" | "sigmoid";
  feeBps: number;
  agentId: number;
  privateKey: string;
  address: string;
  network: string;
  chain: ChainId;
}

const CURVE_MAP = { linear: 0, quadratic: 1, sigmoid: 2 } as const;

// StarkMint Factory on Sepolia
const FACTORY: Record<string, string> = {
  sepolia: "0xd26cc09636f19496e1f605bebc66e1d5060077b9306c4306fb993439968ac9",
};

export async function runMint(opts: MintOptions): Promise<void> {
  const net = getNetwork(opts.chain, opts.network);
  const factory = FACTORY[opts.network];

  if (!factory) {
    console.log(pc.red(`StarkMint not deployed on ${opts.network}`));
    process.exit(1);
  }

  console.log(pc.cyan(`Launching token...`));
  console.log(pc.dim(`  Name:    ${opts.name}`));
  console.log(pc.dim(`  Symbol:  $${opts.symbol}`));
  console.log(pc.dim(`  Curve:   ${opts.curve}`));
  console.log(pc.dim(`  Fee:     ${opts.feeBps / 100}%`));
  console.log();

  const provider = new RpcProvider({ nodeUrl: net.rpcUrl });
  const account = new Account({
    provider,
    address: opts.address,
    signer: opts.privateKey,
  });

  try {
    const result = await account.execute([
      {
        contractAddress: factory,
        entrypoint: "launch_token",
        calldata: CallData.compile({
          name: shortString.encodeShortString(opts.name.slice(0, 31)),
          symbol: shortString.encodeShortString(opts.symbol.slice(0, 31)),
          curve_type: CURVE_MAP[opts.curve],
          fee_bps: opts.feeBps,
          agent_id: { low: BigInt(opts.agentId), high: 0n },
        }),
      },
    ]);

    console.log(pc.dim(`  tx: ${result.transaction_hash}`));
    await provider.waitForTransaction(result.transaction_hash);

    console.log();
    console.log(pc.green(pc.bold("Token launched!")));
    console.log(`  Explorer: ${net.explorerUrl}/tx/${result.transaction_hash}`);
  } catch (err) {
    console.error(pc.red("Mint failed:"), (err as Error).message);
    process.exit(1);
  }
}
