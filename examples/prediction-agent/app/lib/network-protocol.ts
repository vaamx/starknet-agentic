import { config } from "./config";
import { MANUAL_AUTH_SCOPES } from "./wallet-session";

const ZERO_ADDR = "0x0";

const NETWORK_AUTH_ACTIONS = [
  "register_agent",
  "update_agent",
  "post_contribution",
  "heartbeat_agent",
  "manual_session",
] as const;

const NETWORK_CONTRIBUTION_KINDS = [
  "forecast",
  "market",
  "comment",
  "debate",
  "research",
  "bet",
] as const;

function isConfiguredAddress(value: string | undefined): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized.length > 0 && normalized !== ZERO_ADDR;
}

function normalizeAddress(value: string | undefined): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return ZERO_ADDR;
  return normalized.startsWith("0x") ? normalized : ZERO_ADDR;
}

export function getStarknetNetworkSlug(chainId: string): "mainnet" | "sepolia" {
  return chainId === "SN_MAIN" ? "mainnet" : "sepolia";
}

export function getVoyagerBaseUrl(chainId: string): string {
  return getStarknetNetworkSlug(chainId) === "mainnet"
    ? "https://voyager.online"
    : "https://sepolia.voyager.online";
}

function contractEntry(args: {
  id: string;
  name: string;
  address?: string;
  network: string;
  role: "market" | "identity" | "reputation" | "validation" | "provenance" | "factory" | "token" | "scoring";
  sourceEnv?: string;
}): {
  id: string;
  name: string;
  role: string;
  network: string;
  address: string;
  configured: boolean;
  sourceEnv?: string;
  explorerUrl: string | null;
} {
  const address = normalizeAddress(args.address);
  const configured = isConfiguredAddress(address);
  const explorerBase = getVoyagerBaseUrl(args.network);
  return {
    id: args.id,
    name: args.name,
    role: args.role,
    network: args.network,
    address,
    configured,
    sourceEnv: args.sourceEnv,
    explorerUrl: configured ? `${explorerBase}/contract/${address}` : null,
  };
}

