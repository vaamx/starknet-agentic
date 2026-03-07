/**
 * Economy Reader — on-chain reads for TaskEscrow, StarkMintFactory, BondingCurve, GuildRegistry, GuildDAO.
 * Follows the same pattern as agent-souk.ts: minimal ABIs, RpcProvider, TTL cache.
 */

import { RpcProvider, Contract, shortString } from "starknet";
import { config } from "./config";

// ── Deployed addresses (Sepolia) ────────────────────────────────────────────

const DEPLOYED = {
  TASK_ESCROW:
    process.env.TASK_ESCROW_ADDRESS ??
    "0x715e0c440e77c96a67a72593b2ef19e5d66f3a929529f3ca56eb4207eb0853d",
  STARKMINT_FACTORY:
    process.env.STARKMINT_FACTORY_ADDRESS ??
    "0xd26cc09636f19496e1f605bebc66e1d5060077b9306c4306fb993439968ac9",
  GUILD_REGISTRY:
    process.env.GUILD_REGISTRY_ADDRESS ??
    "0x4de9613ddf42d102534bb34b1ba4527d075745bc5158050237de183b87084b0",
  GUILD_DAO:
    process.env.GUILD_DAO_ADDRESS ??
    "0x6fd9b3a781bed426d7d0601e1fb2a62dcbc7342b3d5a5b92258953256b87992",
  STRK_TOKEN:
    "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
} as const;

export { DEPLOYED as ECONOMY_ADDRESSES };

const provider = new RpcProvider({ nodeUrl: config.STARKNET_RPC_URL });

// ── Status enums (match Cairo contract order) ───────────────────────────────

const TASK_STATUS_MAP = ["open", "assigned", "submitted", "approved", "disputed", "cancelled", "settled"] as const;
const CURVE_TYPE_MAP = ["linear", "quadratic", "sigmoid"] as const;
const PROPOSAL_STATUS_MAP = ["active", "passed", "rejected", "executed", "cancelled"] as const;

function mapEnum<T extends readonly string[]>(val: unknown, map: T): T[number] {
  const idx = Number(val);
  return map[idx] ?? map[0];
}

// ── Minimal ABIs ────────────────────────────────────────────────────────────

const TASK_ESCROW_ABI = [
  {
    name: "get_task_count",
    type: "function",
    inputs: [],
    outputs: [{ type: "core::integer::u256" }],
    state_mutability: "view",
  },
  {
    name: "get_task",
    type: "function",
    inputs: [{ name: "task_id", type: "core::integer::u256" }],
    outputs: [
      {
        type: "(core::starknet::contract_address::ContractAddress, core::felt252, core::integer::u256, core::integer::u64, core::integer::u8, core::integer::u8, core::starknet::contract_address::ContractAddress, core::felt252, core::integer::u64)",
      },
    ],
    state_mutability: "view",
  },
  {
    name: "get_bid_count",
    type: "function",
    inputs: [{ name: "task_id", type: "core::integer::u256" }],
    outputs: [{ type: "core::integer::u256" }],
    state_mutability: "view",
  },
  {
    name: "get_bid",
    type: "function",
    inputs: [
      { name: "task_id", type: "core::integer::u256" },
      { name: "index", type: "core::integer::u256" },
    ],
    outputs: [
      {
        type: "(core::starknet::contract_address::ContractAddress, core::integer::u256, core::integer::u64)",
      },
    ],
    state_mutability: "view",
  },
] as const;

const STARKMINT_FACTORY_ABI = [
  {
    name: "get_launch_count",
    type: "function",
    inputs: [],
    outputs: [{ type: "core::integer::u256" }],
    state_mutability: "view",
  },
  {
    name: "get_launch",
    type: "function",
    inputs: [{ name: "index", type: "core::integer::u256" }],
    outputs: [
      {
        type: "(core::starknet::contract_address::ContractAddress, core::starknet::contract_address::ContractAddress, core::starknet::contract_address::ContractAddress, core::integer::u8, core::integer::u256, core::integer::u64)",
      },
    ],
    state_mutability: "view",
  },
] as const;

