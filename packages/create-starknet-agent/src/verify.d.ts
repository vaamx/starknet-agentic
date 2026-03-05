/**
 * Verification module for create-starknet-agent
 *
 * Provides comprehensive health checks for Starknet agent setup.
 */
/**
 * Parsed verify command arguments
 */
export interface VerifyArgs {
    platform?: string;
    jsonOutput: boolean;
    skipE2E: boolean;
    verbose: boolean;
    showHelp: boolean;
}
/**
 * Parse verify subcommand arguments
 */
export declare function parseVerifyArgs(args: string[]): VerifyArgs;
/**
 * Print help for verify command
 */
export declare function printVerifyHelp(): void;
/**
 * Main verification function
 */
export declare function runVerification(args: VerifyArgs): Promise<void>;
