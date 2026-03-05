/**
 * First action: prove the new account is alive.
 *
 * Primary (always): read balances of the new account (deterministic, safe, read-only).
 * Optional (--verify-tx): send a 0-value self-transfer to prove tx plumbing.
 */
import { type ProviderLike } from "@starknet-agentic/onboarding-utils";
export interface FirstActionResult {
    balances: Record<string, string>;
    verifyTxHash: string | null;
}
export declare function firstAction(args: {
    provider: ProviderLike;
    accountAddress: string;
    privateKey: string;
    network: string;
    verifyTx: boolean;
}): Promise<FirstActionResult>;
