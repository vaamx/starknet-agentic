/**
 * hicecaster whoami — Show agent identity, reputation, and track record.
 */

import pc from "picocolors";
import { RpcProvider, Contract } from "starknet";
import { getNetwork, type ChainId } from "../chains.js";
import { createSpinner } from "../spinner.js";

export interface WhoamiOptions {
  address: string;
  network: string;
  chain: ChainId;
}

const IDENTITY_ABI = [
  {
    type: "interface",
    name: "IIdentityRegistry",
    items: [
      {
        type: "function",
        name: "get_metadata",
        inputs: [
          { name: "token_id", type: "core::integer::u256" },
          { name: "key", type: "core::byte_array::ByteArray" },
        ],
        outputs: [{ type: "core::byte_array::ByteArray" }],
        state_mutability: "view",
      },
      {
        type: "function",
        name: "get_token_id_by_address",
        inputs: [
          {
            name: "address",
            type: "core::starknet::contract_address::ContractAddress",
          },
        ],
        outputs: [{ type: "core::integer::u256" }],
        state_mutability: "view",
      },
    ],
  },
];

export async function runWhoami(opts: WhoamiOptions): Promise<void> {
  const net = getNetwork(opts.chain, opts.network);
  const provider = new RpcProvider({ nodeUrl: net.rpcUrl });

  const spinner = createSpinner(`Looking up ${opts.address.slice(0, 12)}`);
  spinner.start();

  if (
    !net.identityRegistryAddress ||
    net.identityRegistryAddress === "0x0"
  ) {
    spinner.stop(pc.yellow("Identity registry not deployed on this network."));
    console.log(pc.dim(`Address: ${opts.address}`));
    return;
  }

  try {
    const identity = new Contract({
      abi: IDENTITY_ABI,
      address: net.identityRegistryAddress,
      providerOrAccount: provider,
    });

    const tokenId = await identity.get_token_id_by_address(opts.address);
    const tokenIdNum = Number(BigInt(tokenId));

    if (tokenIdNum === 0) {
      spinner.stop(pc.yellow("No identity found for this address."));
      console.log(pc.dim("Deploy an agent to create one: hicecaster deploy"));
      return;
    }

    spinner.stop("");

    // Fetch metadata
    const fields = ["agentName", "agentType", "version", "model", "status"];
    const values: Record<string, string> = {};

    for (const key of fields) {
      try {
        const val = await identity.get_metadata(tokenIdNum, key);
        values[key] = String(val) || pc.dim("(not set)");
      } catch {
        values[key] = pc.dim("(not set)");
      }
    }

    console.log(pc.bold("Agent Identity"));
    console.log(`  Token ID: ${pc.cyan(tokenIdNum.toString())}`);
    console.log(`  Name:     ${values.agentName}`);
    console.log(`  Type:     ${values.agentType}`);
    console.log(`  Version:  ${values.version}`);
    console.log(`  Model:    ${values.model}`);
    console.log(`  Status:   ${values.status}`);
    console.log();
    console.log(pc.dim(`  Address:  ${opts.address}`));
    console.log(
      pc.dim(`  Registry: ${net.identityRegistryAddress}`)
    );
    console.log(
      pc.dim(`  Explorer: ${net.explorerUrl}/contract/${opts.address}`)
    );
  } catch (err) {
    spinner.stop(pc.red("Failed"));
    console.error(
      pc.red("Failed to fetch identity:"),
      (err as Error).message
    );
    process.exit(1);
  }
}
