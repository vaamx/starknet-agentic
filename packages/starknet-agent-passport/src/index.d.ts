import { type AccountInterface, type ProviderInterface } from "starknet";
export type AgentCapability = {
    /** Stable identifier, ex: "swap" or "balance" */
    name: string;
    /** Human description */
    description?: string;
    /** Optional endpoint or tool id */
    endpoint?: string;
    /** Optional schema/versioning hooks */
    version?: string;
    /** Free-form payload */
    [k: string]: unknown;
};
export declare const PASSPORT_CAPS_KEY: "caps";
/** Standard capability categories for Agent Passport */
export declare const CAPABILITY_CATEGORIES: readonly ["defi", "trading", "identity", "messaging", "payments", "prediction"];
export type CapabilityCategory = (typeof CAPABILITY_CATEGORIES)[number];
export type PassportCapability = {
    name: string;
    category: CapabilityCategory;
    version?: string;
    description?: string;
    endpoint?: string;
};
export type AgentPassport = {
    capabilities: PassportCapability[];
};
/**
 * Validates an Agent Passport object against the schema.
 * Returns { valid: true } or { valid: false, errors: string[] }.
 */
export declare function validatePassport(data: unknown): {
    valid: boolean;
    errors?: string[];
};
export declare function capabilityKey(name: string): string;
export declare function encodeStringAsByteArray(v: string): any;
export declare function decodeByteArrayAsString(v: unknown): string;
export declare function parseCapsList(raw: string | undefined): string[];
export declare function stringifyCapsList(names: string[]): string;
export declare class IdentityRegistryPassportClient {
    private contract;
    constructor(args: {
        identityRegistryAddress: string;
        provider: ProviderInterface;
        account?: AccountInterface;
    });
    agentExists(agentId: bigint): Promise<boolean>;
    getMetadata(agentId: bigint, key: string): Promise<string>;
    setMetadata(agentId: bigint, key: string, value: string): Promise<any>;
    /**
     * Publishes a capability object under `capability:<name>` and updates the `caps` index.
     *
     * Convention:
     * - `caps` is a JSON array of strings (capability names)
     * - each `capability:<name>` value is JSON for the capability object
     */
    publishCapability(args: {
        agentId: bigint;
        capability: AgentCapability;
    }): Promise<{
        caps: string[];
    }>;
}
