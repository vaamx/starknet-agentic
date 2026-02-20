import { z } from "zod";

const envSchema = z.object({
  STARKNET_RPC_URL: z.string().url().default("https://rpc.starknet-testnet.lava.build"),
  STARKNET_CHAIN_ID: z.string().default("SN_SEPOLIA"),
  AGENT_PRIVATE_KEY: z.string().optional(),
  AGENT_ADDRESS: z.string().optional(),
  AGENT_SIGNER: z.enum(["owner", "session"]).optional(),
  AGENT_SESSION_PRIVATE_KEY: z.string().optional(),
  AGENT_SESSION_PUBLIC_KEY: z.string().optional(),
  AGENT_SESSION_VALID_AFTER: z.string().optional(),
  AGENT_SESSION_VALID_UNTIL: z.string().optional(),
  AGENT_SESSION_SPENDING_LIMIT_STRK: z.string().default("200"),
  AGENT_SESSION_SPENDING_TOKEN: z.string().optional(),
  AGENT_SESSION_ALLOWED_CONTRACT: z.string().optional(),
  AGENT_SESSION_MAX_CALLS: z.string().default("5"),
  AGENT_SESSION_SPENDING_PERIOD_SECS: z.string().default("86400"),
  AGENT_ALLOWED_CONTRACTS: z.string().optional(),
  AGENT_ALLOWANCE_SELECTOR: z.string().optional(),
  AGENT_ALLOWLIST_AUTO_ADD: z.string().default("true"),
  SESSION_KEY_ADMIN_TOKEN: z.string().optional(),
  AGENT_ID: z.string().default("1"),
  AGENT_ACCOUNT_FACTORY: z.string().optional(),
  MARKET_FACTORY_ADDRESS: z.string().default("0x0"),
  ACCURACY_TRACKER_ADDRESS: z.string().default("0x0"),
  COLLATERAL_TOKEN_ADDRESS: z.string().default(
    "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"
  ),
  ANTHROPIC_API_KEY: z.string().optional(),
  IDENTITY_REGISTRY_ADDRESS: z.string().optional(),
  REPUTATION_REGISTRY_ADDRESS: z.string().optional(),
  VALIDATION_REGISTRY_ADDRESS: z.string().optional(),
  // Data source API keys
  BRAVE_SEARCH_API_KEY: z.string().optional(),
  COINGECKO_API_KEY: z.string().optional(),
  GITHUB_TOKEN: z.string().optional(),
  RSS_SOURCES: z.string().optional(),
  X_BEARER_TOKEN: z.string().optional(),
  X_DEFAULT_QUERY: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHANNELS: z.string().optional(),
  AVNU_BASE_URL: z.string().url().optional(),
  AGENT_DEFI_ENABLED: z.string().default("false"),
  AGENT_DEFI_AUTO_TRADE: z.string().default("false"),
  AGENT_DEFI_MAX_STRK: z.string().default("10"),
  AGENT_DEFI_SIGNAL_THRESHOLD: z.string().default("2"),
  AGENT_DEFI_SELL_TOKEN: z.string().default("STRK"),
  AGENT_DEFI_BUY_TOKEN: z.string().default("ETH"),
  AGENT_DEFI_SLIPPAGE: z.string().default("0.01"),
  AGENT_DEBATE_ENABLED: z.string().default("true"),
  AGENT_DEBATE_INTERVAL: z.string().default("3"),
  // Autonomous loop config
  POLYMARKET_ENABLED: z.string().default("true"),
  DATA_REFRESH_INTERVAL_MS: z.string().default("300000"),
  AGENT_BET_MIN_STRK: z.string().default("5"),
  AGENT_BET_MAX_STRK: z.string().default("10"),
  AGENT_BET_CONFIDENCE_THRESHOLD: z.string().default("0.15"),
});

const rawConfig = envSchema.parse(process.env);

const REGISTRY_DEFAULTS = {
  SN_MAIN: {
    identity: "0x33653298d42aca87f9c004c834c6830a08e8f1c0bd694faaa1412ec8fe77595",
    reputation: "0x698849defe3997eccd3dc5e096c01ae8f4fbc2e49e8d67efcb0b0642447944",
    validation: "0x3c2aae404b64ddf09f7ef07dfb4f723c9053443d35038263acf7d5d77efcd83",
  },
  SN_SEPOLIA: {
    identity: "0x72eb37b0389e570bf8b158ce7f0e1e3489de85ba43ab3876a0594df7231631",
    reputation: "0x5a68b5e121a014b9fc39455d4d3e0eb79fe2327329eb734ab637cee4c55c78e",
    validation: "0x7c8ac08e98d8259e1507a2b4b719f7071104001ed7152d4e9532a6850a62a4f",
  },
} as const;

const defaults =
  rawConfig.STARKNET_CHAIN_ID === "SN_MAIN"
    ? REGISTRY_DEFAULTS.SN_MAIN
    : REGISTRY_DEFAULTS.SN_SEPOLIA;

export const config = {
  ...rawConfig,
  IDENTITY_REGISTRY_ADDRESS:
    rawConfig.IDENTITY_REGISTRY_ADDRESS ?? defaults.identity,
  REPUTATION_REGISTRY_ADDRESS:
    rawConfig.REPUTATION_REGISTRY_ADDRESS ?? defaults.reputation,
  VALIDATION_REGISTRY_ADDRESS:
    rawConfig.VALIDATION_REGISTRY_ADDRESS ?? defaults.validation,
};

export type Config = z.infer<typeof envSchema>;
