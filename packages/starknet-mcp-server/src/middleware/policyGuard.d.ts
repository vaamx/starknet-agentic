/**
 * Preflight Policy Guard
 *
 * Validates MCP tool requests against configurable policy rules before execution.
 * Defense-in-depth: catches violations before they hit on-chain session key policies,
 * avoiding wasted gas on calls that would revert.
 *
 * Addresses: https://github.com/keep-starknet-strange/starknet-agentic/issues/221
 */
export interface TransferPolicy {
    /** Maximum amount per transfer in human-readable units (e.g. "100" = 100 tokens). */
    maxAmountPerCall?: string;
    /** Allowed recipient addresses. Empty = allow all. */
    allowedRecipients?: string[];
    /** Blocked recipient addresses. Checked after allowedRecipients. */
    blockedRecipients?: string[];
    /** Allowed token symbols or addresses. Empty = allow all. */
    allowedTokens?: string[];
}
export interface InvokePolicy {
    /** Blocked entrypoint selectors. These are function names, not raw selectors. */
    blockedEntrypoints?: string[];
    /** Allowed target contract addresses. Empty = allow all. */
    allowedContracts?: string[];
    /** Blocked target contract addresses. Checked after allowedContracts. */
    blockedContracts?: string[];
}
export interface SwapPolicy {
    /** Maximum slippage override (tighter than the 50% server cap). */
    maxSlippage?: number;
    /** Maximum sell amount in human-readable units. */
    maxAmountPerCall?: string;
    /** Blocked buy token symbols or addresses. */
    blockedBuyTokens?: string[];
}
export interface PolicyConfig {
    transfer?: TransferPolicy;
    invoke?: InvokePolicy;
    swap?: SwapPolicy;
    /** If true, reject requests for tools not covered by explicit policy. Default: false. */
    denyUnknownTools?: boolean;
}
export interface PolicyResult {
    allowed: boolean;
    reason?: string;
}
export declare class PolicyGuard {
    private config;
    constructor(config?: PolicyConfig);
    /**
     * Evaluate a tool call against policy. Returns { allowed: true } or { allowed: false, reason }.
     */
    evaluate(toolName: string, args: Record<string, unknown>): PolicyResult;
    private evaluateTransfer;
    private evaluateInvoke;
    private evaluateSwap;
    private evaluateBuildCalls;
}
/**
 * Compare two decimal number strings. Returns:
 *  -1 if a < b, 0 if a == b, 1 if a > b
 *
 * Handles integer and decimal formats (e.g. "1.5", "100").
 */
export declare function compareDecimalStrings(a: string, b: string): number;
/**
 * Load policy config from STARKNET_MCP_POLICY_PATH env var (JSON file)
 * or STARKNET_MCP_POLICY env var (inline JSON). Returns empty config if neither is set.
 */
export declare function loadPolicyConfig(): PolicyConfig;
