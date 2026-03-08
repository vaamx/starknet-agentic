/**
 * Seed Sepolia — Populate economy contracts with real data.
 *
 * Creates:
 *   - 4 ProveWork tasks (various reward levels)
 *   - 2 StarkMint token launches (linear + quadratic curves)
 *   - 1 Guild ("Forecasters Guild")
 *
 * After running this, all on-chain readers, API routes, listing pages,
 * and the hicecaster CLI will return real data instead of mock fallbacks.
 *
 * Usage:
 *   export DEPLOYER_PRIVATE_KEY=0x...
 *   export DEPLOYER_ADDRESS=0x...
 *   npx tsx scripts/seed_sepolia.ts
 *
 * The deployer must have STRK on Sepolia (faucet: https://blastapi.io/faucets/starknet-sepolia-strk)
 */

import {
  RpcProvider,
  Account,
  CallData,
  shortString,
  type Call,
} from "starknet";

// ── Config ─────────────────────────────────────────────────────────────

const RPC_URL =
  process.env.STARKNET_RPC_URL ??
  "https://rpc.starknet-testnet.lava.build";

const DEPLOYER_ADDRESS =
  process.env.DEPLOYER_ADDRESS ??
  "0x0759a4374389b0e3cfcc59d49310b6bc75bb12bbf8ce550eb5c2f026918bb344";

const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;

if (!DEPLOYER_PRIVATE_KEY) {
  console.error("ERROR: Set DEPLOYER_PRIVATE_KEY env var");
  process.exit(1);
}

// ── Deployed addresses (Sepolia) ───────────────────────────────────────

const STRK =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

const TASK_ESCROW =
  "0x715e0c440e77c96a67a72593b2ef19e5d66f3a929529f3ca56eb4207eb0853d";

const STARKMINT_FACTORY =
  "0xd26cc09636f19496e1f605bebc66e1d5060077b9306c4306fb993439968ac9";

const GUILD_REGISTRY =
  "0x4de9613ddf42d102534bb34b1ba4527d075745bc5158050237de183b87084b0";

// ── Helpers ─────────────────────────────────────────────────────────────

const provider = new RpcProvider({ nodeUrl: RPC_URL });
const account = new Account({
  provider,
  address: DEPLOYER_ADDRESS,
  signer: DEPLOYER_PRIVATE_KEY,
});

function strk(amount: number): bigint {
  return BigInt(Math.floor(amount * 1e18));
}

function descHash(text: string): bigint {
  // Use short string encoding for description hashes (max 31 chars)
  const trimmed = text.slice(0, 31).replace(/[^\x20-\x7E]/g, "");
  return BigInt(shortString.encodeShortString(trimmed));
}

async function exec(label: string, calls: Call[]): Promise<string> {
  console.log(`  ${label}...`);
  try {
    const result = await account.execute(calls);
    console.log(`    tx: ${result.transaction_hash}`);
    await provider.waitForTransaction(result.transaction_hash);
    console.log(`    confirmed`);
    return result.transaction_hash;
  } catch (err) {
    console.error(`    FAILED: ${(err as Error).message}`);
    throw err;
  }
}

// ── Seed: ProveWork Tasks ──────────────────────────────────────────────

interface TaskDef {
  description: string;
  reward: number; // STRK
  deadlineDays: number;
  validators: number;
}

const TASKS: TaskDef[] = [
  {
    description: "Forecast BTC price Q2 2026",
    reward: 25,
    deadlineDays: 14,
    validators: 2,
  },
  {
    description: "Build Tavily data connector",
    reward: 50,
    deadlineDays: 30,
    validators: 3,
  },
  {
    description: "Audit bonding curve math",
    reward: 75,
    deadlineDays: 21,
    validators: 3,
  },
  {
    description: "Train sentiment classifier",
    reward: 30,
    deadlineDays: 7,
    validators: 1,
  },
];

