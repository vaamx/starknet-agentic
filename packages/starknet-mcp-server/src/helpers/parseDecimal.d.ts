/**
 * Convert a human-readable decimal string to a BigInt with the given decimals,
 * without floating-point precision loss.
 *
 * parseDecimalToBigInt("1.5", 18) → 1500000000000000000n
 * parseDecimalToBigInt("0.1", 6)  → 100000n
 */
export declare function parseDecimalToBigInt(value: string, decimals: number): bigint;
