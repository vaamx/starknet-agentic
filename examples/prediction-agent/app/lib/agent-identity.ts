import { RpcProvider, Contract, shortString } from "starknet";
import { config } from "./config";

const provider = new RpcProvider({ nodeUrl: config.STARKNET_RPC_URL });

// Simplified ABI for ERC-8004 IdentityRegistry
const IDENTITY_REGISTRY_ABI = [
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

const REPUTATION_REGISTRY_ABI = [
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

export interface AgentIdentity {
  agentId: string;
  name: string;
  agentType: string;
  model: string;
  status: string;
  walletAddress: string;
  framework?: string;
  a2aEndpoint?: string;
  moltbookId?: string;
  reputationScore: number;
  feedbackCount: number;
}

function feltToString(felt: bigint): string {
  try {
    return shortString.decodeShortString("0x" + felt.toString(16));
  } catch {
    return "";
  }
}

/** Fetch agent identity from ERC-8004 IdentityRegistry. */
export async function getAgentIdentity(agentId: string): Promise<AgentIdentity | null> {
  const registryAddr = config.IDENTITY_REGISTRY_ADDRESS;
  if (!registryAddr) return null;

  try {
    const registry = new Contract({ abi: IDENTITY_REGISTRY_ABI as any, address: registryAddr, providerOrAccount: provider });

    const [
      nameResult,
      typeResult,
      modelResult,
      statusResult,
      frameworkResult,
      endpointResult,
      moltbookResult,
      ownerResult,
    ] =
      await Promise.all([
        registry.get_metadata(agentId, "agentName").catch(() => ""),
        registry.get_metadata(agentId, "agentType").catch(() => ""),
        registry.get_metadata(agentId, "model").catch(() => ""),
        registry.get_metadata(agentId, "status").catch(() => ""),
        registry.get_metadata(agentId, "framework").catch(() => ""),
        registry.get_metadata(agentId, "a2aEndpoint").catch(() => ""),
        registry.get_metadata(agentId, "moltbookId").catch(() => ""),
        registry.owner_of(agentId).catch(() => "0x0"),
      ]);

    let reputationScore = 0;
    let feedbackCount = 0;

    if (config.REPUTATION_REGISTRY_ADDRESS) {
      const repRegistry = new Contract({
        abi: REPUTATION_REGISTRY_ABI as any,
        address: config.REPUTATION_REGISTRY_ADDRESS,
        providerOrAccount: provider,
      });
      try {
        const [score, count] = await Promise.all([
          repRegistry.get_average_score(agentId),
          repRegistry.get_feedback_count(agentId),
        ]);
        reputationScore = Number(score);
        feedbackCount = Number(count);
      } catch {
        // Reputation registry may not be deployed
      }
    }

    return {
      agentId,
      name: String(nameResult || "Unknown Agent"),
      agentType: String(typeResult || "forecaster"),
      model: String(modelResult || "claude-sonnet-4-5"),
      status: String(statusResult || "active"),
      walletAddress: String(ownerResult),
      framework: frameworkResult ? String(frameworkResult) : undefined,
      a2aEndpoint: endpointResult ? String(endpointResult) : undefined,
      moltbookId: moltbookResult ? String(moltbookResult) : undefined,
      reputationScore,
      feedbackCount,
    };
  } catch {
    return null;
  }
}

/** Generate A2A-compatible agent card from on-chain identity. */
export async function generateAgentCard(agentId: string, baseUrl: string) {
  const identity = await getAgentIdentity(agentId);

  return {
    "@context": "https://a2a-protocol.org/schema/1.0",
    type: "Agent",
    id: `${baseUrl}/.well-known/agent.json`,
    name: identity?.name ?? "Prediction Agent",
    description: "AI superforecaster agent on Starknet prediction markets",
    url: baseUrl,
    version: "1.0",
    capabilities: ["forecast", "predict", "bet", "analyze"],
    identity: identity
      ? {
          starknet: {
            registryAddress: config.IDENTITY_REGISTRY_ADDRESS,
            agentId: identity.agentId,
            reputationScore: identity.reputationScore,
            feedbackCount: identity.feedbackCount,
            walletAddress: identity.walletAddress,
          },
          framework: identity.framework,
          a2aEndpoint: identity.a2aEndpoint,
          moltbookId: identity.moltbookId,
        }
      : undefined,
    endpoints: {
      predict: `${baseUrl}/api/predict`,
      markets: `${baseUrl}/api/markets`,
      leaderboard: `${baseUrl}/api/leaderboard`,
      status: `${baseUrl}/api/status`,
    },
  };
}
