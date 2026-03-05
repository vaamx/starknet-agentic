export interface AgentIdentity {
    agentId: string;
    name: string;
    agentType: string;
    model: string;
    status: string;
    walletAddress: string;
    reputationScore: number;
    feedbackCount: number;
}
/** Fetch agent identity from ERC-8004 IdentityRegistry. */
export declare function getAgentIdentity(agentId: string): Promise<AgentIdentity | null>;
/** Generate A2A-compatible agent card from on-chain identity. */
export declare function generateAgentCard(agentId: string, baseUrl: string): Promise<{
    "@context": string;
    type: string;
    id: string;
    name: string;
    description: string;
    url: string;
    version: string;
    capabilities: string[];
    identity: {
        starknet: {
            registryAddress: string | undefined;
            agentId: string;
            reputationScore: number;
            feedbackCount: number;
            walletAddress: string;
        };
    } | undefined;
    endpoints: {
        predict: string;
        markets: string;
        leaderboard: string;
        status: string;
    };
}>;
/** Demo identity data when contracts aren't deployed. */
export declare function getDemoAgentIdentities(): Map<string, AgentIdentity>;
