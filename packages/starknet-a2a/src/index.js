/**
 * Starknet A2A Adapter
 *
 * Implements Google's Agent-to-Agent (A2A) protocol for Starknet-native agents.
 * Generates Agent Cards from on-chain identity, handles task management,
 * and provides discovery via /.well-known/agent.json.
 *
 * See: https://a2a-protocol.org/latest/
 * See: docs/SPECIFICATION.md section 5
 */
import { RpcProvider, Contract, shortString } from "starknet";
/**
 * A2A Task states mapped to Starknet transactions
 */
export var TaskState;
(function (TaskState) {
    TaskState["Submitted"] = "submitted";
    TaskState["Working"] = "working";
    TaskState["Completed"] = "completed";
    TaskState["Failed"] = "failed";
    TaskState["Canceled"] = "canceled";
})(TaskState || (TaskState = {}));
// ============================================================================
// ERC-8004 Identity Registry Interface
// ============================================================================
const IDENTITY_REGISTRY_ABI = [
    {
        name: "get_agent_name",
        type: "function",
        inputs: [{ name: "agent_id", type: "u256" }],
        outputs: [{ name: "name", type: "felt252" }],
        stateMutability: "view",
    },
    {
        name: "get_agent_description",
        type: "function",
        inputs: [{ name: "agent_id", type: "u256" }],
        outputs: [{ name: "description", type: "felt252" }],
        stateMutability: "view",
    },
    {
        name: "get_agent_a2a_endpoint",
        type: "function",
        inputs: [{ name: "agent_id", type: "u256" }],
        outputs: [{ name: "endpoint", type: "felt252" }],
        stateMutability: "view",
    },
    {
        name: "get_agent_capabilities",
        type: "function",
        inputs: [{ name: "agent_id", type: "u256" }],
        outputs: [{ name: "capabilities", type: "Array<felt252>" }],
        stateMutability: "view",
    },
];
const REPUTATION_REGISTRY_ABI = [
    {
        name: "get_reputation_summary",
        type: "function",
        inputs: [{ name: "agent_id", type: "u256" }],
        outputs: [
            { name: "average_score", type: "u8" },
            { name: "feedback_count", type: "u256" },
        ],
        stateMutability: "view",
    },
];
const VALIDATION_REGISTRY_ABI = [
    {
        name: "get_validation_count",
        type: "function",
        inputs: [{ name: "agent_id", type: "u256" }],
        outputs: [{ name: "count", type: "u256" }],
        stateMutability: "view",
    },
];
// ============================================================================
// Helper Functions
// ============================================================================
/**
 * Convert felt252 to string using starknet.js utilities.
 */
function feltToString(felt) {
    try {
        return shortString.decodeShortString("0x" + felt.toString(16));
    }
    catch {
        return "";
    }
}
/**
 * Convert string to felt252 using starknet.js utilities.
 */
