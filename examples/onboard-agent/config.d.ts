/**
 * Network configuration for the onboarding flow.
 *
 * Factory and registry addresses are filled in after deploying
 * contracts with contracts/agent-account/scripts/deploy.js
 */
export interface NetworkConfig {
    factory: string;
    registry: string;
    rpc: string;
    explorer: string;
}
export declare const NETWORKS: Record<string, NetworkConfig>;
/** ERC-20 token addresses per network */
export declare const TOKENS: Record<string, Record<string, string>>;