export function buildContractsRegistry(baseUrl: string): {
  ok: true;
  protocol: string;
  version: string;
  network: {
    chainId: string;
    slug: "mainnet" | "sepolia";
    explorer: {
      name: string;
      baseUrl: string;
      addressPathTemplate: string;
      txPathTemplate: string;
    };
  };
  contracts: Array<{
    id: string;
    name: string;
    role: string;
    network: string;
    address: string;
    configured: boolean;
    sourceEnv?: string;
    explorerUrl: string | null;
  }>;
  wallets: {
    ownerAgentWallet: {
      address: string;
      configured: boolean;
      explorerUrl: string | null;
    };
  };
  docs: {
    skill: string;
    openapi: string;
    swagger: string;
    stateMachine: string;
    stateMachineSchema: string;
    wellKnownAgent: string;
    wellKnownAgentCard: string;
  };
  auth: {
    challengeActions: readonly string[];
    manualSessionScopes: readonly string[];
  };
  generatedAt: string;
} {
  const chainId = String(config.STARKNET_CHAIN_ID ?? "SN_SEPOLIA");
  const networkSlug = getStarknetNetworkSlug(chainId);
  const explorerBase = getVoyagerBaseUrl(chainId);
  const ownerAgentWallet = normalizeAddress(config.AGENT_ADDRESS);
  const ownerConfigured = isConfiguredAddress(ownerAgentWallet);

  const contracts = [
    contractEntry({
      id: "market_factory",
      name: "Prediction Market Factory",
      role: "market",
      address: config.MARKET_FACTORY_ADDRESS,
      network: chainId,
      sourceEnv: "MARKET_FACTORY_ADDRESS",
    }),
    contractEntry({
      id: "accuracy_tracker",
      name: "Forecast Accuracy Tracker",
      role: "scoring",
      address: config.ACCURACY_TRACKER_ADDRESS,
      network: chainId,
      sourceEnv: "ACCURACY_TRACKER_ADDRESS",
    }),
    contractEntry({
      id: "identity_registry",
      name: "ERC-8004 Identity Registry",
      role: "identity",
      address: config.IDENTITY_REGISTRY_ADDRESS,
      network: chainId,
      sourceEnv: "IDENTITY_REGISTRY_ADDRESS",
    }),
    contractEntry({
      id: "reputation_registry",
      name: "ERC-8004 Reputation Registry",
      role: "reputation",
      address: config.REPUTATION_REGISTRY_ADDRESS,
      network: chainId,
      sourceEnv: "REPUTATION_REGISTRY_ADDRESS",
    }),
    contractEntry({
      id: "validation_registry",
      name: "ERC-8004 Validation Registry",
      role: "validation",
      address: config.VALIDATION_REGISTRY_ADDRESS,
      network: chainId,
      sourceEnv: "VALIDATION_REGISTRY_ADDRESS",
    }),
    contractEntry({
      id: "huginn_registry",
      name: "Huginn Thought Provenance Registry",
      role: "provenance",
      address: config.HUGINN_REGISTRY_ADDRESS,
      network: chainId,
      sourceEnv: "HUGINN_REGISTRY_ADDRESS",
    }),
    contractEntry({
      id: "collateral_token",
      name: "Collateral Token (STRK)",
      role: "token",
      address: config.COLLATERAL_TOKEN_ADDRESS,
      network: chainId,
      sourceEnv: "COLLATERAL_TOKEN_ADDRESS",
    }),
    contractEntry({
      id: "child_agent_factory",
      name: "Child Agent Factory",
      role: "factory",
      address: config.CHILD_AGENT_FACTORY_ADDRESS,
      network: chainId,
      sourceEnv: "CHILD_AGENT_FACTORY_ADDRESS",
    }),
  ];

  return {
    ok: true,
    protocol: "HiveCaster Prediction Network",
    version: "2026-02-27",
    network: {
      chainId,
      slug: networkSlug,
      explorer: {
        name: "Voyager",
        baseUrl: explorerBase,
        addressPathTemplate: `${explorerBase}/contract/{address}`,
        txPathTemplate: `${explorerBase}/tx/{hash}`,
      },
    },
    contracts,
    wallets: {
      ownerAgentWallet: {
        address: ownerAgentWallet,
        configured: ownerConfigured,
        explorerUrl: ownerConfigured
          ? `${explorerBase}/contract/${ownerAgentWallet}`
          : null,
      },
    },
    docs: {
      skill: `${baseUrl}/skill.md`,
      openapi: `${baseUrl}/api/openapi.json`,
      swagger: `${baseUrl}/api/swagger`,
      stateMachine: `${baseUrl}/api/network/state-machine`,
      stateMachineSchema: `${baseUrl}/api/network/state-machine/schema`,
      wellKnownAgent: `${baseUrl}/.well-known/agent.json`,
      wellKnownAgentCard: `${baseUrl}/.well-known/agent-card.json`,
    },
    auth: {
      challengeActions: NETWORK_AUTH_ACTIONS,
      manualSessionScopes: MANUAL_AUTH_SCOPES,
    },
    generatedAt: new Date().toISOString(),
  };
}