const BONDING_CURVE_ABI = [
  {
    name: "get_current_supply",
    type: "function",
    inputs: [],
    outputs: [{ type: "core::integer::u256" }],
    state_mutability: "view",
  },
  {
    name: "get_reserve_balance",
    type: "function",
    inputs: [],
    outputs: [{ type: "core::integer::u256" }],
    state_mutability: "view",
  },
  {
    name: "get_curve_type",
    type: "function",
    inputs: [],
    outputs: [{ type: "core::integer::u8" }],
    state_mutability: "view",
  },
  {
    name: "get_fee_bps",
    type: "function",
    inputs: [],
    outputs: [{ type: "core::integer::u16" }],
    state_mutability: "view",
  },
  {
    name: "get_buy_price",
    type: "function",
    inputs: [{ name: "amount", type: "core::integer::u256" }],
    outputs: [{ type: "core::integer::u256" }],
    state_mutability: "view",
  },
] as const;

const ERC20_ABI = [
  {
    name: "name",
    type: "function",
    inputs: [],
    outputs: [{ type: "core::byte_array::ByteArray" }],
    state_mutability: "view",
  },
  {
    name: "symbol",
    type: "function",
    inputs: [],
    outputs: [{ type: "core::byte_array::ByteArray" }],
    state_mutability: "view",
  },
] as const;

const GUILD_REGISTRY_ABI = [
  {
    name: "get_guild_count",
    type: "function",
    inputs: [],
    outputs: [{ type: "core::integer::u256" }],
    state_mutability: "view",
  },
  {
    name: "get_guild",
    type: "function",
    inputs: [{ name: "guild_id", type: "core::integer::u256" }],
    outputs: [
      {
        type: "(core::starknet::contract_address::ContractAddress, core::felt252, core::integer::u256, core::integer::u32, core::integer::u256, core::integer::u64)",
      },
    ],
    state_mutability: "view",
  },
  {
    name: "get_member_stake",
    type: "function",
    inputs: [
      { name: "guild_id", type: "core::integer::u256" },
      { name: "member", type: "core::starknet::contract_address::ContractAddress" },
    ],
    outputs: [{ type: "core::integer::u256" }],
    state_mutability: "view",
  },
] as const;

const GUILD_DAO_ABI = [
  {
    name: "get_proposal_count",
    type: "function",
    inputs: [],
    outputs: [{ type: "core::integer::u256" }],
    state_mutability: "view",
  },
  {
    name: "get_proposal",
    type: "function",
    inputs: [{ name: "proposal_id", type: "core::integer::u256" }],
    outputs: [
      {
        type: "(core::starknet::contract_address::ContractAddress, core::felt252, core::integer::u256, core::integer::u256, core::integer::u256, core::integer::u64, core::integer::u8, core::integer::u64)",
      },
    ],
    state_mutability: "view",
  },
] as const;

// ── TTL cache ───────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { data: unknown; ts: number }>();

function cached<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL_MS) {
    return Promise.resolve(entry.data as T);
  }
  return fetcher().then((data) => {
    cache.set(key, { data, ts: Date.now() });
    return data;
  });
}

export function clearEconomyCache(): void {
  cache.clear();
}

// ── Shared helpers ──────────────────────────────────────────────────────────

function felt252ToString(val: unknown): string {
  try {
    return shortString.decodeShortString(String(val));
  } catch {
    return String(val);
  }
}

function toStrk(wei: bigint | unknown): number {
  return Number(BigInt(String(wei))) / 1e18;
}

function toHex(val: unknown): string {
  const n = BigInt(String(val));
  return "0x" + n.toString(16).padStart(2, "0");
}

// ── TaskEscrow Reader ───────────────────────────────────────────────────────

export interface OnChainTask {
  taskId: string;
  descriptionHash: string;
  status: string;
  rewardStrk: number;
  poster: string;
  assignee: string | null;
  deadline: number;
  requiredValidators: number;
  createdAt: number;
  proofHash: string | null;
  bidsCount: number;
}

export interface OnChainTaskDetail extends OnChainTask {
  bids: { bidder: string; amount: number; timestamp: number }[];
}

