/**
 * Deploy BuzzToken to Starknet Sepolia
 *
 * Declares and deploys the BuzzToken ERC-20 contract.
 * Constructor takes a single owner address (defaults to deployer).
 *
 * Prerequisites:
 *   cd contracts/buzz-token && scarb build
 *
 * Usage:
 *   cd contracts/buzz-token
 *   npx tsx scripts/deploy_buzz.ts
 *
 * Environment:
 *   STARKNET_RPC_URL       (default: https://rpc.starknet-testnet.lava.build)
 *   DEPLOYER_ADDRESS       (required)
 *   DEPLOYER_PRIVATE_KEY   (required)
 *   AGENT_ADDRESS          (optional — token owner, defaults to DEPLOYER_ADDRESS)
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
const PROJECT_DIR = path.join(__dirname, "..");

// ── Config ──────────────────────────────────────────────────────────────

const RPC_URL =
  process.env.STARKNET_RPC_URL ?? "https://rpc.starknet-testnet.lava.build";

const DEPLOYER_ADDRESS = process.env.DEPLOYER_ADDRESS;
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;

if (!DEPLOYER_ADDRESS || !DEPLOYER_PRIVATE_KEY) {
  console.error(
    "Missing required env vars: DEPLOYER_ADDRESS, DEPLOYER_PRIVATE_KEY"
  );
  process.exit(1);
}

// Owner defaults to AGENT_ADDRESS if set, otherwise deployer
const OWNER_ADDRESS = process.env.AGENT_ADDRESS ?? DEPLOYER_ADDRESS;

// ── Helpers ─────────────────────────────────────────────────────────────

function loadArtifact() {
  const basePath = path.join(PROJECT_DIR, "target", "dev");
  const sierraPath = path.join(
    basePath,
    "buzz_token_BuzzToken.contract_class.json"
  );
  const casmPath = path.join(
    basePath,
    "buzz_token_BuzzToken.compiled_contract_class.json"
  );

  if (!fs.existsSync(sierraPath)) {
    console.error(`Sierra artifact not found: ${sierraPath}`);
    console.error(
      "Run `scarb build` in contracts/buzz-token/ first."
    );
    process.exit(1);
  }
  if (!fs.existsSync(casmPath)) {
    console.error(`CASM artifact not found: ${casmPath}`);
    console.error(
      "Run `scarb build` in contracts/buzz-token/ first."
    );
    process.exit(1);
  }

  return {
    sierra: json.parse(fs.readFileSync(sierraPath).toString("ascii")),
    casm: json.parse(fs.readFileSync(casmPath).toString("ascii")),
  };
}

async function declareContract(
  account: Account,
  provider: RpcProvider,
  sierra: any,
  casm: any
): Promise<string> {
  console.log("[DECLARE] BuzzToken...");
  const classHash = hash.computeContractClassHash(sierra);
  console.log(`  Class hash: ${classHash}`);

  // Check if already declared on-chain
  try {
    await provider.getClass(classHash);
    console.log("  Already declared.\n");
    return classHash;
  } catch {
    // Not declared yet — proceed
  }

  try {
    const resp = await account.declare({ contract: sierra, casm });
    console.log(`  Tx: ${resp.transaction_hash}`);
    await provider.waitForTransaction(resp.transaction_hash);
    console.log("  Declared!\n");
    return resp.class_hash;
  } catch (err: any) {
    // Handle "already declared" race
    if (
      err.message?.includes("already declared") ||
      err.message?.includes("CLASS_ALREADY_DECLARED")
    ) {
      console.log("  Already declared (caught from tx).\n");
      return classHash;
    }

    // Handle compiled_class_hash mismatch — retry with expected hash
    const mismatchMatch = err.message?.match(/Expected:\s*(0x[0-9a-fA-F]+)/);
    if (mismatchMatch) {
      const expectedHash = mismatchMatch[1];
      console.log(`  Compiled hash mismatch, retrying with: ${expectedHash}`);
      const resp = await account.declare({
        contract: sierra,
        casm,
        compiledClassHash: expectedHash,
      });
      console.log(`  Tx: ${resp.transaction_hash}`);
      await provider.waitForTransaction(resp.transaction_hash);
      console.log("  Declared!\n");
      return resp.class_hash;
    }

    throw err;
  }
}

async function deployContract(
  account: Account,
  provider: RpcProvider,
  classHash: string,
  constructorCalldata: any
): Promise<string> {
  console.log("[DEPLOY] BuzzToken...");
  const resp = await account.deployContract({
    classHash,
    constructorCalldata,
  });
  console.log(`  Tx: ${resp.transaction_hash}`);
  await provider.waitForTransaction(resp.transaction_hash);
  const address =
    (resp as any).contract_address ?? (resp as any).address;
  console.log(`  Address: ${address}\n`);
  return address;
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n================================================================");
  console.log("  DEPLOYING BUZZ TOKEN TO SEPOLIA");
  console.log("================================================================\n");

  const provider = new RpcProvider({ nodeUrl: RPC_URL });
  const chainId = await provider.getChainId();
  console.log(`Chain:    ${chainId}`);
  console.log(`RPC:      ${RPC_URL}`);
  console.log(`Deployer: ${DEPLOYER_ADDRESS}`);
  console.log(`Owner:    ${OWNER_ADDRESS}\n`);

  const account = new Account({
    provider,
    address: DEPLOYER_ADDRESS,
    signer: DEPLOYER_PRIVATE_KEY,
  });

  // Load build artifacts
  const { sierra, casm } = loadArtifact();

  // Declare
  const classHash = await declareContract(account, provider, sierra, casm);

  // Deploy — constructor(owner: ContractAddress)
  const tokenAddress = await deployContract(
    account,
    provider,
    classHash,
    CallData.compile({
      owner: OWNER_ADDRESS,
    })
  );

  // Write deployment result
  const deploymentsDir = path.join(PROJECT_DIR, "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const deployment = {
    network: "sepolia",
    deployedAt: new Date().toISOString(),
    chainId: chainId.toString(),
    rpcUrl: RPC_URL,
    deployerAddress: DEPLOYER_ADDRESS,
    ownerAddress: OWNER_ADDRESS,
    classHash,
    tokenAddress,
    tokenName: "Buzz Token",
    tokenSymbol: "BUZZ",
    maxSupply: "21000000000000000000000000",
  };

  const outputPath = path.join(deploymentsDir, "sepolia.json");
  fs.writeFileSync(outputPath, JSON.stringify(deployment, null, 2));
  console.log(`Saved to ${outputPath}`);

  console.log("\n================================================================");
  console.log("  BUZZ TOKEN DEPLOYMENT COMPLETE");
  console.log("================================================================\n");
  console.log(`Token:     ${tokenAddress}`);
  console.log(`Owner:     ${OWNER_ADDRESS}`);
  console.log(`Class:     ${classHash}`);
  console.log(`Max Supply: 21,000,000 BUZZ`);
  console.log("");
  console.log("Add to .env:");
  console.log(`  BUZZ_TOKEN_ADDRESS=${tokenAddress}`);
  console.log("");
  console.log("Voyager:");
  console.log(`  https://sepolia.voyager.online/contract/${tokenAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nDEPLOYMENT FAILED:", err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  });
