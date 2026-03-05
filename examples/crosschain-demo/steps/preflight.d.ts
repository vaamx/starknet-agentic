import type { Account, RpcProvider } from "starknet";
import { type StarknetNetworkConfig } from "../config.js";
export interface PreflightResult {
    provider: RpcProvider;
    account: Account;
    networkConfig: StarknetNetworkConfig;
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