export async function getTaskCount(): Promise<number> {
  return cached("task_count", async () => {
    const contract = new Contract({
      abi: TASK_ESCROW_ABI as any,
      address: DEPLOYED.TASK_ESCROW,
      providerOrAccount: provider,
    });
    const count = await contract.get_task_count();
    return Number(count);
  });
}

async function readRawTask(taskId: number): Promise<OnChainTask | null> {
  try {
    const contract = new Contract({
      abi: TASK_ESCROW_ABI as any,
      address: DEPLOYED.TASK_ESCROW,
      providerOrAccount: provider,
    });
    const id = BigInt(taskId);
    const [raw, bidCount] = await Promise.all([
      contract.get_task(id),
      contract.get_bid_count(id),
    ]);

    // get_task returns a struct flattened as a tuple
    // (poster, description_hash, reward_amount, deadline, required_validators, status, assignee, proof_hash, created_at)
    const poster = toHex(raw[0]);
    const descriptionHash = toHex(raw[1]);
    const rewardStrk = toStrk(raw[2]);
    const deadline = Number(raw[3]);
    const requiredValidators = Number(raw[4]);
    const status = mapEnum(raw[5], TASK_STATUS_MAP);
    const assignee = toHex(raw[6]);
    const proofHash = toHex(raw[7]);
    const createdAt = Number(raw[8]);

    return {
      taskId: String(taskId),
      descriptionHash,
      status,
      rewardStrk,
      poster,
      assignee: assignee === "0x00" ? null : assignee,
      deadline,
      requiredValidators,
      createdAt,
      proofHash: proofHash === "0x00" ? null : proofHash,
      bidsCount: Number(bidCount),
    };
  } catch {
    return null;
  }
}

export async function listTasks(offset = 0, limit = 20, statusFilter?: string): Promise<{ tasks: OnChainTask[]; total: number }> {
  return cached(`tasks:${offset}:${limit}:${statusFilter ?? "all"}`, async () => {
    const total = await getTaskCount();
    if (total === 0) return { tasks: [], total: 0 };

    // Task IDs are 0-indexed in the contract (first task = 0)
    const ids = Array.from({ length: total }, (_, i) => i);
    const tasks = (await Promise.all(ids.map(readRawTask))).filter(
      (t): t is OnChainTask => t !== null
    );

    let filtered = tasks;
    if (statusFilter && statusFilter !== "all") {
      filtered = tasks.filter((t) => t.status === statusFilter);
    }

    return {
      tasks: filtered.slice(offset, offset + limit),
      total: filtered.length,
    };
  });
}

export async function getTaskDetail(taskId: number): Promise<OnChainTaskDetail | null> {
  return cached(`task_detail:${taskId}`, async () => {
    const task = await readRawTask(taskId);
    if (!task) return null;

    const contract = new Contract({
      abi: TASK_ESCROW_ABI as any,
      address: DEPLOYED.TASK_ESCROW,
      providerOrAccount: provider,
    });

    const bids: OnChainTaskDetail["bids"] = [];
    for (let i = 0; i < task.bidsCount; i++) {
      try {
        const bid = await contract.get_bid(BigInt(taskId), BigInt(i));
        bids.push({
          bidder: toHex(bid[0]),
          amount: toStrk(bid[1]),
          timestamp: Number(bid[2]),
        });
      } catch {
        break;
      }
    }

    return { ...task, bids };
  });
}

// ── StarkMint Reader ────────────────────────────────────────────────────────

export interface OnChainToken {
  id: string;
  tokenAddress: string;
  curveAddress: string;
  name: string;
  symbol: string;
  curveType: string;
  currentPrice: number;
  totalSupply: number;
  reserveBalance: number;
  feeBps: number;
  creator: string;
  createdAt: number;
  agentId: number;
}

export async function getLaunchCount(): Promise<number> {
  return cached("launch_count", async () => {
    const factory = new Contract({
      abi: STARKMINT_FACTORY_ABI as any,
      address: DEPLOYED.STARKMINT_FACTORY,
      providerOrAccount: provider,
    });
    const count = await factory.get_launch_count();
    return Number(count);
  });
}

