/**
 * Platform-specific wizards for create-starknet-agent
 *
 * Each wizard provides a tailored setup flow for its platform,
 * generating appropriate configuration files and installation commands.
 */
import type { DetectedPlatform, Network, GeneratedFiles } from "./types.js";
/**
 * Config scope - where to write MCP config
 */
export type ConfigScope = "local" | "global";
/**
 * Available skills that can be installed
 */
export interface SkillInfo {
    id: string;
    name: string;
    description: string;
    recommended: boolean;
    rawUrl: string;
}
export declare const AVAILABLE_SKILLS: SkillInfo[];
/**
 * Setup modes for non-standalone platforms
 */
export type SetupMode = "full" | "mcp-only" | "skills-only";
/**
 * Wizard configuration result
 */
export interface WizardResult {
    success: boolean;
    platform: DetectedPlatform;
    network: Network;
    setupMode: SetupMode;
    selectedSkills: string[];
    files: GeneratedFiles;
    nextSteps: string[];
    verificationCommand?: string;
}
/**
 * OpenClaw/MoltBook wizard
 */
export declare function openclawWizard(platform: DetectedPlatform, skipPrompts?: boolean, defaultNetwork?: Network, jsonOutput?: boolean, customSkills?: string[], _configScope?: ConfigScope): Promise<WizardResult>;
/**
 * Claude Code wizard
 */
export declare function claudeCodeWizard(platform: DetectedPlatform, skipPrompts?: boolean, defaultNetwork?: Network, jsonOutput?: boolean, customSkills?: string[], defaultConfigScope?: ConfigScope): Promise<WizardResult>;
/**
 * Cursor wizard
 */
export declare function cursorWizard(platform: DetectedPlatform, skipPrompts?: boolean, defaultNetwork?: Network, jsonOutput?: boolean, customSkills?: string[], defaultConfigScope?: ConfigScope): Promise<WizardResult>;
/**
 * Daydreams wizard
 */
export declare function daydreamsWizard(platform: DetectedPlatform, skipPrompts?: boolean, defaultNetwork?: Network, jsonOutput?: boolean, customSkills?: string[], _configScope?: ConfigScope): Promise<WizardResult>;
/**
 * Generic MCP wizard
 */
export declare function genericMcpWizard(platform: DetectedPlatform, skipPrompts?: boolean, defaultNetwork?: Network, jsonOutput?: boolean, customSkills?: string[], _configScope?: ConfigScope): Promise<WizardResult>;
/**
 * Wizard router - routes to the appropriate wizard based on platform type
 */
export declare function runWizard(platform: DetectedPlatform, skipPrompts?: boolean, defaultNetwork?: Network, jsonOutput?: boolean, customSkills?: string[], configScope?: ConfigScope): Promise<WizardResult>;
