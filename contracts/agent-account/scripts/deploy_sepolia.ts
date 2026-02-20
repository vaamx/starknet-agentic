/**
 * Deploy AgentAccount + AgentAccountFactory to Sepolia
 * Then mint an ERC-8004 identity NFT via the factory.
 *
 * Usage:
 *   npx tsx contracts/agent-account/scripts/deploy_sepolia.ts
 *
 * Env vars:
 *   STARKNET_RPC_URL, DEPLOYER_ADDRESS, DEPLOYER_PRIVATE_KEY, PUBLIC_KEY
 */

import {
  RpcProvider,
  Account,
  json,
  hash,
  CallData,
} from "starknet";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Config ──────────────────────────────────────────────────────────
const RPC_URL =
  process.env.STARKNET_RPC_URL ?? "https://rpc.starknet-testnet.lava.build";
const DEPLOYER_ADDRESS = process.env.DEPLOYER_ADDRESS ?? "";
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY ?? "";
const PUBLIC_KEY = process.env.PUBLIC_KEY ?? "";

// ERC-8004 IdentityRegistry (default: Sepolia). Override via env for mainnet.
const IDENTITY_REGISTRY =
  process.env.IDENTITY_REGISTRY_ADDRESS ??
  "0x72eb37b0389e570bf8b158ce7f0e1e3489de85ba43ab3876a0594df7231631";

// ── Helpers ──────────────────────────────────────────────────────────
function loadArtifact(contractName: string) {
  const basePath = path.join(__dirname, "..", "target", "dev");
  const sierraPath = path.join(
    basePath,
    `agent_account_${contractName}.contract_class.json`
  );
  const casmPath = path.join(
    basePath,
    `agent_account_${contractName}.compiled_contract_class.json`
  );

  if (!fs.existsSync(sierraPath)) {
    console.error(`Missing Sierra artifact: ${sierraPath}`);
    process.exit(1);
  }
  if (!fs.existsSync(casmPath)) {
    console.error(`Missing CASM artifact: ${casmPath}`);
    process.exit(1);
  }

  const sierra = json.parse(fs.readFileSync(sierraPath).toString("ascii"));
  const casm = json.parse(fs.readFileSync(casmPath).toString("ascii"));
  return { sierra, casm };
}