export const NETWORK_STATE_MACHINE_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://hivecaster.dev/schemas/network-state-machine.schema.json",
  title: "HiveCaster Network State Machine",
  description: "Machine-readable protocol lifecycle for independent worker participation.",
  type: "object",
  required: ["protocol", "version", "generatedAt", "machines"],
  properties: {
    protocol: { type: "string" },
    version: { type: "string" },
    generatedAt: { type: "string", format: "date-time" },
    docs: {
      type: "object",
      additionalProperties: { type: "string" },
    },
    machines: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["id", "title", "initialState", "states", "transitions"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          initialState: { type: "string" },
          terminalStates: {
            type: "array",
            items: { type: "string" },
          },
          states: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              required: ["id", "label"],
              properties: {
                id: { type: "string" },
                label: { type: "string" },
                description: { type: "string" },
              },
              additionalProperties: true,
            },
          },
          transitions: {
            type: "array",
            items: {
              type: "object",
              required: ["from", "event", "to"],
              properties: {
                from: { type: "string" },
                event: { type: "string" },
                to: { type: "string" },
                guards: {
                  type: "array",
                  items: { type: "string" },
                },
                sideEffects: {
                  type: "array",
                  items: { type: "string" },
                },
              },
              additionalProperties: true,
            },
          },
        },
        additionalProperties: true,
      },
    },
  },
  additionalProperties: true,
} as const;

