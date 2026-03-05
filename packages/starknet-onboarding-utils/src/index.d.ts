import { Account, RpcProvider, type Call, type PaymasterDetails } from "starknet";
export type ProviderLike = Pick<RpcProvider, "getChainId" | "callContract" | "waitForTransaction">;
export declare function waitForTransactionWithTimeout<TReceipt = unknown>(args: {
    provider: ProviderLike;
    txHash: string;
    timeoutMs: number;
}): Promise<TReceipt>;
export interface DeployerAccountLike {
    execute(calls: Call | Call[]): Promise<{
        transaction_hash: string;
    }>;
    executePaymasterTransaction(calls: Call[], paymasterDetails: PaymasterDetails, maxFeeInGasToken?: unknown): Promise<{
        transaction_hash: string;
    }>;
}
export type StarknetNetworkConfigLike = {
    rpc: string;
    factory: string;
    registry: string;
    explorer?: string;
};
export declare function formatBalance(raw: bigint, decimals: number): string;
export declare function getErc20BalanceWei(args: {
    provider: ProviderLike;
    tokenAddress: string;
    accountAddress: string;
}): Promise<bigint>;
export declare function getTokenBalances(args: {
    provider: ProviderLike;
    tokens: Record<string, string>;
    accountAddress: string;
    decimals?: number;
}): Promise<Record<string, string>>;
export declare function assertSepoliaChainId(chainId: string, network: string): void;
export interface StarknetPreflightResult {
    provider: RpcProvider;
    account: Account;
    chainId: string;
    balances: Record<string, string>;
}
export declare function preflightStarknet(args: {
    network: string;
    networkConfig: StarknetNetworkConfigLike;
    tokens: Record<string, string>;
    accountAddress: string;
    privateKey: string;
    paymasterUrl?: string;
    paymasterApiKey?: string;
    rpcUrlOverride?: string;
}): Promise<StarknetPreflightResult>;
export declare function createRandomKeypair(): {
    privateKey: string;
    publicKey: string;
};
export declare function parseFactoryAccountDeployedEvent(args: {
    factoryAddress: string;
    receipt: unknown;
}): {
    accountAddress: string | null;
    agentId: string | null;
};
export interface DeployAccountResult {
    accountAddress: string;
    agentId: string;
    publicKey: string;
    privateKey: string;
    deployTxHash: string;
}
export declare function deployAccountViaFactory(args: {
    provider: ProviderLike;
    factoryAddress: string;
    deployerAccount: DeployerAccountLike;
    tokenUri: string;
    gasfree?: boolean;
    requireEvent?: boolean;
    waitForTxTimeoutMs?: number;
    salt?: string;
}): Promise<DeployAccountResult>;
export interface FirstActionResult {
    balances: Record<string, string>;
    verifyTxHash: string | null;
}
export declare function firstActionBalances(args: {
    provider: RpcProvider;
    tokens: Record<string, string>;
    accountAddress: string;
    privateKey: string;
    verifyTx: boolean;
    waitForTxTimeoutMs?: number;
}): Promise<FirstActionResult>;
