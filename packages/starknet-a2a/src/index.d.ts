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
import { Account } from "starknet";
/**
 * A2A Agent Card
 * Describes an agent's capabilities and identity
 */
export interface AgentCard {
    /** Agent's display name */
    name: string;
    /** Human-readable description */
    description: string;
    /** Agent's A2A endpoint URL */
    url?: string;
    /** Protocol version */
    version: string;
    /** List of skills/capabilities */
    skills: string[];
    /** Starknet-specific identity information */
    starknetIdentity?: StarknetIdentity;
}
/**
 * Starknet-specific identity metadata
 */
export interface StarknetIdentity {
    /** Agent Registry contract address */
    registryAddress: string;
    /** Agent's on-chain ID (NFT token ID) */
    agentId: string;
    /** Average reputation score (0-100) */
    reputationScore?: number;
    /** Number of validations received */
    validationCount?: number;
    /** Agent's wallet address */
    walletAddress?: string;
}
/**
 * A2A Task states mapped to Starknet transactions
 */
export declare enum TaskState {
    Submitted = "submitted",
    Working = "working",
    Completed = "completed",
    Failed = "failed",
    Canceled = "canceled"
}
/**
 * A2A Task
 */
export interface Task {
    /** Unique task ID */
    id: string;
    /** Current state */
    state: TaskState;
    /** Task description/prompt */
    prompt: string;
    /** Task result (when completed) */
    result?: string;
    /** Starknet transaction hash (if applicable) */
    transactionHash?: string;
    /** Error message (if failed) */
    error?: string;
    /** Timestamp when created */
    createdAt: number;
    /** Timestamp when last updated */
    updatedAt: number;
}
export declare class StarknetA2AAdapter {
    private provider;
    private identityRegistryAddress;
    private reputationRegistryAddress?;
    private validationRegistryAddress?;
    constructor(config: {
        rpcUrl: string;
        identityRegistryAddress: string;
        reputationRegistryAddress?: string;
        validationRegistryAddress?: string;
    });
    /**
     * Generate an A2A Agent Card from on-chain identity
     */
    generateAgentCard(agentId: string): Promise<AgentCard>;
    /**
     * Register a new agent identity on-chain
     */
    registerAgent(account: Account, metadata: {
        name: string;
        description: string;
        a2aEndpoint?: string;
        capabilities?: string[];
    }): Promise<string>;
    /**
     * Create a task tracker for Starknet transactions
     */
    createTaskFromTransaction(transactionHash: string, prompt: string): Task;
    /**
     * Get task status by checking transaction state
     */
    getTaskStatus(taskId: string): Promise<Task>;
    /**
     * Generate /.well-known/agent.json content
     */
    generateWellKnownAgentJson(agentId: string, baseUrl: string): Promise<object>;
    /**
     * Discover agents from the registry
     */
    discoverAgents(options?: {
        minReputationScore?: number;
        requiredCapabilities?: string[];
    }): Promise<AgentCard[]>;
}
/**
 * Create a new Starknet A2A adapter instance
 */
export declare function createStarknetA2AAdapter(config: {
    rpcUrl: string;
    identityRegistryAddress: string;
    reputationRegistryAddress?: string;
    validationRegistryAddress?: string;
}): StarknetA2AAdapter;
export default StarknetA2AAdapter;
