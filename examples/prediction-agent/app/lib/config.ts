import { z } from "zod";

const envSchema = z.object({
  STARKNET_RPC_URL: z.string().url().default("https://starknet-sepolia.public.blastapi.io"),
  STARKNET_CHAIN_ID: z.string().default("SN_SEPOLIA"),
  EXECUTION_SURFACE: z.enum(["direct", "starkzap", "avnu"]).default("direct"),
  EXECUTION_PROFILE: z.enum(["standard", "hardened"]).default("hardened"),
  STARKZAP_FALLBACK_TO_DIRECT: z.enum(["true", "false"]).default("false"),
  AGENT_PRIVATE_KEY: z.string().optional(),
  AGENT_ADDRESS: z.string().optional(),
  MARKET_FACTORY_ADDRESS: z.string().default("0x0"),
  ACCURACY_TRACKER_ADDRESS: z.string().default("0x0"),
  COLLATERAL_TOKEN_ADDRESS: z.string().default(
    "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"
  ),
  ANTHROPIC_API_KEY: z.string().optional(),
  IDENTITY_REGISTRY_ADDRESS: z.string().optional(),
  REPUTATION_REGISTRY_ADDRESS: z.string().optional(),
  // Data source API keys
  BRAVE_SEARCH_API_KEY: z.string().optional(),
  COINGECKO_API_KEY: z.string().optional(),
  // Autonomous loop config
  POLYMARKET_ENABLED: z.string().default("true"),
  DATA_REFRESH_INTERVAL_MS: z.string().default("300000"),
  AGENT_LOOP_EXECUTE_BETS: z.enum(["true", "false"]).default("false"),
  AGENT_LOOP_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.15),
});

export const config = envSchema.parse(process.env);

export type Config = z.infer<typeof envSchema>;