function stringToFelt(str) {
    return shortString.encodeShortString(str);
}
// ============================================================================
// StarknetA2AAdapter Class
// ============================================================================
export class StarknetA2AAdapter {
    provider;
    identityRegistryAddress;
    reputationRegistryAddress;
    validationRegistryAddress;
    constructor(config) {
        this.provider = new RpcProvider({ nodeUrl: config.rpcUrl });
        this.identityRegistryAddress = config.identityRegistryAddress;
        this.reputationRegistryAddress = config.reputationRegistryAddress;
        this.validationRegistryAddress = config.validationRegistryAddress;
    }
    /**
     * Generate an A2A Agent Card from on-chain identity
     */
    async generateAgentCard(agentId) {
        const identityRegistry = new Contract({
            abi: IDENTITY_REGISTRY_ABI,
            address: this.identityRegistryAddress,
            providerOrAccount: this.provider,
        });
        try {
            // Fetch agent metadata from Identity Registry
            const [name, description, a2aEndpoint, capabilities] = await Promise.all([
                identityRegistry.get_agent_name(agentId),
                identityRegistry.get_agent_description(agentId),
                identityRegistry.get_agent_a2a_endpoint(agentId),
                identityRegistry.get_agent_capabilities(agentId),
            ]);
            // Fetch reputation if registry is configured
            let reputationScore;
            let validationCount;
            if (this.reputationRegistryAddress) {
                const reputationRegistry = new Contract({
                    abi: REPUTATION_REGISTRY_ABI,
                    address: this.reputationRegistryAddress,
                    providerOrAccount: this.provider,
                });
                const summary = await reputationRegistry.get_reputation_summary(agentId);
                reputationScore = Number(summary.average_score);
            }
            if (this.validationRegistryAddress) {
                const validationRegistry = new Contract({
                    abi: VALIDATION_REGISTRY_ABI,
                    address: this.validationRegistryAddress,
                    providerOrAccount: this.provider,
                });
                const count = await validationRegistry.get_validation_count(agentId);
                validationCount = Number(count);
            }
            // Parse capabilities (felt252 array to string array)
            const skills = Array.isArray(capabilities)
                ? capabilities.map((cap) => feltToString(BigInt(cap.toString())))
                : [];
            const card = {
                name: feltToString(BigInt(name.toString())),
                description: feltToString(BigInt(description.toString())),
                url: feltToString(BigInt(a2aEndpoint.toString())),
                version: "1.0",
                skills,
                starknetIdentity: {
                    registryAddress: this.identityRegistryAddress,
                    agentId: agentId.toString(),
                    reputationScore,
                    validationCount,
                },
            };
            return card;
        }
        catch (error) {
            throw new Error(`Failed to generate agent card for ID ${agentId}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Register a new agent identity on-chain
     */
    async registerAgent(account, metadata) {
        const identityRegistry = new Contract({
            abi: IDENTITY_REGISTRY_ABI,
            address: this.identityRegistryAddress,
            providerOrAccount: account,
        });
        try {
            const capabilities = metadata.capabilities || [];
            const capabilitiesAsFelts = capabilities.map(stringToFelt);
            const { transaction_hash } = await account.execute({
                contractAddress: this.identityRegistryAddress,
                entrypoint: "register_agent",
                calldata: [
                    stringToFelt(metadata.name),
                    stringToFelt(metadata.description),
                    stringToFelt(metadata.a2aEndpoint || ""),
                    capabilitiesAsFelts.length.toString(),
                    ...capabilitiesAsFelts,
                ],
            });
            await this.provider.waitForTransaction(transaction_hash);
            return transaction_hash;
        }
        catch (error) {
            throw new Error(`Failed to register agent: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Create a task tracker for Starknet transactions
     */
    createTaskFromTransaction(transactionHash, prompt) {
        return {
            id: transactionHash,
            state: TaskState.Submitted,
            prompt,
            transactionHash,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
    }
    /**
     * Get task status by checking transaction state
     */
    async getTaskStatus(taskId) {
        try {
            const receipt = await this.provider.getTransactionReceipt(taskId);
            const receiptRecord = receipt;
            const executionStatus = receiptRecord.execution_status;
            const state = executionStatus === "SUCCEEDED"
                ? TaskState.Completed
                : executionStatus === "REVERTED"
                    ? TaskState.Failed
                    : TaskState.Working;
            return {
                id: taskId,
                state,
                prompt: "",
                transactionHash: taskId,
                result: state === TaskState.Completed
                    ? JSON.stringify(receipt, null, 2)
                    : undefined,
                error: state === TaskState.Failed
                    ? receiptRecord.revert_reason || "Transaction reverted"
                    : undefined,
                createdAt: 0,
                updatedAt: Date.now(),
            };
        }
        catch (error) {
            // Transaction not found or pending
            return {
                id: taskId,
                state: TaskState.Working,
                prompt: "",
                transactionHash: taskId,
                createdAt: 0,
                updatedAt: Date.now(),
            };
        }
    }
    /**
     * Generate /.well-known/agent.json content
     */
    async generateWellKnownAgentJson(agentId, baseUrl) {
        const card = await this.generateAgentCard(agentId);
        return {
            "@context": "https://a2a-protocol.org/schema/1.0",
            type: "Agent",
            id: `${baseUrl}/.well-known/agent.json`,
            name: card.name,
            description: card.description,
            url: baseUrl,
            version: card.version,
            capabilities: card.skills,
            identity: {
                starknet: card.starknetIdentity,
            },
            endpoints: {
                tasks: `${baseUrl}/api/tasks`,
                status: `${baseUrl}/api/tasks/:id`,
            },
        };
    }
    /**
     * Discover agents from the registry
     */
    async discoverAgents(options) {
        // This would require an indexer or event querying
        // For now, return empty array - implement with specific agent IDs
        // In production, you'd query IdentityRegistry events or use an indexer
        throw new Error("Agent discovery requires an indexer. Use generateAgentCard with known agent IDs.");
    }
}
// ============================================================================
// Factory Function
// ============================================================================
/**
 * Create a new Starknet A2A adapter instance
 */
export function createStarknetA2AAdapter(config) {
    return new StarknetA2AAdapter(config);
}
// ============================================================================
// Exports
// ============================================================================
export default StarknetA2AAdapter;