async function readLaunch(index: number): Promise<OnChainToken | null> {
  try {
    const factory = new Contract({
      abi: STARKMINT_FACTORY_ABI as any,
      address: DEPLOYED.STARKMINT_FACTORY,
      providerOrAccount: provider,
    });

    // get_launch returns: (token, curve, creator, curve_type, agent_id, created_at)
    const raw = await factory.get_launch(BigInt(index));
    const tokenAddress = toHex(raw[0]);
    const curveAddress = toHex(raw[1]);
    const creator = toHex(raw[2]);
    const curveType = mapEnum(raw[3], CURVE_TYPE_MAP);
    const agentId = Number(raw[4]);
    const createdAt = Number(raw[5]);

    // Read token name/symbol (OZ ERC20 returns ByteArray, starknet.js decodes to string)
    const tokenContract = new Contract({
      abi: ERC20_ABI as any,
      address: tokenAddress,
      providerOrAccount: provider,
    });
    const [nameRaw, symbolRaw] = await Promise.all([
      tokenContract.name().catch(() => "Unknown"),
      tokenContract.symbol().catch(() => "???"),
    ]);
    // starknet.js v8 decodes ByteArray to string automatically
    const name = typeof nameRaw === "string" ? nameRaw : felt252ToString(nameRaw);
    const symbol = typeof symbolRaw === "string" ? symbolRaw : felt252ToString(symbolRaw);

    // Read curve data
    const curve = new Contract({
      abi: BONDING_CURVE_ABI as any,
      address: curveAddress,
      providerOrAccount: provider,
    });
    const [supply, reserve, feeBps, spotPriceRaw] = await Promise.all([
      curve.get_current_supply().catch(() => 0n),
      curve.get_reserve_balance().catch(() => 0n),
      curve.get_fee_bps().catch(() => 0),
      // Marginal price: cost of 1 wei of token = spot price.
      // Since 1 token = 1e18 wei and 1 STRK = 1e18 wei, the raw value
      // in wei_reserve/wei_token equals the price in STRK/token.
      curve.get_buy_price(1n).catch(() => 0n),
    ]);

    // Spot price: Number(get_buy_price(1)) gives wei_reserve per wei_token.
    // For quadratic at 0 supply this is 0 (correct — price starts at 0).
    const spotPrice = Number(BigInt(String(spotPriceRaw)));

    return {
      id: `launch-${index}`,
      tokenAddress,
      curveAddress,
      name,
      symbol,
      curveType,
      currentPrice: spotPrice,
      totalSupply: toStrk(supply),
      reserveBalance: toStrk(reserve),
      feeBps: Number(feeBps),
      creator,
      createdAt,
      agentId,
    };
  } catch {
    return null;
  }
}

export async function listTokens(offset = 0, limit = 20, curveFilter?: string): Promise<{ tokens: OnChainToken[]; total: number }> {
  return cached(`tokens:${offset}:${limit}:${curveFilter ?? "all"}`, async () => {
    const total = await getLaunchCount();
    if (total === 0) return { tokens: [], total: 0 };

    const ids = Array.from({ length: total }, (_, i) => i);
    const tokens = (await Promise.all(ids.map(readLaunch))).filter(
      (t): t is OnChainToken => t !== null
    );

    let filtered = tokens;
    if (curveFilter && curveFilter !== "all") {
      filtered = tokens.filter((t) => t.curveType === curveFilter);
    }

    return {
      tokens: filtered.slice(offset, offset + limit),
      total: filtered.length,
    };
  });
}

export async function getTokenDetail(index: number): Promise<OnChainToken | null> {
  return cached(`token_detail:${index}`, async () => {
    return readLaunch(index);
  });
}

// ── Guild Reader ────────────────────────────────────────────────────────────

export interface OnChainGuild {
  guildId: number;
  name: string;
  nameHash: string;
  creator: string;
  memberCount: number;
  totalStaked: number;
  minStake: number;
  createdAt: number;
}

export interface OnChainGuildDetail extends OnChainGuild {
  proposals: OnChainProposal[];
}

export interface OnChainProposal {
  id: number;
  proposer: string;
  descriptionHash: string;
  yesVotes: number;
  noVotes: number;
  quorum: number;
  deadline: number;
  status: string;
  createdAt: number;
}

