/**
 * Types for create-starknet-agent CLI
 */
export type Network = "mainnet" | "sepolia" | "custom";
export type Template = "minimal" | "defi" | "full";
export type DeFiProtocol = "avnu" | "zklend" | "nostra" | "ekubo";
export type ExampleType = "none" | "hello-agent" | "defi-agent";
/**
 * Supported agent platforms for lightweight integration
 */
export type PlatformType = "openclaw" | "claude-code" | "cursor" | "daydreams" | "generic-mcp" | "standalone";
/**
 * Detection confidence level for platforms
 */
export type DetectionConfidence = "high" | "medium" | "low";
/**
 * Detected platform information
 */
export interface DetectedPlatform {
    /** Platform type identifier */
    type: PlatformType;
    /** Human-readable platform name */
    name: string;
    /** Where to write MCP config */
    configPath: string;
    /** Where skills are installed (if applicable) */
    skillsPath?: string;
    /** Where credentials are stored */
    secretsPath?: string;
    /** True if CLI was invoked by an agent (non-TTY, env hints) */
    isAgentInitiated: boolean;
    /** How confident we are in this detection */
    confidence: DetectionConfidence;
    /** What triggered this detection */
    detectedBy: string;
}
export interface ProjectConfig {
    projectName: string;
    network: Network;
    customRpcUrl?: string;
    template: Template;
    defiProtocols: DeFiProtocol[];
    includeExample: ExampleType;
    installDeps: boolean;
    /** Selected platform (from detection or CLI flag) */
    platform?: DetectedPlatform;
}
export interface GeneratedFiles {
    [path: string]: string;
}
export declare const RPC_URLS: Record<Exclude<Network, "custom">, string>;
export declare const TOKEN_ADDRESSES: {
    mainnet: {
        ETH: string;
        STRK: string;
        USDC: string;
        USDT: string;
    };
    sepolia: {
        ETH: string;
        STRK: string;
    };
};
export declare const AVNU_URLS: {
    mainnet: {
        api: string;
        paymaster: string;
    };
    sepolia: {
        api: string;
        paymaster: string;
    };
};
