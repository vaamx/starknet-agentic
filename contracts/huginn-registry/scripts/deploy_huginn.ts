/**
 * Deploy HuginnRegistry to Starknet Sepolia
 *
 * Declares and deploys the HuginnRegistry thought-provenance contract.
 * Constructor takes a single verifier_address (defaults to deployer).
 *
 * Prerequisites:
 *   cd contracts/huginn-registry && scarb build
 *
 * Usage:
 *   cd contracts/huginn-registry
 *   npx tsx scripts/deploy_huginn.ts
 *
 * Environment:
 *   STARKNET_RPC_URL       (default: https://rpc.starknet-testnet.lava.build)
 *   DEPLOYER_ADDRESS       (required)
 *   DEPLOYER_PRIVATE_KEY   (required)
 *   HUGINN_VERIFIER_ADDRESS (default: DEPLOYER_ADDRESS)
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

// Verifier defaults to deployer for initial Sepolia deployment
const VERIFIER_ADDRESS = process.env.HUGINN_VERIFIER_ADDRESS ?? DEPLOYER_ADDRESS;

// ── Helpers ─────────────────────────────────────────────────────────────

function loadArtifact() {
  const basePath = path.join(PROJECT_DIR, "target", "dev");
  const sierraPath = path.join(
    basePath,
    "huginn_registry_HuginnRegistry.contract_class.json"
  );
  const casmPath = path.join(
    basePath,
    "huginn_registry_HuginnRegistry.compiled_contract_class.json"
  );

  if (!fs.existsSync(sierraPath)) {
    console.error(`Sierra artifact not found: ${sierraPath}`);
    console.error(
      "Run `scarb build` in contracts/huginn-registry/ first."
    );
    process.exit(1);
  }
  if (!fs.existsSync(casmPath)) {
    console.error(`CASM artifact not found: ${casmPath}`);
    console.error(
      "Run `scarb build` in contracts/huginn-registry/ first."
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
  console.log("[DECLARE] HuginnRegistry...");
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
  console.log("[DEPLOY] HuginnRegistry...");
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
  console.log("  DEPLOYING HUGINN REGISTRY TO SEPOLIA");
  console.log("================================================================\n");

  const provider = new RpcProvider({ nodeUrl: RPC_URL });
  const chainId = await provider.getChainId();
  console.log(`Chain:    ${chainId}`);
  console.log(`RPC:      ${RPC_URL}`);
  console.log(`Deployer: ${DEPLOYER_ADDRESS}`);
  console.log(`Verifier: ${VERIFIER_ADDRESS}\n`);

  const account = new Account({
    provider,
    address: DEPLOYER_ADDRESS,
    signer: DEPLOYER_PRIVATE_KEY,
  });

  // Load build artifacts
  const { sierra, casm } = loadArtifact();

  // Declare
  const classHash = await declareContract(account, provider, sierra, casm);

  // Deploy — constructor(verifier_address: ContractAddress)
  const registryAddress = await deployContract(
    account,
    provider,
    classHash,
    CallData.compile({
      verifier_address: VERIFIER_ADDRESS,
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
    verifierAddress: VERIFIER_ADDRESS,
    classHash,
    registryAddress,
  };

  const outputPath = path.join(deploymentsDir, "sepolia.json");
  fs.writeFileSync(outputPath, JSON.stringify(deployment, null, 2));
  console.log(`Saved to ${outputPath}`);

  console.log("\n================================================================");
  console.log("  HUGINN REGISTRY DEPLOYMENT COMPLETE");
  console.log("================================================================\n");
  console.log(`Registry:  ${registryAddress}`);
  console.log(`Verifier:  ${VERIFIER_ADDRESS}`);
  console.log(`Class:     ${classHash}`);
  console.log("");
  console.log("Add to .env:");
  console.log(`  HUGINN_REGISTRY_ADDRESS=${registryAddress}`);
  console.log("");
  console.log("Voyager:");
  console.log(`  https://sepolia.voyager.online/contract/${registryAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nDEPLOYMENT FAILED:", err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  });
