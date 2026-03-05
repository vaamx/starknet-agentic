/**
 * Credential setup module for create-starknet-agent
 *
 * Provides secure credential input and storage across different platforms.
 */
import type { Network, PlatformType } from "./types.js";
/**
 * Credential storage format
 */
export interface StarknetCredentials {
    accountAddress: string;
    privateKey: string;
    rpcUrl: string;
    network?: Network;
    createdAt: string;
    updatedAt: string;
}
/**
 * Credential validation result
 */
export interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
    accountExists?: boolean;
    balance?: string;
}
/**
 * Parsed credentials command arguments
 */
export interface CredentialsArgs {
    platform?: PlatformType;
    fromEnv: boolean;
    fromReady: boolean;
    fromBraavos: boolean;
    network?: Network;
    jsonOutput: boolean;
    showHelp: boolean;
}
/**
 * Parse credentials subcommand arguments
 */
export declare function parseCredentialsArgs(args: string[]): CredentialsArgs;
/**
 * Print help for credentials command
 */
export declare function printCredentialsHelp(): void;
/**
 * Validate Starknet address format
 * Accepts: 0x followed by 1-64 hex characters
 */
export declare function isValidAddress(address: string): boolean;
/**
 * Validate private key format
 * Accepts: 0x followed by 1-64 hex characters
 */
export declare function isValidPrivateKey(key: string): boolean;
/**
 * Validate RPC URL format
 */
export declare function isValidRpcUrl(url: string): boolean;
/**
 * Validate credentials
 */
export declare function validateCredentials(address: string, privateKey: string, rpcUrl: string): ValidationResult;
/**
 * Main credentials setup flow
 */
export declare function runCredentialsSetup(args: CredentialsArgs): Promise<void>;
