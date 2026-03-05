"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const zod_1 = require("zod");
const envSchema = zod_1.z.object({
    STARKNET_RPC_URL: zod_1.z.string().url().default("https://starknet-sepolia.public.blastapi.io"),
    STARKNET_CHAIN_ID: zod_1.z.string().default("SN_SEPOLIA"),
    EXECUTION_SURFACE: zod_1.z.enum(["direct", "starkzap", "avnu"]).default("direct"),
    AGENT_PRIVATE_KEY: zod_1.z.string().optional(),
    AGENT_ADDRESS: zod_1.z.string().optional(),
    MARKET_FACTORY_ADDRESS: zod_1.z.string().default("0x0"),
    ACCURACY_TRACKER_ADDRESS: zod_1.z.string().default("0x0"),
    COLLATERAL_TOKEN_ADDRESS: zod_1.z.string().default("0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"),
    ANTHROPIC_API_KEY: zod_1.z.string().optional(),
    IDENTITY_REGISTRY_ADDRESS: zod_1.z.string().optional(),
    REPUTATION_REGISTRY_ADDRESS: zod_1.z.string().optional(),
    // Data source API keys
    BRAVE_SEARCH_API_KEY: zod_1.z.string().optional(),
    COINGECKO_API_KEY: zod_1.z.string().optional(),
    // Autonomous loop config
    POLYMARKET_ENABLED: zod_1.z.string().default("true"),
    DATA_REFRESH_INTERVAL_MS: zod_1.z.string().default("300000"),
    AGENT_LOOP_EXECUTE_BETS: zod_1.z.enum(["true", "false"]).default("false"),
    AGENT_LOOP_MIN_CONFIDENCE: zod_1.z.coerce.number().min(0).max(1).default(0.15),
});
exports.config = envSchema.parse(process.env);
