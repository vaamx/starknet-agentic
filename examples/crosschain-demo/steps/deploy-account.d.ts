import { type DeployerAccountLike, type ProviderLike } from "@starknet-agentic/onboarding-utils";
import type { StarknetNetworkConfig } from "../config.js";
export interface DeployAccountResult {
    accountAddress: string;
    agentId: string;
    publicKey: string;
    privateKey: string;
    deployTxHash: string;
}
export declare function deployAccount(args: {
    provider: ProviderLike;
    deployerAccount: DeployerAccountLike;
    networkConfig: StarknetNetworkConfig;
    network: string;
    tokenUri: string;
    gasfree?: boolean;
    paymasterUrl?: string;
    paymasterApiKey?: string;
    salt?: string;
}): Promise<DeployAccountResult>;
