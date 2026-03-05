/**
 * Token Service for Starknet MCP Server.
 * Manages token resolution and caching.
 */
import { fetchTokenByAddress, fetchVerifiedTokenBySymbol, } from "@avnu/avnu-sdk";
import { Contract, shortString, byteArray } from "starknet";
import { TOKEN_TTL_MS } from "../types/token.js";
import { normalizeAddress } from "../utils.js";
const ERC20_METADATA_ABI = [
    {
        name: "symbol",
        type: "function",
        inputs: [],
        outputs: [{ name: "symbol", type: "felt" }],
        stateMutability: "view",
    },
    {
        name: "name",
        type: "function",
        inputs: [],
        outputs: [{ name: "name", type: "felt" }],
        stateMutability: "view",
    },
    {
        name: "decimals",
        type: "function",
        inputs: [],
        outputs: [{ name: "decimals", type: "felt" }],
        stateMutability: "view",
    },
];
/** Static token defaults - shared by all static tokens */
const STATIC_TOKEN_DEFAULTS = {
    logoUri: null,
    lastDailyVolumeUsd: 0,
    tags: ["Verified"],
    extensions: {},
    isStatic: true,
    lastUpdated: 0,
};
/** Core token data - only the fields that differ per token */
const STATIC_TOKEN_DATA = [
    { address: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7", symbol: "ETH", name: "Ether", decimals: 18 },
    { address: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d", symbol: "STRK", name: "Starknet Token", decimals: 18 },
    { address: "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8", symbol: "USDC", name: "USD Coin", decimals: 6 },
    { address: "0x068f5c6a61780768455de69077e07e89787839bf8166decfbf92b645209c0fb8", symbol: "USDT", name: "Tether USD", decimals: 6 },
];
/**
 * Static token definitions - these always take precedence and never expire.
 * Single source of truth for token addresses and decimals.
 */
export const STATIC_TOKENS = STATIC_TOKEN_DATA.map((token) => ({
    ...STATIC_TOKEN_DEFAULTS,
    ...token,
}));
/**
 * Token addresses indexed by symbol for easy access.
 */
export const TOKENS = Object.fromEntries(STATIC_TOKENS.map((t) => [t.symbol, t.address]));
/**
 * Check if a cached token has expired (TTL 24h).
 * Static tokens never expire.
 */
function isExpired(token) {
    if (token.isStatic)
        return false;
    return Date.now() - token.lastUpdated > TOKEN_TTL_MS;
}
/**
 * Convert an avnu Token to a CachedToken.
 */
function toCachedToken(token, isStatic) {
    return {
        ...token,
        address: normalizeAddress(token.address),
        isStatic,
        lastUpdated: Date.now(),
    };
}
/**
 * TokenService manages token resolution and caching.
 * Uses avnu SDK for lazy fetching of unknown tokens.
 */
export class TokenService {
    /** Token cache by normalized address */
    cache = new Map();
    /** Symbol to address index for fast lookup */
    symbolIndex = new Map();
    /** avnu API base URL */
    baseUrl;
    /** RPC provider for on-chain fallback */
    provider = null;
    /** Maximum number of dynamic (non-static) entries allowed in cache */
    static MAX_DYNAMIC_CACHE_SIZE = 512;
    constructor(baseUrl = "https://starknet.api.avnu.fi") {
        this.baseUrl = baseUrl;
        this.loadStaticTokens();
    }
    /**
     * Set the RPC provider for on-chain fallback when avnu is unavailable.
     */
    setProvider(provider) {
        this.provider = provider;
    }
    /**
     * Load static tokens into cache.
     */
    loadStaticTokens() {
        for (const token of STATIC_TOKENS) {
            const normalized = normalizeAddress(token.address);
            this.cache.set(normalized, { ...token, address: normalized });
            this.symbolIndex.set(token.symbol.toUpperCase(), normalized);
        }
    }
    /**
     * Add a token to cache. Never overwrites static tokens.
     */
    addToCache(token, isStatic) {
        const normalized = normalizeAddress(token.address);
        // Never overwrite static tokens
        const existing = this.cache.get(normalized);
        if (existing?.isStatic) {
            return existing;
        }
        const cached = toCachedToken(token, isStatic);
        cached.address = normalized;
        this.cache.set(normalized, cached);
        // Only index symbol if not already taken by a static token
        const upperSymbol = token.symbol.toUpperCase();
        const existingAddr = this.symbolIndex.get(upperSymbol);
        if (!existingAddr || !this.cache.get(existingAddr)?.isStatic) {
            this.symbolIndex.set(upperSymbol, normalized);
        }
        // Evict oldest dynamic entries when cache exceeds cap
        this.evictIfNeeded();
        return cached;
    }
    // ============================================
    // SYNCHRONOUS METHODS (cache only)
    // ============================================
    /**
     * Resolve token symbol or address to normalized address.
     * Synchronous - only checks cache.
     * @throws Error if symbol not found in cache and not a hex address
     */
    resolveSymbol(symbolOrAddress) {
        const upper = symbolOrAddress.toUpperCase();
        // Check symbol index first
        const indexed = this.symbolIndex.get(upper);
        if (indexed) {
            return indexed;
        }
        // If it's a hex address, normalize and return
        if (symbolOrAddress.startsWith("0x")) {
            return normalizeAddress(symbolOrAddress);
        }
        throw new Error(`Unknown token: ${symbolOrAddress}`);
    }
    /**
     * Get cached decimals for a token.
     * Returns undefined if not in cache.
     */
    getDecimals(address) {
        const normalized = normalizeAddress(address);
        const cached = this.cache.get(normalized);
        if (!cached || isExpired(cached)) {
            return undefined;
        }
        return cached.decimals;
    }
    // ============================================
    // ASYNCHRONOUS METHODS (with avnu fetch)
    // ============================================
    /**
     * Get token by address, fetching from avnu if not cached or expired.
     * Falls back to on-chain contract calls if avnu is unavailable.
     */
    async getTokenByAddress(address) {
        const normalized = normalizeAddress(address);
        const cached = this.cache.get(normalized);
        // Return cached if valid and not expired
        if (cached && !isExpired(cached)) {
            return cached;
        }
        // Fetch from avnu
        try {
            const token = await fetchTokenByAddress(address, { baseUrl: this.baseUrl });
            return this.addToCache(token, false);
        }
        catch {
            // Fall back to on-chain if provider available
            if (!this.provider) {
                throw new Error(`Token ${address} not found and no RPC provider configured for on-chain fallback`);
            }
            return this.fetchTokenFromChain(normalized);
        }
    }
    /**
     * Fetch token metadata directly from the contract.
     * @throws Error if all contract calls fail (not a valid ERC20 token)
     */
    async fetchTokenFromChain(address) {
        const contract = new Contract({
            abi: ERC20_METADATA_ABI,
            address,
            providerOrAccount: this.provider,
        });
        const [symbolResult, nameResult, decimalsResult] = await Promise.all([
            contract.symbol().catch(() => null),
            contract.name().catch(() => null),
            contract.decimals().catch(() => null),
        ]);
        // If all contract calls failed, this is likely not a valid ERC20 token
        // Don't cache invalid data that could silently treat non-tokens as tokens
        if (symbolResult === null && nameResult === null && decimalsResult === null) {
            throw new Error(`Address ${address} does not appear to be a valid ERC20 token: all metadata calls failed`);
        }
        const symbol = this.decodeStringResult(symbolResult, address);
        const name = this.decodeStringResult(nameResult, "Unknown Token");
        const rawDecimals = Number(decimalsResult?.decimals ?? decimalsResult ?? 18);
        const decimals = Number.isNaN(rawDecimals) ? 18 : rawDecimals;
        // Route through addToCache to preserve static token precedence
        return this.addToCache({
            address,
            symbol,
            name,
            decimals,
            logoUri: null,
            lastDailyVolumeUsd: 0,
            tags: [],
            extensions: {},
        }, false);
    }
    /**
     * Check if an object is a Cairo ByteArray structure.
     * ByteArray has: data (array of felts), pending_word, pending_word_len
     */
    isByteArray(obj) {
        if (typeof obj !== "object" || obj === null)
            return false;
        const record = obj;
        return "data" in record && "pending_word" in record && "pending_word_len" in record;
    }
    /**
     * Decode a felt252 short string or ByteArray result from contract call.
     * Handles:
     * - Direct felt252 values (bigint or string)
     * - Wrapped responses like { symbol: felt } or { name: felt }
     * - Cairo 1 ByteArray structures { data, pending_word, pending_word_len }
     */
    decodeStringResult(result, fallback) {
        if (!result)
            return fallback;
        try {
            // Unwrap { symbol: ... } or { name: ... } responses, unless it's a direct ByteArray
            let value = result;
            if (typeof result === "object" && result !== null && !Array.isArray(result) && !this.isByteArray(result)) {
                const record = result;
                if ("symbol" in record)
                    value = record.symbol;
                else if ("name" in record)
                    value = record.name;
            }
            // ByteArray (Cairo 1 long strings)
            if (this.isByteArray(value)) {
                return byteArray.stringFromByteArray(value) || fallback;
            }
            // Short string (felt252)
            if (typeof value === "bigint" || typeof value === "string") {
                return shortString.decodeShortString(value.toString()) || fallback;
            }
        }
        catch {
            // Decoding failed
        }
        return fallback;
    }
    /**
     * Get token by symbol, fetching from avnu if not cached or expired.
     * Only fetches verified tokens from avnu.
     */
    async getTokenBySymbol(symbol) {
        const upper = symbol.toUpperCase();
        const addr = this.symbolIndex.get(upper);
        if (addr) {
            const cached = this.cache.get(addr);
            if (cached && !isExpired(cached)) {
                return cached;
            }
        }
        // Fetch from avnu (verified tokens only)
        try {
            const token = await fetchVerifiedTokenBySymbol(symbol, { baseUrl: this.baseUrl });
            return this.addToCache(token, false);
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to fetch token by symbol "${symbol}": ${msg}`);
        }
    }
    /**
     * Resolve symbol or address asynchronously.
     * Fetches from avnu if symbol not in cache.
     */
    async resolveSymbolAsync(symbolOrAddress) {
        // Try sync first
        try {
            return this.resolveSymbol(symbolOrAddress);
        }
        catch {
            // If not a hex address, try fetching from avnu
            if (!symbolOrAddress.startsWith("0x")) {
                const token = await this.getTokenBySymbol(symbolOrAddress);
                return token.address;
            }
            throw new Error(`Unknown token: ${symbolOrAddress}`);
        }
    }
    /**
     * Get decimals asynchronously.
     * Tries: cache → avnu → on-chain (if provider set).
     * Results are cached to avoid repeated calls.
     */
    async getDecimalsAsync(address) {
        const cached = this.getDecimals(address);
        if (cached !== undefined) {
            return cached;
        }
        // getTokenByAddress handles avnu → on-chain fallback
        const token = await this.getTokenByAddress(address);
        return token.decimals;
    }
    /**
     * Get full token info asynchronously, fetching from avnu if not cached.
     */
    async getTokenInfoAsync(addressOrSymbol) {
        if (addressOrSymbol.startsWith("0x")) {
            return this.getTokenByAddress(addressOrSymbol);
        }
        return this.getTokenBySymbol(addressOrSymbol);
    }
    /**
     * Evict oldest dynamic cache entries when cache exceeds MAX_DYNAMIC_CACHE_SIZE.
     */
    evictIfNeeded() {
        const dynamicEntries = Array.from(this.cache.entries())
            .filter(([, t]) => !t.isStatic);
        if (dynamicEntries.length <= TokenService.MAX_DYNAMIC_CACHE_SIZE)
            return;
        // Sort by lastUpdated ascending (oldest first) and remove excess
        dynamicEntries.sort((a, b) => a[1].lastUpdated - b[1].lastUpdated);
        const toRemove = dynamicEntries.length - TokenService.MAX_DYNAMIC_CACHE_SIZE;
        for (let i = 0; i < toRemove; i++) {
            const [addr, token] = dynamicEntries[i];
            this.cache.delete(addr);
            const sym = token.symbol.toUpperCase();
            if (this.symbolIndex.get(sym) === addr) {
                this.symbolIndex.delete(sym);
            }
        }
    }
    // ============================================
    // CACHE MANAGEMENT
    // ============================================
    /**
     * Clear all non-static tokens from cache.
     */
    clearDynamicCache() {
        for (const [addr, token] of this.cache) {
            if (!token.isStatic) {
                this.cache.delete(addr);
            }
        }
        for (const [symbol, addr] of this.symbolIndex) {
            if (!this.cache.has(addr)) {
                this.symbolIndex.delete(symbol);
            }
        }
    }
    /**
     * Get all cached tokens (for debugging/inspection).
     */
    getAllCached() {
        return Array.from(this.cache.values());
    }
    /**
     * Get cache size.
     */
    getCacheSize() {
        return this.cache.size;
    }
}
