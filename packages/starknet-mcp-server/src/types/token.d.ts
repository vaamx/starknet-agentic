/**
 * Token types for the Starknet MCP Server.
 * Extends avnu SDK Token type with cache metadata.
 */
import type { Token, TokenTag } from "@avnu/avnu-sdk";
/**
 * Extended Token type with cache metadata.
 * Used internally by TokenService for caching.
 */
export interface CachedToken extends Token {
    /** True for static tokens (ETH, STRK, USDC, USDT) - never expires */
    isStatic: boolean;
    /** Timestamp when token was cached - used for TTL */
    lastUpdated: number;
}
/** Cache TTL: 24 hours in milliseconds */
export declare const TOKEN_TTL_MS: number;
export type { Token, TokenTag };
