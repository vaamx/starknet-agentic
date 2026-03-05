#!/usr/bin/env node
/**
 * create-starknet-agent
 *
 * CLI tool to scaffold a Starknet AI agent project.
 * Run with: npx create-starknet-agent@latest [project-name] [--template <template>]
 */
export declare const EXIT_CODES: {
    readonly SUCCESS: 0;
    readonly CONFIG_ERROR: 1;
    readonly MISSING_CREDENTIALS: 2;
    readonly PLATFORM_NOT_SUPPORTED: 3;
};
export type ConfigScope = "local" | "global";
