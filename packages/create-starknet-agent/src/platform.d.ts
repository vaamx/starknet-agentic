/**
 * Platform detection module for create-starknet-agent
 *
 * Detects which agent platform the CLI is running inside and provides
 * appropriate configuration paths for each platform.
 */
import type { DetectedPlatform, PlatformType } from "./types.js";
/**
 * Detect all platforms that may be present, ordered by confidence
 *
 * @returns Array of detected platforms, highest confidence first
 */
export declare function detectPlatforms(): DetectedPlatform[];
/**
 * Get a specific platform by type
 * Returns the platform configuration even if not detected (with low confidence)
 *
 * @param type Platform type to get
 * @returns Platform configuration or undefined if not a valid type
 */
export declare function getPlatformByType(type: PlatformType): DetectedPlatform | undefined;
/**
 * Get display name for a platform
 */
export declare function getPlatformDisplayName(platform: DetectedPlatform): string;
/**
 * Format detected platforms for display
 *
 * @param platforms Array of detected platforms
 * @returns Formatted string for CLI output
 */
export declare function formatDetectedPlatforms(platforms: DetectedPlatform[]): string;
/**
 * Validate platform type string
 */
export declare function isValidPlatformType(type: string): type is PlatformType;