async function declareContract(
  account: Account,
  provider: RpcProvider,
  name: string,
  sierra: any,
  casm: any
): Promise<string> {
  console.log(`\n[DECLARE] ${name}...`);
  const classHash = hash.computeContractClassHash(sierra);
  console.log(`  Class hash: ${classHash}`);

  // Check if already declared
  try {
    await provider.getClass(classHash);
    console.log(`  Already declared.`);
    return classHash;
  } catch {
    // Not declared yet, continue
  }

  const localCompiledHash = hash.computeCompiledClassHash(casm);
  console.log(`  Compiled hash (local): ${localCompiledHash}`);

  try {
    const resp = await account.declare({ contract: sierra, casm });
    console.log(`  Tx: ${resp.transaction_hash}`);
    await provider.waitForTransaction(resp.transaction_hash);
    console.log(`  Declared!`);
    return resp.class_hash;
  } catch (err: any) {
    if (
      err.message?.includes("already declared") ||
      err.message?.includes("CLASS_ALREADY_DECLARED")
    ) {
      console.log(`  Already declared (caught from tx).`);
      return classHash;
    }

    // Handle compiled_class_hash mismatch (different compiler versions)
    const mismatchMatch = err.message?.match(/Expected:\s*(0x[0-9a-fA-F]+)/);
    if (mismatchMatch) {
      const expectedHash = mismatchMatch[1];
      console.log(
        `  Compiled hash mismatch, retrying with network-expected: ${expectedHash}`
      );
      const resp = await account.declare({
        contract: sierra,
        casm,
        compiledClassHash: expectedHash,
      });
      console.log(`  Tx: ${resp.transaction_hash}`);
      await provider.waitForTransaction(resp.transaction_hash);
      console.log(`  Declared!`);
      return resp.class_hash;
    }

    throw err;
  }
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  console.log("========================================================");
  console.log("  DEPLOYING AGENT ACCOUNT CONTRACTS TO SEPOLIA");
  console.log("========================================================");

  if (!DEPLOYER_ADDRESS || !DEPLOYER_KEY || !PUBLIC_KEY) {
    console.error("Missing DEPLOYER_ADDRESS, DEPLOYER_PRIVATE_KEY, or PUBLIC_KEY.");
    process.exit(1);
  }

  const provider = new RpcProvider({ nodeUrl: RPC_URL });
  const chainId = await provider.getChainId();
  console.log(`\nChain:    ${chainId}`);
  console.log(`RPC:      ${RPC_URL}`);
  console.log(`Deployer: ${DEPLOYER_ADDRESS}`);
  console.log(`Identity: ${IDENTITY_REGISTRY}`);

  // starknet.js v8 Account constructor
  const account = new Account({ provider, address: DEPLOYER_ADDRESS, signer: DEPLOYER_KEY });

  // ── Step 1: Declare AgentAccount + AgentAccountFactory ──
  const agentAcct = loadArtifact("AgentAccount");
  const agentFactory = loadArtifact("AgentAccountFactory");

  const accountClassHash = await declareContract(
    account,
    provider,
    "AgentAccount",
    agentAcct.sierra,
    agentAcct.casm
  );
  const factoryClassHash = await declareContract(
    account,
    provider,
    "AgentAccountFactory",
    agentFactory.sierra,
    agentFactory.casm
  );

  // ── Step 2: Deploy AgentAccountFactory ──
  console.log("\n[DEPLOY] AgentAccountFactory...");
  console.log(`  account_class_hash: ${accountClassHash}`);
  console.log(`  identity_registry:  ${IDENTITY_REGISTRY}`);

  const factoryDeploy = await account.deployContract({
    classHash: factoryClassHash,
    constructorCalldata: CallData.compile({
      account_class_hash: accountClassHash,
      identity_registry: IDENTITY_REGISTRY,
    }),
  });
  console.log(`  Tx: ${factoryDeploy.transaction_hash}`);
  await provider.waitForTransaction(factoryDeploy.transaction_hash);
  const factoryAddress =
    (factoryDeploy as any).contract_address ??
    (factoryDeploy as any).address;
  console.log(`  Factory deployed: ${factoryAddress}`);

  // ── Step 3: Deploy an agent account via the factory ──
  console.log("\n[DEPLOY AGENT] via factory.deploy_account()...");
  console.log(`  public_key: ${PUBLIC_KEY}`);

  const FACTORY_ABI = [
    {
      name: "deploy_account",
      type: "function",
      inputs: [
        { name: "public_key", type: "core::felt252" },
        { name: "salt", type: "core::felt252" },
        { name: "token_uri", type: "core::byte_array::ByteArray" },
      ],
      outputs: [
        { type: "core::starknet::contract_address::ContractAddress" },
        { type: "core::integer::u256" },
      ],
      state_mutability: "external",
    },
  ] as const;

  // Use deployer address as salt for determinism
  const salt = PUBLIC_KEY;
  const tokenUri = "data:application/json,{\"name\":\"BitsageAgent\",\"description\":\"Autonomous prediction agent on Starknet\",\"agentType\":\"predictor\",\"model\":\"claude-opus-4-6\"}";

  // We need to use account.execute since invoke doesn't return call results.
  // The factory emits an AccountDeployed event with the address.
  const deployAgentTx = await account.execute([
    {
      contractAddress: factoryAddress,
      entrypoint: "deploy_account",
      calldata: CallData.compile({
        public_key: PUBLIC_KEY,
        salt,
        token_uri: tokenUri,
      }),
    },
  ]);

  console.log(`  Tx: ${deployAgentTx.transaction_hash}`);
  const receipt = await provider.waitForTransaction(deployAgentTx.transaction_hash);
  console.log(`  Status: ${(receipt as any).execution_status ?? "OK"}`);

  // Parse AccountDeployed event to get the agent account address and agent_id
  let agentAccountAddress = "unknown";
  let agentId = "unknown";

  // Look through events for AccountDeployed
  const events = (receipt as any).events ?? [];
  for (const event of events) {
    // AccountDeployed has keys: [selector, account, public_key]
    // and data: [agent_id_low, agent_id_high, registry]
    if (event.keys && event.keys.length >= 3 && event.data && event.data.length >= 3) {
      // The account address is the second key (after selector)
      const possibleAddr = event.keys[1];
      const possiblePubKey = event.keys[2];
      // Verify this is our event by checking the public key
      if (
        possiblePubKey &&
        BigInt(possiblePubKey) === BigInt(PUBLIC_KEY)
      ) {
        agentAccountAddress = "0x" + BigInt(possibleAddr).toString(16);
        const idLow = BigInt(event.data[0] ?? "0");
        const idHigh = BigInt(event.data[1] ?? "0");
        agentId = (idLow + (idHigh << 128n)).toString();
        break;
      }
    }
  }

  // If we couldn't parse the event, try a simpler approach
  if (agentAccountAddress === "unknown") {
    console.log("  (Could not parse AccountDeployed event, checking all events...)");
    for (const event of events) {
      console.log(`  Event keys: ${JSON.stringify(event.keys)}`);
      console.log(`  Event data: ${JSON.stringify(event.data)}`);
    }
  }

  // ── Save deployment info ──
  const deployment = {
    network: "sepolia",
    deployedAt: new Date().toISOString(),
    chainId: chainId.toString(),
    deployer: DEPLOYER_ADDRESS,
    contracts: {
      accountClassHash,
      factoryClassHash,
      factoryAddress,
      identityRegistry: IDENTITY_REGISTRY_SEPOLIA,
    },
    agentAccount: {
      address: agentAccountAddress,
      publicKey: PUBLIC_KEY,
      agentId,
    },
  };

  const outputPath = path.join(__dirname, "..", "deployed_addresses.json");
  fs.writeFileSync(outputPath, JSON.stringify(deployment, null, 2));
  console.log(`\nSaved deployment info to ${outputPath}`);

  // ── Summary ──
  console.log("\n========================================================");
  console.log("  DEPLOYMENT COMPLETE");
  console.log("========================================================");
  console.log(`\nAgentAccountFactory: ${factoryAddress}`);
  console.log(`AgentAccount:        ${agentAccountAddress}`);
  console.log(`ERC-8004 Agent ID:   ${agentId}`);
  console.log(`Identity Registry:   ${IDENTITY_REGISTRY_SEPOLIA}`);
  console.log(`Account Class Hash:  ${accountClassHash}`);
  console.log("");
  console.log("Add to your prediction-agent .env:");
  console.log(`  AGENT_ACCOUNT_FACTORY=${factoryAddress}`);
  console.log(`  AGENT_ADDRESS=${agentAccountAddress}`);
  console.log(`  AGENT_PRIVATE_KEY=${DEPLOYER_KEY}`);
  console.log(`  IDENTITY_REGISTRY_ADDRESS=${IDENTITY_REGISTRY_SEPOLIA}`);
  console.log("");
  console.log("View on Voyager:");
  console.log(`  https://sepolia.voyager.online/contract/${factoryAddress}`);
  if (agentAccountAddress !== "unknown") {
    console.log(`  https://sepolia.voyager.online/contract/${agentAccountAddress}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nDEPLOYMENT FAILED:", err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  });
