/**
 * Token Service for Starknet MCP Server.
 * Manages token resolution and caching.
 */
import { type RpcProvider } from "starknet";
import { type CachedToken } from "../types/token.js";
/**
 * Static token definitions - these always take precedence and never expire.
 * Single source of truth for token addresses and decimals.
 */
export declare const STATIC_TOKENS: CachedToken[];
/**
 * Token addresses indexed by symbol for easy access.
 */
export declare const TOKENS: Record<"ETH" | "STRK" | "USDC" | "USDT", string>;
/**
 * TokenService manages token resolution and caching.
 * Uses avnu SDK for lazy fetching of unknown tokens.
 */
export declare class TokenService {
    /** Token cache by normalized address */
    private cache;
    /** Symbol to address index for fast lookup */
    private symbolIndex;
    /** avnu API base URL */
    private baseUrl;
    /** RPC provider for on-chain fallback */
    private provider;
    /** Maximum number of dynamic (non-static) entries allowed in cache */
    private static readonly MAX_DYNAMIC_CACHE_SIZE;
    constructor(baseUrl?: string);
    /**
     * Set the RPC provider for on-chain fallback when avnu is unavailable.
     */
    setProvider(provider: RpcProvider): void;
    /**
     * Load static tokens into cache.
     */
    private loadStaticTokens;
    /**
     * Add a token to cache. Never overwrites static tokens.
     */
    private addToCache;
    /**
     * Resolve token symbol or address to normalized address.
     * Synchronous - only checks cache.
     * @throws Error if symbol not found in cache and not a hex address
     */
    resolveSymbol(symbolOrAddress: string): string;
    /**
     * Get cached decimals for a token.
     * Returns undefined if not in cache.
     */
    getDecimals(address: string): number | undefined;
    /**
     * Get token by address, fetching from avnu if not cached or expired.
     * Falls back to on-chain contract calls if avnu is unavailable.
     */
    getTokenByAddress(address: string): Promise<CachedToken>;
    /**
     * Fetch token metadata directly from the contract.
     * @throws Error if all contract calls fail (not a valid ERC20 token)
     */
    private fetchTokenFromChain;
    /**
     * Check if an object is a Cairo ByteArray structure.
     * ByteArray has: data (array of felts), pending_word, pending_word_len
     */
    private isByteArray;
    /**
     * Decode a felt252 short string or ByteArray result from contract call.
     * Handles:
     * - Direct felt252 values (bigint or string)
     * - Wrapped responses like { symbol: felt } or { name: felt }
     * - Cairo 1 ByteArray structures { data, pending_word, pending_word_len }
     */
    private decodeStringResult;
    /**
     * Get token by symbol, fetching from avnu if not cached or expired.
     * Only fetches verified tokens from avnu.
     */
    getTokenBySymbol(symbol: string): Promise<CachedToken>;
    /**
     * Resolve symbol or address asynchronously.
     * Fetches from avnu if symbol not in cache.
     */
    resolveSymbolAsync(symbolOrAddress: string): Promise<string>;
    /**
     * Get decimals asynchronously.
     * Tries: cache → avnu → on-chain (if provider set).
     * Results are cached to avoid repeated calls.
     */
    getDecimalsAsync(address: string): Promise<number>;
    /**
     * Get full token info asynchronously, fetching from avnu if not cached.
     */
    getTokenInfoAsync(addressOrSymbol: string): Promise<CachedToken>;
    /**
     * Evict oldest dynamic cache entries when cache exceeds MAX_DYNAMIC_CACHE_SIZE.
     */
    private evictIfNeeded;
    /**
     * Clear all non-static tokens from cache.
     */
    clearDynamicCache(): void;
    /**
     * Get all cached tokens (for debugging/inspection).
     */
    getAllCached(): CachedToken[];
    /**
     * Get cache size.
     */
    getCacheSize(): number;
}
