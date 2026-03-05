export interface StarknetNetworkConfig {
    factory: string;
    registry: string;
    rpc: string;
    explorer: string;
}
export declare const STARKNET_NETWORKS: Record<string, StarknetNetworkConfig>;
export declare const TOKENS: Record<string, Record<string, string>>;
export interface EvmNetworkConfig {
    name: string;
    chainId: number;
    rpc: string;
    explorer: string;
    identityRegistry: string;
    reputationRegistry: string;
}
export declare const EVM_NETWORKS: Record<string, EvmNetworkConfig>;
export declare const STARKNET_NAMESPACE: Record<string, string>;
export declare const PLACEHOLDER_URI = "https://example.com/erc8004/pending-crosschain-link";
