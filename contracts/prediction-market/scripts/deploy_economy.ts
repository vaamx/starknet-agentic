/**
 * Deploy Economy Contracts to Sepolia
 *
 * Declares and deploys:
 *   1. TaskEscrow (ProveWork)
 *   2. AgentToken + BondingCurve + StarkMintFactory (StarkMint)
 *   3. GuildRegistry + GuildDAO (Agent Guilds)
 *
 * Usage:
 *   cd contracts/prediction-market
 *   npx tsx scripts/deploy_economy.ts
 *
 * Environment (or pass as args):
 *   STARKNET_RPC_URL, DEPLOYER_ADDRESS, DEPLOYER_PRIVATE_KEY
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
const CONTRACTS_ROOT = path.join(__dirname, "..", "..");

// STRK token on Sepolia
const STRK_SEPOLIA =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

// ── Config ────────────────────────────────────────────────────────────────

const RPC_URL = process.env.STARKNET_RPC_URL ?? "https://rpc.starknet-testnet.lava.build";
const DEPLOYER_ADDRESS =
  process.env.DEPLOYER_ADDRESS ??
  "0x0759a4374389b0e3cfcc59d49310b6bc75bb12bbf8ce550eb5c2f026918bb344";
const DEPLOYER_PRIVATE_KEY =
  process.env.DEPLOYER_PRIVATE_KEY ??
  "0x0154de503c7553e078b28044f15b60323899d9437bd44e99d9ab629acbada47a";

// ── Helpers ───────────────────────────────────────────────────────────────

function loadArtifact(contractDir: string, prefix: string, contractName: string) {
  const basePath = path.join(CONTRACTS_ROOT, contractDir, "target", "dev");
  const sierraPath = path.join(basePath, `${prefix}_${contractName}.contract_class.json`);
  const casmPath = path.join(basePath, `${prefix}_${contractName}.compiled_contract_class.json`);

  if (!fs.existsSync(sierraPath)) {
    throw new Error(`Missing Sierra: ${sierraPath}`);
  }
  if (!fs.existsSync(casmPath)) {
    throw new Error(`Missing CASM: ${casmPath}`);
  }

  return {
    sierra: json.parse(fs.readFileSync(sierraPath).toString("ascii")),
    casm: json.parse(fs.readFileSync(casmPath).toString("ascii")),
  };
}

async function declareContract(
  account: Account,
  provider: RpcProvider,
  name: string,
  sierra: any,
  casm: any
): Promise<string> {
  console.log(`[DECLARE] ${name}...`);
  const classHash = hash.computeContractClassHash(sierra);
  console.log(`  Class hash: ${classHash}`);

  // Check if already declared
  try {
    await provider.getClass(classHash);
    console.log(`  Already declared.\n`);
    return classHash;
  } catch {
    // Not declared yet
  }

  try {
    const resp = await account.declare({ contract: sierra, casm });
    console.log(`  Tx: ${resp.transaction_hash}`);
    await provider.waitForTransaction(resp.transaction_hash);
    console.log(`  Declared!\n`);
    return resp.class_hash;
  } catch (err: any) {
    if (
      err.message?.includes("already declared") ||
      err.message?.includes("CLASS_ALREADY_DECLARED")
    ) {
      console.log(`  Already declared (caught from tx).\n`);
      return classHash;
    }

    // Handle compiled_class_hash mismatch
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
      console.log(`  Declared!\n`);
      return resp.class_hash;
    }

    throw err;
  }
}

async function deployContract(
  account: Account,
  provider: RpcProvider,
  name: string,
  classHash: string,
  constructorCalldata: any
): Promise<string> {
  console.log(`[DEPLOY] ${name}...`);
  const resp = await account.deployContract({
    classHash,
    constructorCalldata,
  });
  console.log(`  Tx: ${resp.transaction_hash}`);
  await provider.waitForTransaction(resp.transaction_hash);
  const address = (resp as any).contract_address ?? (resp as any).address;
  console.log(`  Address: ${address}\n`);
  return address;
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n================================================================");
  console.log("  DEPLOYING ECONOMY CONTRACTS TO SEPOLIA");
  console.log("================================================================\n");

  const provider = new RpcProvider({ nodeUrl: RPC_URL });
  const chainId = await provider.getChainId();
  console.log(`Chain:    ${chainId}`);
  console.log(`RPC:      ${RPC_URL}`);
  console.log(`Deployer: ${DEPLOYER_ADDRESS}\n`);

  const account = new Account(provider, DEPLOYER_ADDRESS, DEPLOYER_PRIVATE_KEY, "1");

  const result: Record<string, string> = {};

  // ================================================================
  // 1. TaskEscrow (ProveWork)
  // ================================================================
  console.log("────────────────────────────────────────────────────────────────");
  console.log("  1. PROVEWORK — TaskEscrow");
  console.log("────────────────────────────────────────────────────────────────\n");

  const taskEscrow = loadArtifact("task-escrow", "task_escrow", "TaskEscrow");
  const taskEscrowClassHash = await declareContract(account, provider, "TaskEscrow", taskEscrow.sierra, taskEscrow.casm);
  result.taskEscrowClassHash = taskEscrowClassHash;

  const taskEscrowAddress = await deployContract(account, provider, "TaskEscrow", taskEscrowClassHash, CallData.compile({
    owner: DEPLOYER_ADDRESS,
    collateral_token: STRK_SEPOLIA,
  }));
  result.taskEscrowAddress = taskEscrowAddress;

  // ================================================================
  // 2. StarkMint — AgentToken + BondingCurve + Factory
  // ================================================================
  console.log("────────────────────────────────────────────────────────────────");
  console.log("  2. STARKMINT — AgentToken + BondingCurve + Factory");
  console.log("────────────────────────────────────────────────────────────────\n");

  const agentToken = loadArtifact("bonding-curve", "bonding_curve", "AgentToken");
  const bondingCurve = loadArtifact("bonding-curve", "bonding_curve", "BondingCurve");
  const starkMintFactory = loadArtifact("bonding-curve", "bonding_curve", "StarkMintFactory");

  const agentTokenClassHash = await declareContract(account, provider, "AgentToken", agentToken.sierra, agentToken.casm);
  result.agentTokenClassHash = agentTokenClassHash;

  const bondingCurveClassHash = await declareContract(account, provider, "BondingCurve", bondingCurve.sierra, bondingCurve.casm);
  result.bondingCurveClassHash = bondingCurveClassHash;

  const starkMintFactoryClassHash = await declareContract(account, provider, "StarkMintFactory", starkMintFactory.sierra, starkMintFactory.casm);
  result.starkMintFactoryClassHash = starkMintFactoryClassHash;

  const starkMintFactoryAddress = await deployContract(account, provider, "StarkMintFactory", starkMintFactoryClassHash, CallData.compile({
    owner: DEPLOYER_ADDRESS,
    token_class_hash: agentTokenClassHash,
    curve_class_hash: bondingCurveClassHash,
    reserve_token: STRK_SEPOLIA,
  }));
  result.starkMintFactoryAddress = starkMintFactoryAddress;

  // ================================================================
  // 3. Agent Guilds — GuildRegistry + GuildDAO
  // ================================================================
  console.log("────────────────────────────────────────────────────────────────");
  console.log("  3. AGENT GUILDS — GuildRegistry + GuildDAO");
  console.log("────────────────────────────────────────────────────────────────\n");

  const guildRegistry = loadArtifact("agent-guilds", "agent_guilds", "GuildRegistry");
  const guildDAO = loadArtifact("agent-guilds", "agent_guilds", "GuildDAO");

  const guildRegistryClassHash = await declareContract(account, provider, "GuildRegistry", guildRegistry.sierra, guildRegistry.casm);
  result.guildRegistryClassHash = guildRegistryClassHash;

  const guildDAOClassHash = await declareContract(account, provider, "GuildDAO", guildDAO.sierra, guildDAO.casm);
  result.guildDAOClassHash = guildDAOClassHash;

  const guildRegistryAddress = await deployContract(account, provider, "GuildRegistry", guildRegistryClassHash, CallData.compile({
    owner: DEPLOYER_ADDRESS,
    stake_token: STRK_SEPOLIA,
  }));
  result.guildRegistryAddress = guildRegistryAddress;

  const guildDAOAddress = await deployContract(account, provider, "GuildDAO", guildDAOClassHash, CallData.compile({
    registry: guildRegistryAddress,
  }));
  result.guildDAOAddress = guildDAOAddress;

  // ================================================================
  // Save & Print
  // ================================================================
  const deployment = {
    network: "sepolia",
    deployedAt: new Date().toISOString(),
    chainId: chainId.toString(),
    deployer: DEPLOYER_ADDRESS,
    strkToken: STRK_SEPOLIA,
    provework: {
      taskEscrowClassHash,
      taskEscrowAddress,
    },
    starkmint: {
      agentTokenClassHash,
      bondingCurveClassHash,
      starkMintFactoryClassHash,
      starkMintFactoryAddress,
    },
    guilds: {
      guildRegistryClassHash,
      guildDAOClassHash,
      guildRegistryAddress,
      guildDAOAddress,
    },
  };

  const outputPath = path.join(__dirname, "..", "economy_deployed.json");
  fs.writeFileSync(outputPath, JSON.stringify(deployment, null, 2));
  console.log(`\nSaved to ${outputPath}`);

  console.log("\n================================================================");
  console.log("  ECONOMY DEPLOYMENT COMPLETE");
  console.log("================================================================\n");
  console.log(`TaskEscrow:         ${taskEscrowAddress}`);
  console.log(`StarkMintFactory:   ${starkMintFactoryAddress}`);
  console.log(`GuildRegistry:      ${guildRegistryAddress}`);
  console.log(`GuildDAO:           ${guildDAOAddress}`);
  console.log("");
  console.log("Add to prediction-agent .env:");
  console.log(`  NEXT_PUBLIC_TASK_ESCROW_ADDRESS=${taskEscrowAddress}`);
  console.log(`  NEXT_PUBLIC_BONDING_CURVE_FACTORY_ADDRESS=${starkMintFactoryAddress}`);
  console.log(`  NEXT_PUBLIC_GUILD_REGISTRY_ADDRESS=${guildRegistryAddress}`);
  console.log(`  NEXT_PUBLIC_GUILD_DAO_ADDRESS=${guildDAOAddress}`);
  console.log("");
  console.log("Voyager:");
  console.log(`  https://sepolia.voyager.online/contract/${taskEscrowAddress}`);
  console.log(`  https://sepolia.voyager.online/contract/${starkMintFactoryAddress}`);
  console.log(`  https://sepolia.voyager.online/contract/${guildRegistryAddress}`);
  console.log(`  https://sepolia.voyager.online/contract/${guildDAOAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nDEPLOYMENT FAILED:", err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  });
