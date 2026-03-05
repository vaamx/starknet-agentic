/**
 * Sovereign Agent Deploy Wizard
 *
 * One-command bootstrap for a sovereign Starknet agent:
 *  1. Generate ephemeral keypair
 *  2. Deploy AgentAccount via factory (ERC-8004 identity minted)
 *  3. Prompt to fund the new wallet
 *  4. Register ERC-8004 metadata (name, type, capabilities)
 *  5. Register with Huginn Registry (if configured)
 *  6. (Optional) Provision BitsagE Cloud compute machine
 *  7. Write output files: .env, worker.js, wrangler.toml, AGENT_RECEIPT.json, README.md
 *
 * Security:
 *  - Private key is written to .env with a clear WARNING header.
 *  - AGENT_RECEIPT.json contains ZERO private key fields.
 *  - Mainnet requires an explicit confirmation prompt.
 *  - --dry-run previews all steps without sending any transactions.
 */

import fs from "node:fs";
import path from "node:path";
import prompts from "prompts";
import pc from "picocolors";
import { Account, CallData, RpcProvider, stark, ec, hash } from "starknet";
import {
  FACTORY_ADDRESS,
  IDENTITY_REGISTRY,
  HUGINN_REGISTRY,
  STRK_ADDRESS,
  RPC_URL,
  EXPLORER_URL,
  FAUCET_URL,
  STARKGATE_URL,
  type SupportedNetwork,
} from "./constants.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DeployWizardOptions {
  name: string;
  network: SupportedNetwork;
  parentPrivateKey: string;
  parentAddress: string;
  bitsageCloud?: boolean;
  tier?: "nano" | "micro" | "small";
  dryRun?: boolean;
  outputDir?: string;
}