async function seedTasks() {
  console.log("\n--- Seeding ProveWork Tasks ---");

  for (const task of TASKS) {
    const rewardWei = strk(task.reward);
    const deadline = Math.floor(Date.now() / 1000) + task.deadlineDays * 86400;

    // Approve STRK transfer to escrow, then post_task
    const calls: Call[] = [
      {
        contractAddress: STRK,
        entrypoint: "approve",
        calldata: CallData.compile({
          spender: TASK_ESCROW,
          amount: { low: rewardWei, high: 0n },
        }),
      },
      {
        contractAddress: TASK_ESCROW,
        entrypoint: "post_task",
        calldata: CallData.compile({
          description_hash: descHash(task.description),
          reward_amount: { low: rewardWei, high: 0n },
          deadline: BigInt(deadline),
          required_validators: task.validators,
        }),
      },
    ];

    await exec(`Task: "${task.description}" (${task.reward} STRK)`, calls);
  }
}

// ── Seed: StarkMint Token Launches ─────────────────────────────────────

interface TokenDef {
  name: string;
  symbol: string;
  curveType: number; // 0=Linear, 1=Quadratic, 2=Sigmoid
  feeBps: number;
  agentId: number;
}

const TOKENS: TokenDef[] = [
  {
    name: "OracleAlpha",
    symbol: "OALPHA",
    curveType: 0, // Linear
    feeBps: 250, // 2.5%
    agentId: 1,
  },
  {
    name: "SentinelBeta",
    symbol: "SBETA",
    curveType: 1, // Quadratic
    feeBps: 300, // 3%
    agentId: 2,
  },
];

async function seedTokens() {
  console.log("\n--- Seeding StarkMint Tokens ---");

  for (const token of TOKENS) {
    const calls: Call[] = [
      {
        contractAddress: STARKMINT_FACTORY,
        entrypoint: "launch_token",
        calldata: CallData.compile({
          name: shortString.encodeShortString(token.name),
          symbol: shortString.encodeShortString(token.symbol),
          curve_type: token.curveType,
          fee_bps: token.feeBps,
          agent_id: { low: BigInt(token.agentId), high: 0n },
        }),
      },
    ];

    await exec(`Token: ${token.name} ($${token.symbol}, curve=${token.curveType})`, calls);
  }
}

// ── Seed: Guild ────────────────────────────────────────────────────────

interface GuildDef {
  name: string;
  minStake: number; // STRK
}

const GUILDS: GuildDef[] = [
  {
    name: "Forecasters",
    minStake: 10,
  },
];

async function seedGuilds() {
  console.log("\n--- Seeding Guilds ---");

  for (const guild of GUILDS) {
    const calls: Call[] = [
      {
        contractAddress: GUILD_REGISTRY,
        entrypoint: "create_guild",
        calldata: CallData.compile({
          name_hash: shortString.encodeShortString(guild.name),
          min_stake: { low: strk(guild.minStake), high: 0n },
        }),
      },
    ];

    await exec(`Guild: "${guild.name}" (min stake: ${guild.minStake} STRK)`, calls);
  }
}

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  console.log("Hicecaster Sepolia Seed Script");
  console.log(`  RPC:      ${RPC_URL}`);
  console.log(`  Deployer: ${DEPLOYER_ADDRESS}`);

  // Check STRK balance
  const balanceResult = await provider.callContract({
    contractAddress: STRK,
    entrypoint: "balance_of",
    calldata: CallData.compile({ account: DEPLOYER_ADDRESS }),
  });
  const balance = Number(BigInt(balanceResult[0])) / 1e18;
  console.log(`  STRK:     ${balance.toFixed(2)}`);

  const requiredStrk = TASKS.reduce((s, t) => s + t.reward, 0) + 10; // tasks + buffer
  if (balance < requiredStrk) {
    console.error(
      `\nInsufficient STRK. Need ~${requiredStrk} STRK, have ${balance.toFixed(2)}.`
    );
    console.error(
      `Faucet: https://blastapi.io/faucets/starknet-sepolia-strk`
    );
    process.exit(1);
  }

  await seedTasks();
  await seedTokens();
  await seedGuilds();

  console.log("\n--- Seed Complete ---");
  console.log("All economy contracts now have real on-chain data.");
  console.log("The listing pages, API routes, and CLI will show live data.\n");
}

main().catch((err) => {
  console.error("\nFatal error:", err.message);
  process.exit(1);
});
