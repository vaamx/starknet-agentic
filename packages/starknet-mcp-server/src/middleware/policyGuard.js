/**
 * Preflight Policy Guard
 *
 * Validates MCP tool requests against configurable policy rules before execution.
 * Defense-in-depth: catches violations before they hit on-chain session key policies,
 * avoiding wasted gas on calls that would revert.
 *
 * Addresses: https://github.com/keep-starknet-strange/starknet-agentic/issues/221
 */
import { readFileSync } from "node:fs";
// ── Default deny-list of privileged entrypoints ─────────────────────────────
const DEFAULT_BLOCKED_ENTRYPOINTS = [
    "upgrade",
    "set_owner",
    "transfer_ownership",
    "transferOwnership",
    "renounce_ownership",
    "renounceOwnership",
    "set_admin",
    "change_admin",
    "set_implementation",
    "initialize",
    "register_session_key",
    "revoke_session_key",
    "emergency_revoke_all",
    "schedule_upgrade",
    "execute_upgrade",
];
// ── Guard implementation ────────────────────────────────────────────────────
export class PolicyGuard {
    config;
    constructor(config = {}) {
        this.config = config;
    }
    /**
     * Evaluate a tool call against policy. Returns { allowed: true } or { allowed: false, reason }.
     */
    evaluate(toolName, args) {
        switch (toolName) {
            case "starknet_transfer":
                return this.evaluateTransfer(args);
            case "starknet_invoke_contract":
                return this.evaluateInvoke(args);
            case "starknet_swap":
                return this.evaluateSwap(args);
            case "starknet_build_calls":
                return this.evaluateBuildCalls(args);
            default:
                if (this.config.denyUnknownTools) {
                    return { allowed: false, reason: `Tool "${toolName}" is not covered by policy` };
                }
                return { allowed: true };
        }
    }
    evaluateTransfer(args) {
        const policy = this.config.transfer;
        if (!policy)
            return { allowed: true };
        const recipient = normalizeAddress(args.recipient);
        const token = args.token ?? "";
        const amount = args.amount;
        // Amount check
        if (policy.maxAmountPerCall && amount) {
            if (compareDecimalStrings(amount, policy.maxAmountPerCall) > 0) {
                return {
                    allowed: false,
                    reason: `Transfer amount ${amount} exceeds policy limit of ${policy.maxAmountPerCall}`,
                };
            }
        }
        // Recipient allowlist
        if (policy.allowedRecipients && policy.allowedRecipients.length > 0 && recipient) {
            const normalized = policy.allowedRecipients.map(normalizeAddress);
            if (!normalized.includes(recipient)) {
                return {
                    allowed: false,
                    reason: `Recipient ${recipient} is not in the allowed recipients list`,
                };
            }
        }
        // Recipient blocklist
        if (policy.blockedRecipients && policy.blockedRecipients.length > 0 && recipient) {
            const normalized = policy.blockedRecipients.map(normalizeAddress);
            if (normalized.includes(recipient)) {
                return {
                    allowed: false,
                    reason: `Recipient ${recipient} is blocked by policy`,
                };
            }
        }
        // Token allowlist
        if (policy.allowedTokens && policy.allowedTokens.length > 0) {
            const normalizedAllowed = policy.allowedTokens.map((t) => t.toLowerCase());
            if (!normalizedAllowed.includes(token.toLowerCase())) {
                return {
                    allowed: false,
                    reason: `Token "${token}" is not in the allowed tokens list`,
                };
            }
        }
        return { allowed: true };
    }
    evaluateInvoke(args) {
        const policy = this.config.invoke;
        const entrypoint = args.entrypoint;
        const contractAddress = normalizeAddress(args.contractAddress);
        // Always check default blocked entrypoints, even without explicit policy
        if (entrypoint && DEFAULT_BLOCKED_ENTRYPOINTS.includes(entrypoint)) {
            return {
                allowed: false,
                reason: `Entrypoint "${entrypoint}" is blocked by default security policy (privileged operation)`,
            };
        }
        if (!policy)
            return { allowed: true };
        // Custom blocked entrypoints
        if (policy.blockedEntrypoints && entrypoint) {
            if (policy.blockedEntrypoints.includes(entrypoint)) {
                return {
                    allowed: false,
                    reason: `Entrypoint "${entrypoint}" is blocked by policy`,
                };
            }
        }
        // Contract allowlist
        if (policy.allowedContracts && policy.allowedContracts.length > 0 && contractAddress) {
            const normalized = policy.allowedContracts.map(normalizeAddress);
            if (!normalized.includes(contractAddress)) {
                return {
                    allowed: false,
                    reason: `Contract ${contractAddress} is not in the allowed contracts list`,
                };
            }
        }
        // Contract blocklist
        if (policy.blockedContracts && policy.blockedContracts.length > 0 && contractAddress) {
            const normalized = policy.blockedContracts.map(normalizeAddress);
            if (normalized.includes(contractAddress)) {
                return {
                    allowed: false,
                    reason: `Contract ${contractAddress} is blocked by policy`,
                };
            }
        }
        return { allowed: true };
    }
    evaluateSwap(args) {
        const policy = this.config.swap;
        if (!policy)
            return { allowed: true };
        const slippage = args.slippage;
        const amount = args.amount;
        const buyToken = args.buyToken ?? "";
        // Slippage check
        if (policy.maxSlippage !== undefined && slippage !== undefined) {
            if (slippage > policy.maxSlippage) {
                return {
                    allowed: false,
                    reason: `Slippage ${slippage} exceeds policy limit of ${policy.maxSlippage}`,
                };
            }
        }
        // Amount check
        if (policy.maxAmountPerCall && amount) {
            if (compareDecimalStrings(amount, policy.maxAmountPerCall) > 0) {
                return {
                    allowed: false,
                    reason: `Swap amount ${amount} exceeds policy limit of ${policy.maxAmountPerCall}`,
                };
            }
        }
        // Blocked buy tokens
        if (policy.blockedBuyTokens && policy.blockedBuyTokens.length > 0) {
            const normalizedBlocked = policy.blockedBuyTokens.map((t) => t.toLowerCase());
            if (normalizedBlocked.includes(buyToken.toLowerCase())) {
                return {
                    allowed: false,
                    reason: `Buy token "${buyToken}" is blocked by policy`,
                };
            }
        }
        return { allowed: true };
    }
    evaluateBuildCalls(args) {
        const calls = args.calls;
        if (!calls || !Array.isArray(calls))
            return { allowed: true };
        // Check each call in the batch against invoke policy
        for (let i = 0; i < calls.length; i++) {
            const call = calls[i];
            const result = this.evaluateInvoke({
                contractAddress: call.contractAddress,
                entrypoint: call.entrypoint,
            });
            if (!result.allowed) {
                return {
                    allowed: false,
                    reason: `calls[${i}]: ${result.reason}`,
                };
            }
        }
        return { allowed: true };
    }
}
// ── Helpers ─────────────────────────────────────────────────────────────────
/**
 * Normalize a Starknet address to lowercase with consistent 0x prefix.
 * Returns empty string for undefined/null input.
 */