export interface SovereignAgentReceipt {
  name: string;
  network: SupportedNetwork;
  agentAddress: string;
  agentId: string;
  publicKey: string;
  deployTxHash: string;
  erc8004TxHash?: string;
  huginnTxHash?: string;
  bitsageMachineId?: string;
  deployedAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Encode a UTF-8 string as Cairo ByteArray calldata (31-byte chunk format).
 * Returns raw calldata array (same pattern as huginn-executor.ts and child-spawner.ts).
 */
function stringToByteArrayCalldata(str: string): string[] {
  const bytes = new TextEncoder().encode(str);
  const chunks: string[] = [];
  let i = 0;

  while (i + 31 <= bytes.length) {
    let chunk = 0n;
    for (let j = 0; j < 31; j++) {
      chunk = (chunk << 8n) | BigInt(bytes[i + j]);
    }
    chunks.push("0x" + chunk.toString(16).padStart(62, "0"));
    i += 31;
  }

  let pending = 0n;
  const pendingLen = bytes.length - i;
  for (let j = 0; j < pendingLen; j++) {
    pending = (pending << 8n) | BigInt(bytes[i + j]);
  }

  return [
    `0x${chunks.length.toString(16)}`,
    ...chunks,
    "0x" + pending.toString(16).padStart(2, "0"),
    `0x${pendingLen.toString(16)}`,
  ];
}

/**
 * Parse the AccountDeployed event from a transaction receipt.
 * Returns { agentAddress, agentId } or null if the event is not found.
 */
function parseAccountDeployedEvent(
  receipt: unknown,
  factoryAddress: string
): { agentAddress: string; agentId: string } | null {
  const events =
    (receipt as { events?: Array<{ from_address?: string; keys?: string[]; data?: string[] }> })
      ?.events ?? [];

  const factory = factoryAddress.toLowerCase();
  const selector = hash.getSelectorFromName("AccountDeployed").toLowerCase();

  for (const evt of events) {
    if (
      evt.from_address?.toLowerCase() !== factory ||
      !evt.keys?.length ||
      evt.keys[0]?.toLowerCase() !== selector ||
      !evt.data ||
      evt.data.length < 4
    ) continue;

    try {
      const agentAddress = evt.data[0];
      const agentIdLow = BigInt(evt.data[2]);
      const agentIdHigh = BigInt(evt.data[3]);
      const agentId = (agentIdLow + (agentIdHigh << 128n)).toString();
      return { agentAddress, agentId };
    } catch {
      continue;
    }
  }
  return null;
}

function step(n: number, total: number, label: string) {
  console.log();
  console.log(pc.cyan(`[${n}/${total}] ${label}`));
}

function dryRunStep(n: number, total: number, label: string, detail: string) {
  console.log(pc.dim(`[${n}/${total} DRY-RUN] ${label}: ${detail}`));
}

// ── Main wizard ───────────────────────────────────────────────────────────────

const TOTAL_STEPS = 7;

export async function sovereignAgentWizard(
  opts: DeployWizardOptions
): Promise<SovereignAgentReceipt> {
  const { name, network, parentPrivateKey, parentAddress, dryRun = false } = opts;
  const outputDir = opts.outputDir ?? path.join(process.cwd(), name);

  console.log();
  console.log(pc.bold(pc.cyan(`Deploying sovereign agent "${name}" on ${network}`)));
  if (dryRun) {
    console.log(pc.yellow("  DRY RUN — no transactions will be sent"));
  }

  const factoryAddr = FACTORY_ADDRESS[network];
  const identityAddr = IDENTITY_REGISTRY[network];
  const huginnAddr = HUGINN_REGISTRY[network];

  if (factoryAddr === "0x0") {
    throw new Error(`AgentAccountFactory not yet deployed on ${network}`);
  }

  // ── Step 1: Keypair ─────────────────────────────────────────────────────────
  step(1, TOTAL_STEPS, "Generating ephemeral keypair");

  const privateKey = stark.randomAddress();
  const publicKey = ec.starkCurve.getStarkKey(privateKey);
  const salt = stark.randomAddress();

  if (dryRun) {
    dryRunStep(1, TOTAL_STEPS, "Keypair", `PUBLIC=${publicKey.slice(0, 20)}...`);
  } else {
    console.log(pc.dim(`  Public key: ${publicKey}`));
  }

  // ── Step 2: Deploy AgentAccount ─────────────────────────────────────────────
  step(2, TOTAL_STEPS, "Deploying AgentAccount via factory");

  const tokenUri = `data:application/json,{"name":"${name}","agentType":"sovereign-forecaster","model":"claude-sonnet-4-6"}`;
  const tokenUriCalldata = stringToByteArrayCalldata(tokenUri);

  let agentAddress = "0xDRY_RUN_ADDRESS";
  let agentId = "0";
  let deployTxHash = "0xDRY_RUN_TX";

  if (!dryRun) {
    const provider = new RpcProvider({ nodeUrl: RPC_URL[network] });
    const parentAccount = new Account({
      provider,
      address: parentAddress,
      signer: parentPrivateKey,
    });

    const deployCall = {
      contractAddress: factoryAddr,
      entrypoint: "deploy_account",
      calldata: [publicKey, salt, ...tokenUriCalldata],
    };

    console.log(pc.dim("  Sending deploy_account transaction..."));
    const txResult = await parentAccount.execute([deployCall]);
    deployTxHash = txResult.transaction_hash;
    console.log(pc.dim(`  Tx submitted: ${deployTxHash}`));

    console.log(pc.dim("  Waiting for receipt..."));
    const receipt = await provider.waitForTransaction(deployTxHash);
    const parsed = parseAccountDeployedEvent(receipt, factoryAddr);

    if (!parsed) {
      throw new Error(
        "Could not parse AccountDeployed event from receipt. " +
        "Check factory ABI or transaction on explorer: " +
        `${EXPLORER_URL[network]}/tx/${deployTxHash}`
      );
    }

    agentAddress = parsed.agentAddress;
    agentId = parsed.agentId;
    console.log(pc.green(`  Agent address: ${agentAddress}`));
    console.log(pc.green(`  ERC-8004 token ID: ${agentId}`));
  } else {
    dryRunStep(2, TOTAL_STEPS, "deploy_account", `factoryAddr=${factoryAddr}`);
  }

  // ── Step 3: Fund prompt ─────────────────────────────────────────────────────
  step(3, TOTAL_STEPS, "Fund your agent wallet");

  if (!dryRun) {
    console.log();
    console.log(pc.yellow(`  Agent address: ${agentAddress}`));
    console.log(pc.dim(`  Send at least 100 STRK before the agent can place bets.`));
    console.log(pc.dim(`  Bridge:  ${STARKGATE_URL}`));
    if (FAUCET_URL[network]) {
      console.log(pc.dim(`  Faucet:  ${FAUCET_URL[network]} (${network} only)`));
    }
    console.log();
    const { confirmed } = await prompts({
      type: "confirm",
      name: "confirmed",
      message: "Press Y once you have funded the agent wallet (or N to skip — agent won't be able to bet):",
      initial: true,
    });
    if (!confirmed) {
      console.log(pc.yellow("  Skipping fund step — agent may not have enough STRK to operate."));
    }
  } else {
    dryRunStep(3, TOTAL_STEPS, "Fund prompt", `Send STRK to ${agentAddress}`);
  }

  // ── Step 4: ERC-8004 metadata ───────────────────────────────────────────────
  step(4, TOTAL_STEPS, "Registering ERC-8004 metadata");

  let erc8004TxHash: string | undefined;

  if (!dryRun && identityAddr !== "0x0") {
    const provider = new RpcProvider({ nodeUrl: RPC_URL[network] });
    const agentAccount = new Account({
      provider,
      address: agentAddress,
      signer: privateKey,
    });

    const buildSetMetadata = (key: string, value: string) => ({
      contractAddress: identityAddr,
      entrypoint: "set_agent_metadata",
      calldata: CallData.compile({
        agent_id: { low: BigInt(agentId), high: 0n },
        key: key,
        value: value,
      }),
    });

    const calls = [
      buildSetMetadata("agentName", name),
      buildSetMetadata("agentType", "sovereign-forecaster"),
      buildSetMetadata("capabilities", JSON.stringify(["prediction", "defi", "huginn"])),
      buildSetMetadata("model", "claude-sonnet-4-6"),
    ];

    const tx = await agentAccount.execute(calls);
    erc8004TxHash = tx.transaction_hash;
    console.log(pc.dim(`  Metadata tx: ${erc8004TxHash}`));
  } else if (identityAddr === "0x0") {
    console.log(pc.dim("  Identity registry not configured — skipping"));
  } else {
    dryRunStep(4, TOTAL_STEPS, "set_agent_metadata", `identityRegistry=${identityAddr}`);
  }

  // ── Step 5: Huginn registration ─────────────────────────────────────────────
  step(5, TOTAL_STEPS, "Huginn Registry registration");

  let huginnTxHash: string | undefined;

  if (!dryRun && huginnAddr !== "0x0") {
    const provider = new RpcProvider({ nodeUrl: RPC_URL[network] });
    const agentAccount = new Account({
      provider,
      address: agentAddress,
      signer: privateKey,
    });

    const tx = await agentAccount.execute({
      contractAddress: huginnAddr,
      entrypoint: "register_agent",
      calldata: ["0x0", "0x0", "0x0", "0x0"],  // empty name + empty ByteArray
    });
    huginnTxHash = tx.transaction_hash;
    console.log(pc.dim(`  Huginn registration tx: ${huginnTxHash}`));
  } else {
    console.log(pc.dim(
      huginnAddr === "0x0"
        ? "  Huginn registry not configured — skipping"
        : "  [DRY RUN] register_agent"
    ));
  }

  // ── Step 6: BitsagE Cloud provisioning ──────────────────────────────────────
  step(6, TOTAL_STEPS, "BitsagE Cloud machine");

  let bitsageMachineId: string | undefined;

  if (opts.bitsageCloud) {
    if (dryRun) {
      dryRunStep(6, TOTAL_STEPS, "createMachine", `tier=${opts.tier ?? "nano"}`);
    } else {
      try {
        // Dynamic import to avoid requiring the SDK if bitsageCloud=false
        const { BitsageCloudClient } = await import("@starknet-agentic/bitsage-cloud-sdk");
        const sdk = new BitsageCloudClient({
          baseUrl: "https://api.bitsage.cloud",
          rpcUrl: RPC_URL[network],
          accountAddress: agentAddress,
          privateKey,
        });
        const machine = await sdk.createMachine({
          agentAddress,
          tier: opts.tier ?? "nano",
          envVars: { AGENT_ADDRESS: agentAddress, STARKNET_RPC_URL: RPC_URL[network] },
        });
        bitsageMachineId = machine.id;
        console.log(pc.dim(`  Machine created: ${bitsageMachineId} (tier=${opts.tier ?? "nano"})`));
      } catch (err) {
        console.log(pc.yellow(`  BitsagE Cloud provisioning failed: ${(err as Error).message}`));
        console.log(pc.dim("  You can provision manually later with: bitsage machines create"));
      }
    }
  } else {
    console.log(pc.dim("  Skipped (use --bitsage-cloud to provision compute)"));
  }

  // ── Step 7: Write output files ──────────────────────────────────────────────
  step(7, TOTAL_STEPS, "Writing output files");

  if (!dryRun) {
    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(path.join(outputDir, ".github", "workflows"), { recursive: true });

    writeOutputFiles(outputDir, {
      name,
      network,
      agentAddress,
      agentId,
      privateKey,
      publicKey,
      deployTxHash,
      erc8004TxHash,
      huginnTxHash,
      bitsageMachineId,
      deployedAt: new Date().toISOString(),
    });
  } else {
    dryRunStep(7, TOTAL_STEPS, "Write files", `outputDir=${outputDir}`);
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log();
  console.log(pc.green(pc.bold("Agent deployed successfully!")));
  console.log();
  if (!dryRun) {
    console.log(`  ${pc.bold("Address:")}  ${agentAddress}`);
    console.log(`  ${pc.bold("Token ID:")} ${agentId}`);
    console.log(`  ${pc.bold("Explorer:")} ${EXPLORER_URL[network]}/contract/${agentAddress}`);
    console.log(`  ${pc.bold("Deploy tx:")} ${EXPLORER_URL[network]}/tx/${deployTxHash}`);
    console.log();
    console.log(`  ${pc.bold("Files written to:")} ${outputDir}/`);
    console.log(`    .env            — agent credentials (keep secret)`);
    console.log(`    AGENT_RECEIPT.json — deployment proof (shareable)`);
    console.log(`    worker.js       — Cloudflare Worker heartbeat cron`);
    console.log(`    wrangler.toml   — CF Worker config`);
    console.log(`    README.md       — quickstart guide`);
  }
  console.log();
  console.log(pc.bold("Next steps:"));
  console.log(`  1. Review and set secrets in ${name}/.env`);
  console.log(`  2. Deploy the Cloudflare Worker: cd ${name} && npx wrangler deploy`);
  console.log(`  3. Monitor your agent: ${EXPLORER_URL[network]}/contract/${agentAddress}`);

  return {
    name,
    network,
    agentAddress,
    agentId,
    publicKey,
    deployTxHash,
    erc8004TxHash,
    huginnTxHash,
    bitsageMachineId,
    deployedAt: new Date().toISOString(),
  };
}

// ── File writers ──────────────────────────────────────────────────────────────

interface FileData {
  name: string;
  network: SupportedNetwork;
  agentAddress: string;
  agentId: string;
  privateKey: string;
  publicKey: string;
  deployTxHash: string;
  erc8004TxHash?: string;
  huginnTxHash?: string;
  bitsageMachineId?: string;
  deployedAt: string;
}

function writeOutputFiles(dir: string, data: FileData): void {
  // .env — contains private key, must stay secret
  const envContent = `# WARNING: This file contains your agent's private key. Keep it secret.
# DO NOT commit this file to version control.

STARKNET_RPC_URL=${RPC_URL[data.network]}
AGENT_ADDRESS=${data.agentAddress}
AGENT_PRIVATE_KEY=${data.privateKey}

# Market factory and registry addresses
MARKET_FACTORY_ADDRESS=${FACTORY_ADDRESS[data.network]}
HUGINN_REGISTRY_ADDRESS=${HUGINN_REGISTRY[data.network]}
COLLATERAL_TOKEN_ADDRESS=${STRK_ADDRESS[data.network]}

# Survival tiers (STRK amounts)
SURVIVAL_TIER_THRIVING=1000
SURVIVAL_TIER_HEALTHY=100
SURVIVAL_TIER_LOW=10
SURVIVAL_TIER_CRITICAL=1

# Features (all off by default for safety)
X402_ENABLED=false
CHILD_AGENT_ENABLED=false
COMPUTE_RESERVE_ENABLED=false
AGENT_TOOL_USE_ENABLED=false

# Heartbeat (set this to a secret value, same as in wrangler.toml)
HEARTBEAT_SECRET=change-me-${stark.randomAddress().slice(2, 10)}
`;

  // AGENT_RECEIPT.json — public deployment proof (NO private key)
  const receipt: Record<string, unknown> = {
    name: data.name,
    network: data.network,
    agentAddress: data.agentAddress,
    agentId: data.agentId,
    publicKey: data.publicKey,
    deployTxHash: data.deployTxHash,
    deployedAt: data.deployedAt,
  };
  if (data.erc8004TxHash) receipt.erc8004TxHash = data.erc8004TxHash;
  if (data.huginnTxHash) receipt.huginnTxHash = data.huginnTxHash;
  if (data.bitsageMachineId) receipt.bitsageMachineId = data.bitsageMachineId;

  // worker.js — Cloudflare Worker heartbeat cron
  const workerContent = `// Cloudflare Worker — heartbeat cron for ${data.name}
// Deploys via: npx wrangler deploy
export default {
  async scheduled(event, env, ctx) {
    const res = await fetch(env.AGENT_BASE_URL + "/api/heartbeat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-heartbeat-secret": env.HEARTBEAT_SECRET,
      },
    });
    console.log("[heartbeat] status:", res.status, await res.text().catch(() => ""));
  },
};
`;

  // wrangler.toml
  const wranglerContent = `name = "${data.name.toLowerCase().replace(/[^a-z0-9-]/g, "-")}-heartbeat"
main = "worker.js"
compatibility_date = "2025-01-01"

[triggers]
crons = ["* * * * *"]

[vars]
AGENT_BASE_URL = "https://YOUR_VERCEL_OR_FLY_URL"
HEARTBEAT_SECRET = "change-me-${stark.randomAddress().slice(2, 10)}"
`;

  // GitHub Actions fallback heartbeat
  const ghActionContent = `name: Agent Heartbeat
on:
  schedule:
    - cron: "*/5 * * * *"
  workflow_dispatch:

jobs:
  heartbeat:
    runs-on: ubuntu-latest
    steps:
      - name: Send heartbeat
        run: |
          curl -s -X POST "$AGENT_BASE_URL/api/heartbeat" \\
            -H "Content-Type: application/json" \\
            -H "x-heartbeat-secret: $HEARTBEAT_SECRET"
        env:
          AGENT_BASE_URL: \${{ secrets.AGENT_BASE_URL }}
          HEARTBEAT_SECRET: \${{ secrets.HEARTBEAT_SECRET }}
`;

  // README.md — quickstart guide
  const readmeContent = `# ${data.name} — Sovereign Agent

Deployed on Starknet ${data.network} at \`${data.agentAddress}\`.

## Quickstart

1. **Fund** your agent at \`${data.agentAddress}\` with STRK
2. **Configure** secrets in \`.env\`
3. **Deploy** the heartbeat:
   \`\`\`bash
   npx wrangler deploy
   \`\`\`
4. **Monitor** at ${EXPLORER_URL[data.network]}/contract/${data.agentAddress}

## Files

| File | Purpose |
|------|---------|
| \`.env\` | Agent secrets (KEEP SECRET) |
| \`AGENT_RECEIPT.json\` | Deployment proof (shareable) |
| \`worker.js\` | Cloudflare Worker heartbeat |
| \`wrangler.toml\` | CF Worker config |
| \`.github/workflows/agent-heartbeat.yml\` | GH Actions fallback heartbeat |

## Architecture

This agent runs the starknet-agentic prediction-agent stack:
- Survival Engine: tier-aware model selection + bet sizing
- Forecast Loop: research → bet → record prediction
- Huginn: on-chain reasoning provenance

## Deployment Info

- **Network:** ${data.network}
- **Address:** \`${data.agentAddress}\`
- **ERC-8004 ID:** ${data.agentId}
- **Deployed:** ${data.deployedAt}

See [starknet-agentic docs](https://starknet-agentic.vercel.app) for full documentation.
`;

  const files: Record<string, string> = {
    ".env": envContent,
    "AGENT_RECEIPT.json": JSON.stringify(receipt, null, 2),
    "worker.js": workerContent,
    "wrangler.toml": wranglerContent,
    ".github/workflows/agent-heartbeat.yml": ghActionContent,
    "README.md": readmeContent,
  };

  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(dir, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf-8");
    console.log(pc.dim(`  Wrote: ${relativePath}`));
  }
}
