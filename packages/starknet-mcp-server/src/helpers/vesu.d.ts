/**
 * Vesu V2 lending protocol helpers.
 * Vesu uses ERC-4626 vTokens for supply/withdraw.
 * @see https://docs.vesu.xyz/developers/interact/supply-withdraw
 */
import { type Call } from "starknet";
/** Vesu V2 PoolFactory — mainnet */
export declare const VESU_POOL_FACTORY = "0x03760f903a37948f97302736f89ce30290e45f441559325026842b7a6fb388c0";
/** Vesu V2 Prime pool — mainnet */
export declare const VESU_PRIME_POOL = "0x0451fe483d5921a2919ddd81d0de6696669bccdacd859f72a4fba7656b97c3b5";
export interface RpcProviderLike {
    callContract: (req: {
        contractAddress: string;
        entrypoint: string;
        calldata: string[];
    }) => Promise<{
        result?: string[];
    } | string[]>;
}
/**
 * Fetch vToken address for a given pool and asset from Vesu PoolFactory.
 */
export declare function getVTokenAddress(provider: RpcProviderLike, poolAddress: string, assetAddress: string): Promise<string>;
/**
 * Build ERC-20 approve + ERC-4626 deposit calls for Vesu supply.
 * Caller must have sufficient asset balance and allowance.
 */
export declare function buildDepositCalls(assetAddress: string, vTokenAddress: string, amountWei: bigint, receiver: string): Call[];
/**
 * Build ERC-4626 withdraw call for Vesu.
 * Burns vToken shares and sends underlying assets to receiver.
 */
export declare function buildWithdrawCalls(vTokenAddress: string, amountWei: bigint, receiver: string, owner: string): Call[];
