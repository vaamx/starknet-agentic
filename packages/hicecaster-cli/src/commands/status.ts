/**
 * hicecaster status — Check your agent's vital signs.
 *
 * Reads balance, computes survival tier, shows reputation.
 */

import pc from "picocolors";
import { RpcProvider, Contract, CallData } from "starknet";
import { getNetwork, type ChainId } from "../chains.js";
import { createSpinner } from "../spinner.js";

interface StatusOptions {
  address: string;
  network: string;
  chain: ChainId;
}

const TIERS = [
  { name: "DEAD", threshold: 0, color: pc.red },
  { name: "CRITICAL", threshold: 0.5, color: pc.red },
  { name: "LOW", threshold: 2, color: pc.yellow },
  { name: "HEALTHY", threshold: 10, color: pc.green },
  { name: "THRIVING", threshold: 50, color: pc.cyan },
];

const ERC20_ABI = [
  {
    type: "interface",
    name: "IERC20",
    items: [
      {
        type: "function",
        name: "balance_of",
        inputs: [
          {
            name: "account",
            type: "core::starknet::contract_address::ContractAddress",
          },
        ],
        outputs: [{ type: "core::integer::u256" }],
        state_mutability: "view",
      },
    ],
  },
];

function getTier(balanceStrk: number): (typeof TIERS)[number] {
  let tier = TIERS[0];
  for (const t of TIERS) {
    if (balanceStrk >= t.threshold) tier = t;
  }
  return tier;
}

export async function runStatus(opts: StatusOptions): Promise<void> {
  const net = getNetwork(opts.chain, opts.network);
  const provider = new RpcProvider({ nodeUrl: net.rpcUrl });

  console.log(pc.dim(`Agent: ${opts.address}`));
  console.log(pc.dim(`Network: ${opts.network}`));
  console.log();

  const spinner = createSpinner("Reading on-chain state");
  spinner.start();

  try {
    // Balance
    const tokenContract = new Contract({
      abi: ERC20_ABI,
      address: net.strkTokenAddress,
      providerOrAccount: provider,
    });

    const raw = await tokenContract.balance_of(opts.address);
    const balance = Number(BigInt(raw)) / 1e18;
    const tier = getTier(balance);
    spinner.stop("");

    console.log(
      `  Survival: ${tier.color(pc.bold(tier.name))}  (${balance.toFixed(2)} STRK)`
    );

    // Visual bar
    const maxBar = 30;
    const fill = Math.min(maxBar, Math.floor((balance / 100) * maxBar));
    const bar = tier.color("█".repeat(fill)) + pc.dim("░".repeat(maxBar - fill));
    console.log(`  Balance:  [${bar}]`);

    // Multiplier
    const multiplier =
      tier.name === "THRIVING"
        ? 1.5
        : tier.name === "HEALTHY"
          ? 1.0
          : tier.name === "LOW"
            ? 0.5
            : tier.name === "CRITICAL"
              ? 0.25
              : 0;
    console.log(`  Bet mult: ${multiplier}x`);

    // Explorer link
    console.log();
    console.log(
      pc.dim(`  Explorer: ${net.explorerUrl}/contract/${opts.address}`)
    );
  } catch (err) {
    spinner.stop(pc.red("Failed"));
    console.error(pc.red("Failed to fetch status:"), (err as Error).message);
    process.exit(1);
  }
}
