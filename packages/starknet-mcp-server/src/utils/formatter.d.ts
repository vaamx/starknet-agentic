import type { Quote } from "@avnu/avnu-sdk";
/**
 * Format a raw token amount (in wei/smallest unit) to human-readable decimal string.
 * Removes trailing zeros and handles edge cases.
 *
 * @param amount - Raw amount as bigint (e.g., 1500000000000000000n for 1.5 ETH)
 * @param decimals - Number of decimal places for the token (e.g., 18 for ETH, 6 for USDC)
 * @returns Formatted amount as string (e.g., "1.5" for 1.5 ETH, "100" for 100 USDC)
 *
 * @example
 * ```typescript
 * formatAmount(1500000000000000000n, 18) // → "1.5"
 * formatAmount(1000000n, 6)              // → "1"
 * formatAmount(123456789n, 6)            // → "123.456789"
 * formatAmount(0n, 18)                   // → "0"
 * ```
 */
export declare function formatAmount(amount: bigint, decimals: number): string;
/**
 * Format AVNU quote fields for human-readable display.
 * Converts raw quote data to formatted strings with percentages and amounts.
 *
 * @param quote - Raw quote from AVNU API
 * @param buyDecimals - Decimals of the output token
 * @returns Formatted quote fields with human-readable amounts and percentages
 *
 * @example
 * ```typescript
 * const formatted = formatQuoteFields(quote, 6);
 * // {
 * //   buyAmount: "100.5",
 * //   priceImpact: "0.15%",
 * //   gasFeesUsd: "2.3456",
 * //   routes: [{ name: "Ekubo", percent: "60.0%" }]
 * // }
 * ```
 */
export declare function formatQuoteFields(quote: Quote, buyDecimals: number): {
    buyAmount: string;
    priceImpact: string | undefined;
    gasFeesUsd: string | undefined;
    routes: Array<{
        name: string;
        percent: string;
    }> | undefined;
};
/**
 * Convert technical error messages to user-friendly actionable messages.
 * Matches error strings against known patterns and returns helpful guidance.
 *
 * @param errorMessage - Raw error message from contract or API
 * @returns User-friendly error message with recovery suggestions
 *
 * @example
 * ```typescript
 * formatErrorMessage("INSUFFICIENT_LIQUIDITY in pool")
 * // → "Insufficient liquidity for this swap. Try a smaller amount or different token pair."
 *
 * formatErrorMessage("Unknown error occurred")
 * // → "Unknown error occurred" (passthrough if no pattern matches)
 * ```
 */
export declare function formatErrorMessage(errorMessage: string): string;
