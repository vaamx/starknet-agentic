/**
 * hicecaster deploy — Spawn a sovereign forecaster agent.
 *
 * 1. Generate ephemeral keypair
 * 2. Deploy AgentAccount via factory
 * 3. Mint ERC-8004 identity
 * 4. Write agent receipt + .env
 * 5. Print next steps (fund, start heartbeat)
 */

import fs from "node:fs";
import path from "node:path";
import prompts from "prompts";
import pc from "picocolors";
import { Account, CallData, RpcProvider, stark, ec, hash } from "starknet";
import { getNetwork, type ChainId } from "../chains.js";

export interface DeployOptions {
  name?: string;
  network: string;
  chain: ChainId;
  dryRun: boolean;
}

export async function runDeploy(opts: DeployOptions): Promise<void> {
  const net = getNetwork(opts.chain, opts.network);
  const onCancel = () => {
    console.log(pc.red("\nDeploy cancelled."));
    process.exit(0);
  };

  // Agent name
  let agentName = opts.name;
  if (!agentName) {
    const { name } = await prompts(
      {
        type: "text",
        name: "name",
        message: "Agent name:",
        initial: "my-forecaster",
        validate: (v: string) =>
          /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(v) ||
          "Use letters, numbers, - or _",
      },
      { onCancel }
    );
    agentName = name as string;
  }

  // Mainnet safety gate
  if (opts.network === "mainnet" && !opts.dryRun) {
    console.log(
      pc.yellow("\nWARNING: Deploying on MAINNET with real funds.")
    );
    const { confirmed } = await prompts(
      {
        type: "confirm",
        name: "confirmed",
        message: "Continue?",
        initial: false,
      },
      { onCancel }
    );
    if (!confirmed) process.exit(0);
  }

  // Parent wallet (pays gas)
  console.log();
  console.log(
    pc.dim("Your wallet pays the deploy gas. The agent gets its own keys.")
  );

  const { parentPrivateKey } = await prompts(
    {
      type: "password",
      name: "parentPrivateKey",
      message: "Wallet private key (0x...):",
      validate: (v: string) => v.startsWith("0x") || "Must start with 0x",
    },
    { onCancel }
  );

  const { parentAddress } = await prompts(
    {
      type: "text",
      name: "parentAddress",
      message: "Wallet address (0x...):",
      validate: (v: string) => v.startsWith("0x") || "Must start with 0x",
    },
    { onCancel }
  );

  // Generate agent keypair
  const agentPrivateKey = stark.randomAddress();
  const agentPublicKey = ec.starkCurve.getStarkKey(agentPrivateKey);

  console.log();
  console.log(pc.cyan("Deploying forecaster agent..."));
  console.log(pc.dim(`  Name:    ${agentName}`));
  console.log(pc.dim(`  Network: ${opts.network}`));
  console.log(pc.dim(`  Public:  ${agentPublicKey.slice(0, 16)}...`));

  if (opts.dryRun) {
    console.log();
    console.log(pc.yellow("[DRY RUN] Would deploy AgentAccount via factory"));
    console.log(pc.yellow(`[DRY RUN] Factory: ${net.factoryAddress}`));
    console.log(
      pc.yellow(
        `[DRY RUN] Would mint ERC-8004 identity at ${net.identityRegistryAddress}`
      )
    );
    console.log();
    console.log(pc.green("Dry run complete. No transactions sent."));
    return;
  }

  // Deploy
  const provider = new RpcProvider({ nodeUrl: net.rpcUrl });
  const parentAccount = new Account({
    provider,
    address: parentAddress as string,
    signer: parentPrivateKey as string,
  });

  const salt = stark.randomAddress();
  const constructorCalldata = CallData.compile({
    owner: parentAddress as string,
    public_key: agentPublicKey,
    identity_registry: net.identityRegistryAddress,
    agent_name: agentName!,
  });

  try {
    const { transaction_hash, contract_address } =
      await parentAccount.deployContract({
        classHash: net.factoryAddress,
        constructorCalldata,
        salt,
      });

    console.log(pc.dim(`  tx: ${transaction_hash}`));
    await provider.waitForTransaction(transaction_hash);

    const agentAddress =
      contract_address ||
      hash.calculateContractAddressFromHash(
        salt,
        net.factoryAddress,
        constructorCalldata,
        0
      );

    console.log();
    console.log(pc.green(pc.bold("Agent deployed!")));
    console.log();
    console.log(`  Address:  ${pc.cyan(agentAddress as string)}`);
    console.log(
      `  Explorer: ${net.explorerUrl}/contract/${agentAddress as string}`
    );

    // Write receipt
    const outDir = agentName!;
    fs.mkdirSync(outDir, { recursive: true });

    // .env (contains private key — warn user)
    const envContent = `# HICECASTER AGENT — ${agentName}
# Generated ${new Date().toISOString()}
# WARNING: This file contains your agent's private key. Keep it secure.

AGENT_NAME=${agentName}
AGENT_ADDRESS=${agentAddress as string}
AGENT_PRIVATE_KEY=${agentPrivateKey}
AGENT_PUBLIC_KEY=${agentPublicKey}

# Network
STARKNET_RPC_URL=${net.rpcUrl}
NETWORK=${opts.network}

# Heartbeat (configure your cron trigger URL)
HEARTBEAT_SECRET=${stark.randomAddress().slice(0, 18)}
`;

    fs.writeFileSync(path.join(outDir, ".env"), envContent);

    // Receipt (no secrets)
    const receipt = {
      agent: agentName,
      address: agentAddress,
      publicKey: agentPublicKey,
      network: opts.network,
      chain: opts.chain,
      deployTx: transaction_hash,
      deployedAt: new Date().toISOString(),
      factory: net.factoryAddress,
      identityRegistry: net.identityRegistryAddress,
    };

    fs.writeFileSync(
      path.join(outDir, "AGENT_RECEIPT.json"),
      JSON.stringify(receipt, null, 2)
    );

    console.log();
    console.log(pc.bold("Next steps:"));
    console.log(`  ${pc.cyan("1.")} Fund the agent:`);
    if (net.faucetUrl) {
      console.log(`     Faucet: ${net.faucetUrl}`);
    }
    console.log(`     Address: ${agentAddress as string}`);
    console.log(`  ${pc.cyan("2.")} Start the heartbeat:`);
    console.log(`     cd ${agentName} && cat .env`);
    console.log(`  ${pc.cyan("3.")} Check status:`);
    console.log(`     npx hicecaster status`);
  } catch (err) {
    console.error(pc.red("\nDeploy failed:"), (err as Error).message);
    process.exit(1);
  }
}
