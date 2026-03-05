import type { RpcProvider } from "starknet";
export interface FirstActionResult {
    balances: Record<string, string>;
    verifyTxHash: string | null;
}
export declare function firstAction(args: {
    provider: RpcProvider;
    accountAddress: string;
    privateKey: string;
    network: string;
    verifyTx: boolean;
}): Promise<FirstActionResult>;
