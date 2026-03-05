"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAgentIdentity = getAgentIdentity;
exports.generateAgentCard = generateAgentCard;
exports.getDemoAgentIdentities = getDemoAgentIdentities;
const starknet_1 = require("starknet");
const config_1 = require("./config");
const provider = new starknet_1.RpcProvider({ nodeUrl: config_1.config.STARKNET_RPC_URL });
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
];
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
];
function feltToString(felt) {
    try {
        return starknet_1.shortString.decodeShortString("0x" + felt.toString(16));
    }
    catch {
        return "";
    }
}
/** Fetch agent identity from ERC-8004 IdentityRegistry. */
async function getAgentIdentity(agentId) {
    const registryAddr = config_1.config.IDENTITY_REGISTRY_ADDRESS;
    if (!registryAddr)
        return null;
    try {
        const registry = new starknet_1.Contract(IDENTITY_REGISTRY_ABI, registryAddr, provider);
        const [nameResult, typeResult, modelResult, statusResult, ownerResult] = await Promise.all([
            registry.get_metadata(agentId, "agentName").catch(() => ""),
            registry.get_metadata(agentId, "agentType").catch(() => ""),
            registry.get_metadata(agentId, "model").catch(() => ""),
            registry.get_metadata(agentId, "status").catch(() => ""),
            registry.owner_of(agentId).catch(() => "0x0"),
        ]);
        let reputationScore = 0;
        let feedbackCount = 0;
        if (config_1.config.REPUTATION_REGISTRY_ADDRESS) {
            const repRegistry = new starknet_1.Contract(REPUTATION_REGISTRY_ABI, config_1.config.REPUTATION_REGISTRY_ADDRESS, provider);
            try {
                const [score, count] = await Promise.all([
                    repRegistry.get_average_score(agentId),
                    repRegistry.get_feedback_count(agentId),
                ]);
                reputationScore = Number(score);
                feedbackCount = Number(count);
            }
            catch {
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
            reputationScore,
            feedbackCount,
        };
    }
    catch {
        return null;
    }
}
/** Generate A2A-compatible agent card from on-chain identity. */
async function generateAgentCard(agentId, baseUrl) {
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
                    registryAddress: config_1.config.IDENTITY_REGISTRY_ADDRESS,
                    agentId: identity.agentId,
                    reputationScore: identity.reputationScore,
                    feedbackCount: identity.feedbackCount,
                    walletAddress: identity.walletAddress,
                },
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
/** Demo identity data when contracts aren't deployed. */
function getDemoAgentIdentities() {
    const identities = new Map();
    identities.set("0xAlpha", {
        agentId: "1",
        name: "AlphaForecaster",
        agentType: "superforecaster",
        model: "claude-sonnet-4-5",
        status: "active",
        walletAddress: "0xAlpha",
        reputationScore: 88,
        feedbackCount: 47,
    });
    identities.set("0xBeta", {
        agentId: "2",
        name: "BetaAnalyst",
        agentType: "quant-forecaster",
        model: "claude-sonnet-4-5",
        status: "active",
        walletAddress: "0xBeta",
        reputationScore: 82,
        feedbackCount: 34,
    });
    identities.set("0xGamma", {
        agentId: "3",
        name: "GammaTrader",
        agentType: "market-maker",
        model: "gpt-4o",
        status: "active",
        walletAddress: "0xGamma",
        reputationScore: 75,
        feedbackCount: 28,
    });
    identities.set("0xDelta", {
        agentId: "4",
        name: "DeltaScout",
        agentType: "data-analyst",
        model: "claude-haiku-4-5",
        status: "active",
        walletAddress: "0xDelta",
        reputationScore: 65,
        feedbackCount: 12,
    });
    identities.set("0xEpsilon", {
        agentId: "5",
        name: "EpsilonOracle",
        agentType: "news-analyst",
        model: "gemini-pro",
        status: "active",
        walletAddress: "0xEpsilon",
        reputationScore: 58,
        feedbackCount: 8,
    });
    return identities;
}
