import { RpcProvider, Contract, byteArray } from "starknet";
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
  passport?: {
    schema?: string;
    capabilities: Array<{
      name: string;
      category: string;
      version?: string;
      description?: string;
      endpoint?: string;
      mcpTool?: string;
      a2aSkillId?: string;
    }>;
  };
}

function decodeMetadataValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return byteArray.stringFromByteArray(value as any);
  } catch {
    return String(value);
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
      capsResult,
      schemaResult,
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
        registry.get_metadata(agentId, "caps").catch(() => ""),
        registry.get_metadata(agentId, "passport:schema").catch(() => ""),
        registry.owner_of(agentId).catch(() => "0x0"),
      ]);

    const capabilityNames = (() => {
      try {
        const parsed = JSON.parse(decodeMetadataValue(capsResult));
        if (!Array.isArray(parsed)) return [] as string[];
        return parsed.filter((item) => typeof item === "string") as string[];
      } catch {
        return [] as string[];
      }
    })();

    const capabilityPayloads = await Promise.all(
      capabilityNames.map(async (capName) => {
        try {
          const raw = await registry.get_metadata(agentId, `capability:${capName}`);
          const parsed = JSON.parse(decodeMetadataValue(raw));
          if (!parsed || typeof parsed !== "object") return null;
          return parsed as {
            name: string;
            category: string;
            version?: string;
            description?: string;
            endpoint?: string;
            mcpTool?: string;
            a2aSkillId?: string;
          };
        } catch {
          return null;
        }
      })
    );

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
      name: decodeMetadataValue(nameResult) || "Unknown Agent",
      agentType: decodeMetadataValue(typeResult) || "forecaster",
      model: decodeMetadataValue(modelResult) || "claude-sonnet-4-5",
      status: decodeMetadataValue(statusResult) || "active",
      walletAddress: String(ownerResult),
      framework: frameworkResult ? decodeMetadataValue(frameworkResult) : undefined,
      a2aEndpoint: endpointResult ? decodeMetadataValue(endpointResult) : undefined,
      moltbookId: moltbookResult ? decodeMetadataValue(moltbookResult) : undefined,
      reputationScore,
      feedbackCount,
      passport:
        capabilityPayloads.filter(Boolean).length > 0
          ? {
              schema: decodeMetadataValue(schemaResult) || undefined,
              capabilities: capabilityPayloads.filter(Boolean) as Array<{
                name: string;
                category: string;
                version?: string;
                description?: string;
                endpoint?: string;
                mcpTool?: string;
                a2aSkillId?: string;
              }>,
            }
          : undefined,
    };
  } catch {
    return null;
  }
}

/** Generate A2A-compatible agent card from on-chain identity. */
export async function generateAgentCard(agentId: string, baseUrl: string) {
  const identity = await getAgentIdentity(agentId);
  const fallbackCaps = ["forecast", "predict", "bet", "analyze"];
  const capsFromPassport = identity?.passport?.capabilities.map((cap) => cap.name) ?? [];
  const advertisedCapabilities = capsFromPassport.length > 0 ? capsFromPassport : fallbackCaps;

  return {
    "@context": "https://a2a-protocol.org/schema/1.0",
    type: "Agent",
    id: `${baseUrl}/.well-known/agent.json`,
    name: identity?.name ?? "Prediction Agent",
    description: "AI superforecaster agent on Starknet prediction markets",
    url: baseUrl,
    version: "1.0",
    capabilities: advertisedCapabilities,
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
          agentPassport: identity.passport,
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
