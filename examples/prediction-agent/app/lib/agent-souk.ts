/**
 * AgentSouk — reads ERC-8004 registries to build an agent marketplace view.
 * No new contracts needed — purely reads existing IdentityRegistry + ReputationRegistry.
 */

import { RpcProvider, Contract, byteArray } from "starknet";
import { config } from "./config";

const provider = new RpcProvider({ nodeUrl: config.STARKNET_RPC_URL });

const IDENTITY_ABI = [
  {
    name: "total_agents",
    type: "function",
    inputs: [],
    outputs: [{ type: "core::integer::u256" }],
    state_mutability: "view",
  },
  {
    name: "agent_exists",
    type: "function",
    inputs: [{ name: "agent_id", type: "core::integer::u256" }],
    outputs: [{ type: "core::bool" }],
    state_mutability: "view",
  },
  {
    name: "get_metadata",
    type: "function",
    inputs: [
      { name: "agent_id", type: "core::integer::u256" },
      { name: "key", type: "core::byte_array::ByteArray" },
    ],
    outputs: [{ type: "core::byte_array::ByteArray" }],
    state_mutability: "view",
  },
  {
    name: "owner_of",
    type: "function",
    inputs: [{ name: "token_id", type: "core::integer::u256" }],
    outputs: [{ type: "core::starknet::contract_address::ContractAddress" }],
    state_mutability: "view",
  },
] as const;

const REPUTATION_ABI = [
  {
    name: "get_feedback_count",
    type: "function",
    inputs: [{ name: "agent_id", type: "core::integer::u256" }],
    outputs: [{ type: "core::integer::u256" }],
    state_mutability: "view",
  },
  {
    name: "get_average_score",
    type: "function",
    inputs: [{ name: "agent_id", type: "core::integer::u256" }],
    outputs: [{ type: "core::integer::u8" }],
    state_mutability: "view",
  },
] as const;

// Simple in-memory TTL cache for listRegisteredAgents
const CACHE_TTL_MS = 60_000;
const agentListCache = new Map<string, { data: { agents: SoukAgentProfile[]; total: number }; ts: number }>();

export function clearAgentSoukCache(): void {
  agentListCache.clear();
}

function decode(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return byteArray.stringFromByteArray(value as any);
  } catch {
    return String(value);
  }
}

export interface SoukAgentProfile {
  agentId: number;
  name: string;
  agentType: string;
  model: string;
  status: string;
  capabilities: string;
  framework: string;
  a2aEndpoint: string;
  walletAddress: string;
  reputationScore: number;
  feedbackCount: number;
}

async function fetchAgentProfile(
  registry: any,
  repRegistry: any | null,
  agentId: number
): Promise<SoukAgentProfile | null> {
  try {
    const id = BigInt(agentId);
    const exists = await registry.agent_exists(id).catch(() => false);
    if (!exists) return null;

    const [name, agentType, model, status, capabilities, framework, a2aEndpoint, owner] =
      await Promise.all([
        registry.get_metadata(id, "agentName").catch(() => ""),
        registry.get_metadata(id, "agentType").catch(() => ""),
        registry.get_metadata(id, "model").catch(() => ""),
        registry.get_metadata(id, "status").catch(() => ""),
        registry.get_metadata(id, "capabilities").catch(() => ""),
        registry.get_metadata(id, "framework").catch(() => ""),
        registry.get_metadata(id, "a2aEndpoint").catch(() => ""),
        registry.owner_of(id).catch(() => "0x0"),
      ]);

    let reputationScore = 0;
    let feedbackCount = 0;
    if (repRegistry) {
      try {
        const [score, count] = await Promise.all([
          repRegistry.get_average_score(id),
          repRegistry.get_feedback_count(id),
        ]);
        reputationScore = Number(score);
        feedbackCount = Number(count);
      } catch {
        // ok
      }
    }

    return {
      agentId,
      name: decode(name) || `Agent #${agentId}`,
      agentType: decode(agentType) || "general",
      model: decode(model) || "unknown",
      status: decode(status) || "active",
      capabilities: decode(capabilities),
      framework: decode(framework),
      a2aEndpoint: decode(a2aEndpoint),
      walletAddress: String(owner),
      reputationScore,
      feedbackCount,
    };
  } catch {
    return null;
  }
}

export async function listRegisteredAgents(
  offset = 0,
  limit = 20
): Promise<{ agents: SoukAgentProfile[]; total: number }> {
  const cacheKey = `${offset}:${limit}`;
  const cached = agentListCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }

  const registryAddr = config.IDENTITY_REGISTRY_ADDRESS;
  if (!registryAddr) return { agents: [], total: 0 };

  const registry = new Contract({
    abi: IDENTITY_ABI as any,
    address: registryAddr,
    providerOrAccount: provider,
  });

  const totalRaw = await registry.total_agents().catch(() => 0n);
  const total = Number(totalRaw);

  const repRegistry = config.REPUTATION_REGISTRY_ADDRESS
    ? new Contract({
        abi: REPUTATION_ABI as any,
        address: config.REPUTATION_REGISTRY_ADDRESS,
        providerOrAccount: provider,
      })
    : null;

  // Agent IDs start at 1
  const start = Math.max(1, offset + 1);
  const end = Math.min(total + 1, start + limit);
  const ids = Array.from({ length: end - start }, (_, i) => start + i);

  const profiles = await Promise.all(
    ids.map((id) => fetchAgentProfile(registry, repRegistry, id))
  );

  const result = {
    agents: profiles.filter((p): p is SoukAgentProfile => p !== null),
    total,
  };

  agentListCache.set(cacheKey, { data: result, ts: Date.now() });
  return result;
}

export async function getAgentProfile(agentId: number): Promise<SoukAgentProfile | null> {
  const registryAddr = config.IDENTITY_REGISTRY_ADDRESS;
  if (!registryAddr) return null;

  const registry = new Contract({
    abi: IDENTITY_ABI as any,
    address: registryAddr,
    providerOrAccount: provider,
  });

  const repRegistry = config.REPUTATION_REGISTRY_ADDRESS
    ? new Contract({
        abi: REPUTATION_ABI as any,
        address: config.REPUTATION_REGISTRY_ADDRESS,
        providerOrAccount: provider,
      })
    : null;

  return fetchAgentProfile(registry, repRegistry, agentId);
}
