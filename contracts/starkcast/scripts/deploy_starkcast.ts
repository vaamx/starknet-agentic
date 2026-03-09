/**
 * Deploy StarkCastFeed to Starknet Sepolia
 *
 * Usage:
 *   cd contracts/starkcast
 *   npx tsx scripts/deploy_starkcast.ts
 *
 * Environment:
 *   STARKNET_RPC_URL       (default: https://rpc.starknet-testnet.lava.build)
 *   DEPLOYER_ADDRESS       (required)
 *   DEPLOYER_PRIVATE_KEY   (required)
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

// STRK token on Sepolia
const STRK_SEPOLIA =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

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

// ── Helpers ─────────────────────────────────────────────────────────────

function loadArtifact() {
  const basePath = path.join(PROJECT_DIR, "target", "dev");
  const sierraPath = path.join(
    basePath,
    "starkcast_StarkCastFeed.contract_class.json"
  );
  const casmPath = path.join(
    basePath,
    "starkcast_StarkCastFeed.compiled_contract_class.json"
  );

  if (!fs.existsSync(sierraPath)) {
    console.error(`Sierra artifact not found: ${sierraPath}`);
    console.error("Run `scarb build` in contracts/starkcast/ first.");
    process.exit(1);
  }
  if (!fs.existsSync(casmPath)) {
    console.error(`CASM artifact not found: ${casmPath}`);
    console.error("Run `scarb build` in contracts/starkcast/ first.");
    process.exit(1);
  }

  return {
    sierra: json.parse(fs.readFileSync(sierraPath).toString("ascii")),
    casm: json.parse(fs.readFileSync(casmPath).toString("ascii")),
  };
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n================================================================");
  console.log("  DEPLOYING STARKCAST FEED TO SEPOLIA");
  console.log("================================================================\n");

  const provider = new RpcProvider({ nodeUrl: RPC_URL });
  const chainId = await provider.getChainId();
  console.log(`Chain:    ${chainId}`);
  console.log(`RPC:      ${RPC_URL}`);
  console.log(`Deployer: ${DEPLOYER_ADDRESS}\n`);

  const account = new Account({
    provider,
    address: DEPLOYER_ADDRESS,
    signer: DEPLOYER_PRIVATE_KEY,
  });

  const { sierra, casm } = loadArtifact();

  // Declare
  console.log("[DECLARE] StarkCastFeed...");
  const classHash = hash.computeContractClassHash(sierra);
  console.log(`  Class hash: ${classHash}`);

  let alreadyDeclared = false;
  try {
    await provider.getClass(classHash);
    console.log("  Already declared.\n");
    alreadyDeclared = true;
  } catch {
    // Not declared yet
  }

  if (!alreadyDeclared) {
    try {
      const resp = await account.declare({ contract: sierra, casm });
      console.log(`  Tx: ${resp.transaction_hash}`);
      await provider.waitForTransaction(resp.transaction_hash);
      console.log("  Declared!\n");
    } catch (err: any) {
      if (
        err.message?.includes("already declared") ||
        err.message?.includes("CLASS_ALREADY_DECLARED")
      ) {
        console.log("  Already declared (caught from tx).\n");
      } else {
        const mismatchMatch = err.message?.match(/Expected:\s*(0x[0-9a-fA-F]+)/);
        if (mismatchMatch) {
          console.log(`  Hash mismatch, retrying with: ${mismatchMatch[1]}`);
          const resp = await account.declare({
            contract: sierra,
            casm,
            compiledClassHash: mismatchMatch[1],
          });
          console.log(`  Tx: ${resp.transaction_hash}`);
          await provider.waitForTransaction(resp.transaction_hash);
          console.log("  Declared!\n");
        } else {
          throw err;
        }
      }
    }
  }

  // Deploy — constructor(owner, tip_token)
  console.log("[DEPLOY] StarkCastFeed...");
  const resp = await account.deployContract({
    classHash,
    constructorCalldata: CallData.compile({
      owner: DEPLOYER_ADDRESS,
      tip_token: STRK_SEPOLIA,
    }),
  });
  console.log(`  Tx: ${resp.transaction_hash}`);
  await provider.waitForTransaction(resp.transaction_hash);
  const feedAddress = (resp as any).contract_address ?? (resp as any).address;
  console.log(`  Address: ${feedAddress}\n`);

  // Save deployment result
  const deploymentsDir = path.join(PROJECT_DIR, "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const deployment = {
    network: "sepolia",
    deployedAt: new Date().toISOString(),
    chainId: chainId.toString(),
    deployer: DEPLOYER_ADDRESS,
    tipToken: STRK_SEPOLIA,
    classHash,
    feedAddress,
  };

  const outputPath = path.join(deploymentsDir, "sepolia.json");
  fs.writeFileSync(outputPath, JSON.stringify(deployment, null, 2));
  console.log(`Saved to ${outputPath}`);

  console.log("\n================================================================");
  console.log("  STARKCAST FEED DEPLOYMENT COMPLETE");
  console.log("================================================================\n");
  console.log(`Feed:     ${feedAddress}`);
  console.log(`Class:    ${classHash}`);
  console.log("");
  console.log("Add to .env / Vercel:");
  console.log(`  STARKCAST_FEED_ADDRESS=${feedAddress}`);
  console.log(`  NEXT_PUBLIC_STARKCAST_FEED_ADDRESS=${feedAddress}`);
  console.log("");
  console.log("Voyager:");
  console.log(`  https://sepolia.voyager.online/contract/${feedAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nDEPLOYMENT FAILED:", err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  });
