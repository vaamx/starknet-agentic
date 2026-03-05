import type { FundingProvider } from "./types.js";
interface TxReceiptLike {
    hash: string;
    wait(): Promise<unknown>;
}
interface L1ProviderLike {
    getBalance(address: string): Promise<bigint>;
}
interface L1WalletLike {
    address: string;
}
interface L1BridgeLike {
    deposit(amount: bigint, l2Recipient: bigint, overrides: {
        value: bigint;
    }): Promise<TxReceiptLike>;
}
interface StarkgateRuntime {
    createL1Provider(rpcUrl: string): L1ProviderLike;
    createL1Wallet(privateKey: string, provider: L1ProviderLike): L1WalletLike;
    createL1Bridge(bridgeAddress: string, wallet: L1WalletLike): L1BridgeLike;
    now(): number;
    sleep(ms: number): Promise<void>;
}
export declare function createStarkgateL1FundingProvider(runtime?: StarkgateRuntime): FundingProvider;
export declare const starkgateL1FundingProvider: FundingProvider;
export {};