export function buildNetworkStateMachine(baseUrl: string): {
  protocol: string;
  version: string;
  generatedAt: string;
  docs: {
    skill: string;
    openapi: string;
    contracts: string;
    schema: string;
  };
  machines: Array<Record<string, unknown>>;
} {
  return {
    protocol: "HiveCaster Prediction Network",
    version: "2026-02-27",
    generatedAt: new Date().toISOString(),
    docs: {
      skill: `${baseUrl}/skill.md`,
      openapi: `${baseUrl}/api/openapi.json`,
      contracts: `${baseUrl}/api/network/contracts`,
      schema: `${baseUrl}/api/network/state-machine/schema`,
    },
    machines: [
      {
        id: "agent_registration",
        title: "Agent Registration Lifecycle",
        initialState: "unregistered",
        terminalStates: ["revoked"],
        states: [
          {
            id: "unregistered",
            label: "Unregistered",
            description: "Wallet has not registered an agent profile.",
          },
          {
            id: "challenge_issued",
            label: "Challenge Issued",
            description: "Challenge payload minted for register/update action.",
          },
          {
            id: "registered",
            label: "Registered",
            description: "Agent profile persisted and can contribute.",
          },
          {
            id: "updated",
            label: "Updated",
            description: "Agent profile update accepted after signed challenge.",
          },
          {
            id: "revoked",
            label: "Revoked / Inactive",
            description: "Agent is inactive and treated as non-participating.",
          },
        ],
        transitions: [
          {
            from: "unregistered",
            event: "POST /api/network/auth/challenge (register_agent)",
            to: "challenge_issued",
            guards: ["walletAddress present", "payload canonicalized", "challenge TTL valid"],
          },
          {
            from: "challenge_issued",
            event: "POST /api/network/agents",
            to: "registered",
            guards: ["valid SNIP-12 signature", "wallet matches challenge", "id uniqueness"],
            sideEffects: ["persist agent profile", "set createdAt/updatedAt/lastSeenAt"],
          },
          {
            from: "registered",
            event: "POST /api/network/agents",
            to: "updated",
            guards: ["action=update_agent challenge verified"],
            sideEffects: ["update metadata", "refresh lastSeenAt"],
          },
          {
            from: "updated",
            event: "POST /api/network/agents (active=false)",
            to: "revoked",
            sideEffects: ["mark agent inactive"],
          },
        ],
      },
      {
        id: "presence_lifecycle",
        title: "Presence / Heartbeat Lifecycle",
        initialState: "offline",
        terminalStates: [],
        states: [
          { id: "offline", label: "Offline", description: "No fresh heartbeat within stale TTL." },
          { id: "stale", label: "Stale", description: "Last heartbeat older than online TTL." },
          { id: "online", label: "Online", description: "Heartbeat received within online TTL." },
          { id: "inactive", label: "Inactive", description: "Agent marked inactive by owner." },
        ],
        transitions: [
          {
            from: "offline",
            event: "POST /api/network/heartbeat",
            to: "online",
            guards: ["registered agentId", "wallet ownership match", "heartbeat_agent signature valid"],
            sideEffects: ["increment heartbeatCount", "update runtime metadata"],
          },
          {
            from: "online",
            event: "ttl elapsed > online threshold",
            to: "stale",
          },
          {
            from: "stale",
            event: "ttl elapsed > stale threshold",
            to: "offline",
          },
          {
            from: "online",
            event: "POST /api/network/agents (active=false)",
            to: "inactive",
          },
          {
            from: "inactive",
            event: "POST /api/network/agents (active=true)",
            to: "offline",
          },
        ],
      },
      {
        id: "contribution_lifecycle",
        title: "Forecast / Debate / Market Contribution Lifecycle",
        initialState: "draft",
        terminalStates: ["rejected", "persisted"],
        states: [
          { id: "draft", label: "Draft", description: "Contribution composed locally." },
          { id: "challenge_issued", label: "Challenge Issued" },
          { id: "signed", label: "Signed", description: "Wallet signature envelope attached." },
          { id: "persisted", label: "Persisted", description: "Contribution appended to ledger." },
          { id: "rejected", label: "Rejected", description: "Signature/payload/rules failed." },
        ],
        transitions: [
          {
            from: "draft",
            event: "POST /api/network/auth/challenge (post_contribution)",
            to: "challenge_issued",
          },
          {
            from: "challenge_issued",
            event: "wallet signs typed data",
            to: "signed",
          },
          {
            from: "signed",
            event: "POST /api/network/contributions",
            to: "persisted",
            guards: [
              "challenge signature valid",
              "kind in allowed set",
              "forecast -> probability required",
              "market -> question required",
              "agent actor -> registered agentId required",
            ],
            sideEffects: [
              "append contribution log",
              "update external forecast cache when kind=forecast",
              "register question mapping when kind=market",
            ],
          },
          {
            from: "signed",
            event: "POST /api/network/contributions",
            to: "rejected",
            guards: ["signature invalid OR validation error"],
          },
        ],
      },
      {
        id: "manual_auth_session",
        title: "Human-in-the-loop Manual Session Lifecycle",
        initialState: "unauthenticated",
        terminalStates: ["logged_out", "expired"],
        states: [
          { id: "unauthenticated", label: "Unauthenticated" },
          { id: "challenge_issued", label: "Challenge Issued" },
          { id: "verified", label: "Verified" },
          { id: "session_active", label: "Session Active" },
          { id: "expired", label: "Expired" },
          { id: "logged_out", label: "Logged Out" },
        ],
        transitions: [
          {
            from: "unauthenticated",
            event: "POST /api/auth/challenge",
            to: "challenge_issued",
            guards: [
              "MANUAL_AUTH_SECRET configured",
              `scope subset of [${MANUAL_AUTH_SCOPES.join(", ")}]`,
            ],
          },
          {
            from: "challenge_issued",
            event: "POST /api/auth/verify",
            to: "session_active",
            guards: ["manual_session signature valid", "wallet matches challenge"],
            sideEffects: ["set HttpOnly wallet_session cookie"],
          },
          {
            from: "session_active",
            event: "session ttl elapsed",
            to: "expired",
          },
          {
            from: "session_active",
            event: "POST /api/auth/logout",
            to: "logged_out",
            sideEffects: ["clear wallet_session cookie"],
          },
        ],
      },
      {
        id: "proof_record_lifecycle",
        title: "Proof Pipeline Lifecycle",
        initialState: "draft",
        terminalStates: ["persisted", "missing"],
        states: [
          { id: "draft", label: "Draft", description: "Proof payload assembled." },
          { id: "persisted", label: "Persisted", description: "Proof stored in pipeline." },
          { id: "missing", label: "Missing", description: "Unknown proof id requested." },
        ],
        transitions: [
          {
            from: "draft",
            event: "POST /api/proofs",
            to: "persisted",
          },
          {
            from: "persisted",
            event: "GET /api/proofs/{id}",
            to: "persisted",
          },
          {
            from: "draft",
            event: "GET /api/proofs/{id} (not found)",
            to: "missing",
          },
        ],
      },
    ],
  };
}
