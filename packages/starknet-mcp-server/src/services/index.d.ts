/**
 * Services index - exports singleton instances.
 */
import type { RpcProvider } from "starknet";
import { TokenService } from "./TokenService.js";
/**
 * Get the singleton TokenService instance.
 * @param baseUrl - Optional avnu API base URL (only used on first call)
 */
export declare function getTokenService(baseUrl?: string): TokenService;
/**
 * Configure the RPC provider for TokenService on-chain fallback.
 * Call this at startup after creating the RpcProvider.
 */
export declare function configureTokenServiceProvider(provider: RpcProvider): void;
/**
 * Reset the TokenService singleton (useful for testing).
 */
export declare function resetTokenService(): void;
export { TokenService, STATIC_TOKENS, TOKENS } from "./TokenService.js";
export type { CachedToken, Token, TokenTag } from "../types/token.js";