function normalizeAddress(addr) {
    if (!addr)
        return "";
    return addr.toLowerCase();
}
/**
 * Compare two decimal number strings. Returns:
 *  -1 if a < b, 0 if a == b, 1 if a > b
 *
 * Handles integer and decimal formats (e.g. "1.5", "100").
 */
export function compareDecimalStrings(a, b) {
    const fa = parseFloat(a);
    const fb = parseFloat(b);
    if (Number.isNaN(fa) || Number.isNaN(fb))
        return 0;
    if (fa < fb)
        return -1;
    if (fa > fb)
        return 1;
    return 0;
}
// ── Factory ─────────────────────────────────────────────────────────────────
/**
 * Load policy config from STARKNET_MCP_POLICY_PATH env var (JSON file)
 * or STARKNET_MCP_POLICY env var (inline JSON). Returns empty config if neither is set.
 */
export function loadPolicyConfig() {
    const inlinePolicy = process.env.STARKNET_MCP_POLICY;
    if (inlinePolicy) {
        try {
            return JSON.parse(inlinePolicy);
        }
        catch (e) {
            console.error("Failed to parse STARKNET_MCP_POLICY:", e);
            return {};
        }
    }
    const policyPath = process.env.STARKNET_MCP_POLICY_PATH;
    if (policyPath) {
        try {
            const content = readFileSync(policyPath, "utf-8");
            return JSON.parse(content);
        }
        catch (e) {
            console.error(`Failed to load policy from ${policyPath}:`, e);
            return {};
        }
    }
    return {};
}