export async function getGuildCount(): Promise<number> {
  return cached("guild_count", async () => {
    const registry = new Contract({
      abi: GUILD_REGISTRY_ABI as any,
      address: DEPLOYED.GUILD_REGISTRY,
      providerOrAccount: provider,
    });
    const count = await registry.get_guild_count();
    return Number(count);
  });
}

async function readRawGuild(guildId: number): Promise<OnChainGuild | null> {
  try {
    const registry = new Contract({
      abi: GUILD_REGISTRY_ABI as any,
      address: DEPLOYED.GUILD_REGISTRY,
      providerOrAccount: provider,
    });

    // get_guild returns: (creator, name_hash, min_stake, member_count, total_staked, created_at)
    const raw = await registry.get_guild(BigInt(guildId));
    const creator = toHex(raw[0]);
    const nameHash = toHex(raw[1]);
    const minStake = toStrk(raw[2]);
    const memberCount = Number(raw[3]);
    const totalStaked = toStrk(raw[4]);
    const createdAt = Number(raw[5]);

    // Try to decode name_hash as short string (may be a felt252-encoded name)
    const name = felt252ToString(raw[1]);

    return {
      guildId,
      name: name || `Guild #${guildId}`,
      nameHash,
      creator,
      memberCount,
      totalStaked,
      minStake,
      createdAt,
    };
  } catch {
    return null;
  }
}

export async function listGuilds(offset = 0, limit = 20, sort = "members"): Promise<{ guilds: OnChainGuild[]; total: number }> {
  return cached(`guilds:${offset}:${limit}:${sort}`, async () => {
    const total = await getGuildCount();
    if (total === 0) return { guilds: [], total: 0 };

    // Guild IDs start at 1
    const ids = Array.from({ length: total }, (_, i) => i + 1);
    const guilds = (await Promise.all(ids.map(readRawGuild))).filter(
      (g): g is OnChainGuild => g !== null
    );

    guilds.sort((a, b) => {
      if (sort === "staked") return b.totalStaked - a.totalStaked;
      if (sort === "newest") return b.createdAt - a.createdAt;
      return b.memberCount - a.memberCount;
    });

    return {
      guilds: guilds.slice(offset, offset + limit),
      total: guilds.length,
    };
  });
}

export async function getGuildDetail(guildId: number): Promise<OnChainGuildDetail | null> {
  return cached(`guild_detail:${guildId}`, async () => {
    const guild = await readRawGuild(guildId);
    if (!guild) return null;

    // Read proposals from GuildDAO
    const dao = new Contract({
      abi: GUILD_DAO_ABI as any,
      address: DEPLOYED.GUILD_DAO,
      providerOrAccount: provider,
    });

    const proposals: OnChainProposal[] = [];
    try {
      const proposalCount = Number(await dao.get_proposal_count());
      // Read all proposals and filter by guild (we don't have a guild filter in the contract,
      // so we read all — acceptable for small counts on testnet)
      for (let i = 1; i <= proposalCount && i <= 50; i++) {
        try {
          // get_proposal returns: (proposer, description_hash, yes_votes, no_votes, quorum, deadline, status, created_at)
          const raw = await dao.get_proposal(BigInt(i));
          proposals.push({
            id: i,
            proposer: toHex(raw[0]),
            descriptionHash: toHex(raw[1]),
            yesVotes: toStrk(raw[2]),
            noVotes: toStrk(raw[3]),
            quorum: toStrk(raw[4]),
            deadline: Number(raw[5]),
            status: mapEnum(raw[6], PROPOSAL_STATUS_MAP),
            createdAt: Number(raw[7]),
          });
        } catch {
          break;
        }
      }
    } catch {
      // No proposals or DAO not accessible
    }

    return { ...guild, proposals };
  });
}

export async function getProposalCount(): Promise<number> {
  return cached("proposal_count", async () => {
    const dao = new Contract({
      abi: GUILD_DAO_ABI as any,
      address: DEPLOYED.GUILD_DAO,
      providerOrAccount: provider,
    });
    const count = await dao.get_proposal_count();
    return Number(count);
  });
}
