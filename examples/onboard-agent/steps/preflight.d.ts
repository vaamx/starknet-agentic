/**
 * Preflight checks: validate environment, RPC connectivity,
 * chain ID, and deployer balance.
 */
import { type Account, type RpcProvider } from "starknet";
import { type NetworkConfig } from "../config.js";
export interface PreflightResult {
    provider: RpcProvider;
    account: Account;
    networkConfig: NetworkConfig;
    network: string;
    chainId: string;
    balances: Record<string, string>;
}
export declare function preflight(env: {
    network: string;
    rpcUrl?: string;
    accountAddress: string;
    privateKey: string;
    paymasterUrl?: string;
    paymasterApiKey?: string;
}): Promise<PreflightResult>;
