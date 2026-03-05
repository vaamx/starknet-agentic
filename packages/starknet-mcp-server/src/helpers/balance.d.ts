import { RpcProvider } from "starknet";
export declare const BALANCE_CHECKER_ADDRESS = "0x031ce64a666fbf9a2b1b2ca51c2af60d9a76d3b85e5fbfb9d5a8dbd3fedc9716";
export declare const BALANCE_CHECKER_ABI: ({
    type: string;
    name: string;
    members: {
        name: string;
        type: string;
    }[];
    inputs?: undefined;
    outputs?: undefined;
    state_mutability?: undefined;
} | {
    type: string;
    name: string;
    inputs: {
        name: string;
        type: string;
    }[];
    outputs: {
        type: string;
    }[];
    state_mutability: string;
    members?: undefined;
})[];
export declare const ERC20_ABI: ({
    name: string;
    type: string;
    inputs: {
        name: string;
        type: string;
    }[];
    outputs: {
        name: string;
        type: string;
    }[];
    stateMutability: string;
} | {
    name: string;
    type: string;
    inputs: {
        name: string;
        type: string;
    }[];
    outputs: {
        name: string;
        type: string;
    }[];
    stateMutability?: undefined;
})[];
export type TokenBalanceResult = {
    token: string;
    tokenAddress: string;
    balance: bigint;
    decimals: number;
};
export type BatchBalanceResult = {
    balances: TokenBalanceResult[];
    method: "balance_checker" | "batch_rpc";
};
/**
 * Fetch single token balance for an address.
 */
export declare function fetchTokenBalance(walletAddress: string, tokenAddress: string, provider: RpcProvider): Promise<{
    balance: bigint;
    decimals: number;
}>;
/**
 * Fetch multiple token balances in an optimized way.
 * Tries BalanceChecker contract first, falls back to batch RPC.
 */
export declare function fetchTokenBalances(walletAddress: string, tokens: string[], tokenAddresses: string[], provider: RpcProvider): Promise<BatchBalanceResult>;
