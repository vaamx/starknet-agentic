export type ParsedArgs = {
    recipient: string;
    amount: string;
    sponsored: boolean;
    addressOnly: boolean;
    evidence: boolean;
};
export declare function parseArgs(args: string[]): ParsedArgs;
/**
 * Validate a Stark private key expected by this demo.
 * @param privateKey 0x-prefixed private key string with exactly 64 hex characters.
 * @throws Error If `privateKey` does not match the expected Stark key format.
 */
export declare function assertPrivateKeyFormat(privateKey: string): void;
/**
 * Validate recipient account address format for transfer calls.
 * @param recipientAddress 0x-prefixed hex string between 1 and 64 hex characters.
 * @throws Error If `recipientAddress` is not a valid hex-address string for this demo.
 */
export declare function assertRecipientAddressFormat(recipientAddress: string): void;
/**
 * Ensure transfer amount parses to a finite positive number.
 * @param amount Transfer amount as a string from CLI/env input.
 * @throws Error If `amount` is not numeric, not finite, or is less than or equal to zero.
 */
export declare function assertPositiveAmount(amount: string): void;
export declare function sanitizeErrorForLog(err: unknown): string;
