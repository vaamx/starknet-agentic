#!/usr/bin/env npx tsx
import { Interface } from "ethers";
import type { FundingProviderSelection } from "./funding/types.js";
export declare function createSharedUri(input: {
    name: string;
    description: string;
    evmAgentId: string;
    evmRegistry: string;
    evmChainId: number;
    starknetAgentId: string;
    starknetRegistry: string;
    starknetNetwork: string;
}): string;
export declare function extractMintedTokenId(receipt: {
    logs: Array<{
        topics: string[];
        data: string;
    }>;
}, iface: Interface): bigint | null;
export declare function resolveEvmAgentId(args: {
    predictedAgentId: bigint;
    receipt: {
        logs: Array<{
            topics: string[];
            data: string;
        }>;
    };
    iface: Interface;
}): bigint;
export declare function parseFundingProvider(value: string | undefined): FundingProviderSelection;
export declare function parseMinStarknetDeployerBalanceWei(value: string | undefined): bigint;
export declare function parseNonNegativeWei(raw: string, varName: string): bigint;
export declare function parsePositiveIntEnv(value: string | undefined, varName: string, defaultValue: number): number;
