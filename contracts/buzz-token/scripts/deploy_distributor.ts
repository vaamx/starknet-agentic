/**
 * Deploy BuzzDistributor to Starknet Sepolia
 *
 * Declares and deploys the BuzzDistributor contract, then:
 * 1. Adds the distributor as a minter on the BUZZ token
 * 2. Adds the agent server as a reporter on the distributor
 *
 * Prerequisites:
 *   cd contracts/buzz-token && scarb build --ignore-cairo-version
 *
 * Usage:
 *   cd contracts/buzz-token
 *   npx tsx scripts/deploy_distributor.ts
 *
 * Environment:
 *   STARKNET_RPC_URL       (default: https://rpc.starknet-testnet.lava.build)
 *   DEPLOYER_ADDRESS       (required)
 *   DEPLOYER_PRIVATE_KEY   (required)
 *   BUZZ_TOKEN_ADDRESS     (required — deployed BUZZ token)
 *   AGENT_ADDRESS          (optional — reporter address, defaults to DEPLOYER_ADDRESS)
 */

import {
  RpcProvider,
  Account,
  json,
  hash,
  CallData,
  Contract,
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
const BUZZ_TOKEN_ADDRESS = process.env.BUZZ_TOKEN_ADDRESS;

if (!DEPLOYER_ADDRESS || !DEPLOYER_PRIVATE_KEY) {
  console.error(
    "Missing required env vars: DEPLOYER_ADDRESS, DEPLOYER_PRIVATE_KEY"
  );
  process.exit(1);
}

if (!BUZZ_TOKEN_ADDRESS) {
  console.error("Missing required env var: BUZZ_TOKEN_ADDRESS");
  process.exit(1);
}

const OWNER_ADDRESS = process.env.AGENT_ADDRESS ?? DEPLOYER_ADDRESS;
const REPORTER_ADDRESS = process.env.AGENT_ADDRESS ?? DEPLOYER_ADDRESS;

// ── Helpers ─────────────────────────────────────────────────────────────

function loadArtifact(contractName: string) {
  const basePath = path.join(PROJECT_DIR, "target", "dev");
  const sierraPath = path.join(
    basePath,
    `buzz_token_${contractName}.contract_class.json`
  );
  const casmPath = path.join(
    basePath,
    `buzz_token_${contractName}.compiled_contract_class.json`
  );

  if (!fs.existsSync(sierraPath)) {
    console.error(`Sierra artifact not found: ${sierraPath}`);
    console.error("Run `scarb build --ignore-cairo-version` first.");
    process.exit(1);
  }
  if (!fs.existsSync(casmPath)) {
    console.error(`CASM artifact not found: ${casmPath}`);
    console.error("Run `scarb build --ignore-cairo-version` first.");
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
  casm: any,
  name: string
): Promise<string> {
  console.log(`[DECLARE] ${name}...`);
  const classHash = hash.computeContractClassHash(sierra);
  console.log(`  Class hash: ${classHash}`);

  try {
    await provider.getClass(classHash);
    console.log("  Already declared.\n");
    return classHash;
  } catch {
    // Not declared yet
  }

  try {
    const resp = await account.declare({ contract: sierra, casm });
    console.log(`  Tx: ${resp.transaction_hash}`);
    await provider.waitForTransaction(resp.transaction_hash);
    console.log("  Declared!\n");
    return resp.class_hash;
  } catch (err: any) {
    if (
      err.message?.includes("already declared") ||
      err.message?.includes("CLASS_ALREADY_DECLARED")
    ) {
      console.log("  Already declared (caught from tx).\n");
      return classHash;
    }

    const mismatchMatch = err.message?.match(/Expected:\s*(0x[0-9a-fA-F]+)/);
    if (mismatchMatch) {
      const expectedHash = mismatchMatch[1];
      console.log(
        `  Compiled hash mismatch, retrying with: ${expectedHash}`
      );
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
  constructorCalldata: any,
  name: string
): Promise<string> {
  console.log(`[DEPLOY] ${name}...`);
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
  console.log(
    "\n================================================================"
  );
  console.log("  DEPLOYING BUZZ DISTRIBUTOR TO SEPOLIA");
  console.log(
    "================================================================\n"
  );

  const provider = new RpcProvider({ nodeUrl: RPC_URL });
  const chainId = await provider.getChainId();
  console.log(`Chain:         ${chainId}`);
  console.log(`RPC:           ${RPC_URL}`);
  console.log(`Deployer:      ${DEPLOYER_ADDRESS}`);
  console.log(`Owner:         ${OWNER_ADDRESS}`);
  console.log(`BUZZ Token:    ${BUZZ_TOKEN_ADDRESS}`);
  console.log(`Reporter:      ${REPORTER_ADDRESS}\n`);

  const account = new Account({
    provider,
    address: DEPLOYER_ADDRESS,
    signer: DEPLOYER_PRIVATE_KEY,
  });

  // Load build artifacts
  const { sierra, casm } = loadArtifact("BuzzDistributor");

  // Declare
  const classHash = await declareContract(
    account,
    provider,
    sierra,
    casm,
    "BuzzDistributor"
  );

  // Deploy — constructor(owner, buzz_token)
  const distributorAddress = await deployContract(
    account,
    provider,
    classHash,
    CallData.compile({
      owner: OWNER_ADDRESS,
      buzz_token: BUZZ_TOKEN_ADDRESS,
    }),
    "BuzzDistributor"
  );

  // ── Post-deploy: Add distributor as minter on BUZZ token ──────────
  console.log("[POST-DEPLOY] Adding distributor as minter on BUZZ token...");
  const buzzTokenAbi = loadArtifact("BuzzToken").sierra.abi;
  const buzzToken = new Contract({
    abi: buzzTokenAbi,
    address: BUZZ_TOKEN_ADDRESS,
    providerOrAccount: account,
  });

  try {
    const tx1 = await buzzToken.invoke("add_minter", [distributorAddress]);
    console.log(`  add_minter tx: ${tx1.transaction_hash}`);
    await provider.waitForTransaction(tx1.transaction_hash);
    console.log("  Distributor added as minter!\n");
  } catch (err: any) {
    console.warn(`  Warning: add_minter failed: ${err.message}\n`);
    console.warn(
      "  You may need to call add_minter manually from the token owner wallet.\n"
    );
  }

  // ── Post-deploy: Add reporter on distributor ──────────────────────
  if (REPORTER_ADDRESS !== OWNER_ADDRESS) {
    console.log("[POST-DEPLOY] Adding reporter on distributor...");
    const distributorAbi = sierra.abi;
    const distributor = new Contract({
      abi: distributorAbi,
      address: distributorAddress,
      providerOrAccount: account,
    });

    try {
      const tx2 = await distributor.invoke("add_reporter", [REPORTER_ADDRESS]);
      console.log(`  add_reporter tx: ${tx2.transaction_hash}`);
      await provider.waitForTransaction(tx2.transaction_hash);
      console.log("  Reporter added!\n");
    } catch (err: any) {
      console.warn(`  Warning: add_reporter failed: ${err.message}\n`);
    }
  } else {
    console.log(
      "[POST-DEPLOY] Reporter = Owner, no need to add_reporter (owner is implicitly authorized).\n"
    );
  }

  // Write deployment result
  const deploymentsDir = path.join(PROJECT_DIR, "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  // Read existing deployment file and extend it
  const outputPath = path.join(deploymentsDir, "sepolia.json");
  let existing: any = {};
  if (fs.existsSync(outputPath)) {
    existing = JSON.parse(fs.readFileSync(outputPath, "utf-8"));
  }

  const deployment = {
    ...existing,
    distributor: {
      deployedAt: new Date().toISOString(),
      classHash,
      address: distributorAddress,
      buzzTokenAddress: BUZZ_TOKEN_ADDRESS,
      ownerAddress: OWNER_ADDRESS,
      reporterAddress: REPORTER_ADDRESS,
    },
  };

  fs.writeFileSync(outputPath, JSON.stringify(deployment, null, 2));
  console.log(`Saved to ${outputPath}`);

  console.log(
    "\n================================================================"
  );
  console.log("  BUZZ DISTRIBUTOR DEPLOYMENT COMPLETE");
  console.log(
    "================================================================\n"
  );
  console.log(`Distributor:   ${distributorAddress}`);
  console.log(`BUZZ Token:    ${BUZZ_TOKEN_ADDRESS}`);
  console.log(`Owner:         ${OWNER_ADDRESS}`);
  console.log(`Reporter:      ${REPORTER_ADDRESS}`);
  console.log(`Class:         ${classHash}`);
  console.log("");
  console.log("Security features:");
  console.log("  - 5-min timelocked upgrade (propose → wait 300s → execute)");
  console.log("  - Max reward cap: 500 BUZZ per action");
  console.log("  - Max batch size: 50 actions per tx");
  console.log("  - Reporter rate limit: 100 actions/60s per reporter");
  console.log("  - 5-min dedup window per (recipient, action, market)");
  console.log("");
  console.log("Add to .env:");
  console.log(`  BUZZ_DISTRIBUTOR_ADDRESS=${distributorAddress}`);
  console.log("");
  console.log("Voyager:");
  console.log(
    `  https://sepolia.voyager.online/contract/${distributorAddress}`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nDEPLOYMENT FAILED:", err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  });
