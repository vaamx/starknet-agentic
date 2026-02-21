import { z } from "zod";

/**
 * Starknet address validator — accepts "0x0" sentinel OR a valid hex address.
 * A Starknet address is 0x followed by 1–64 lowercase hex characters.
 * Leading zeros are stripped by the node so "0x0" and "0x00000" are both valid.
 */
const starknetAddressOrZero = (label: string) =>
  z
    .string()
    .refine(
      (val) => /^0x[0-9a-fA-F]{1,64}$/.test(val),
      { message: `${label} must be '0x0' or a valid hex address (0x + 1–64 hex chars)` }
    );

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
  MARKET_FACTORY_ADDRESS: starknetAddressOrZero("MARKET_FACTORY_ADDRESS").default("0x0"),
  ACCURACY_TRACKER_ADDRESS: starknetAddressOrZero("ACCURACY_TRACKER_ADDRESS").default("0x0"),
  COLLATERAL_TOKEN_ADDRESS: starknetAddressOrZero("COLLATERAL_TOKEN_ADDRESS").default(
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
  // Huginn Registry — on-chain thought provenance
  HUGINN_REGISTRY_ADDRESS: starknetAddressOrZero("HUGINN_REGISTRY_ADDRESS").default("0x0"),
  // Tavily web search (Tavily → Brave fallback when absent)
  TAVILY_API_KEY: z.string().optional(),
  // Agentic tool-use feature flags
  AGENT_TOOL_USE_ENABLED: z.string().default("true"),
  AGENT_TOOL_MAX_TURNS: z
    .string()
    .default("8")
    .refine(
      (val) => {
        const n = parseInt(val, 10);
        return Number.isFinite(n) && n >= 1 && n <= 20;
      },
      { message: "AGENT_TOOL_MAX_TURNS must be an integer between 1 and 20" }
    ),
  // Phase A — Heartbeat authentication
  HEARTBEAT_SECRET: z.string().optional(),
  // Phase B — Survival tier thresholds (STRK amounts)
  SURVIVAL_TIER_THRIVING:  z.string().default("1000"),
  SURVIVAL_TIER_HEALTHY:   z.string().default("100"),
  SURVIVAL_TIER_LOW:       z.string().default("10"),
  SURVIVAL_TIER_CRITICAL:  z.string().default("1"),
  SURVIVAL_CHECK_INTERVAL: z.string().default("3"),
  SURVIVAL_MODEL_THRIVING: z.string().default("claude-opus-4-6"),
  SURVIVAL_MODEL_HEALTHY:  z.string().default("claude-sonnet-4-6"),
  SURVIVAL_MODEL_LOW:      z.string().default("claude-haiku-4-5-20251001"),
  // Phase C — X-402 paywall (default OFF)
  X402_ENABLED:             z.string().default("false"),
  X402_PRICE_PREDICT:       z.string().default("0.1"),
  X402_PRICE_MULTI_PREDICT: z.string().default("0.5"),
  X402_NONCE_TTL_SECS:      z.string().default("300"),
  // Phase D — Child agent wallets (default OFF)
  CHILD_AGENT_FACTORY_ADDRESS: z.string().default("0x2f69e566802910359b438ccdb3565dce304a7cc52edbf9fd246d6ad2cd89ce4"),
  CHILD_AGENT_ENABLED:         z.string().default("false"),
  CHILD_AGENT_FUND_STRK:       z.string().default("50"),
  CHILD_AGENT_REPLICATE_EVERY: z.string().default("100"),
  CHILD_AGENT_MAX:             z.string().default("5"),
  // Phase F — Compute reserve sweep (default OFF)
  COMPUTE_RESERVE_ENABLED:   z.string().default("false"),
  COMPUTE_RESERVE_THRESHOLD: z.string().default("200"),
  COMPUTE_RESERVE_PERCENT:   z.string().default("20"),
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

/**
 * Application configuration — extends rawConfig with:
 * - Defaulted registry addresses (chain-specific fallbacks)
 * - Derived typed helpers so consumers don't re-parse strings ad-hoc
 */
export const config = {
  ...rawConfig,
  // Registry address defaults (chain-aware)
  IDENTITY_REGISTRY_ADDRESS:
    rawConfig.IDENTITY_REGISTRY_ADDRESS ?? defaults.identity,
  REPUTATION_REGISTRY_ADDRESS:
    rawConfig.REPUTATION_REGISTRY_ADDRESS ?? defaults.reputation,
  VALIDATION_REGISTRY_ADDRESS:
    rawConfig.VALIDATION_REGISTRY_ADDRESS ?? defaults.validation,

  // ── Derived typed helpers ─────────────────────────────────────────────
  /** true when Huginn Registry is configured (address != "0x0"). */
  huginnEnabled: rawConfig.HUGINN_REGISTRY_ADDRESS !== "0x0",

  /**
   * true when agentic tool-use is active.
   * false ONLY when AGENT_TOOL_USE_ENABLED is explicitly set to "false".
   * Default is true.
   */
  toolUseEnabled: rawConfig.AGENT_TOOL_USE_ENABLED !== "false",

  /**
   * Parsed integer max tool-use rounds per forecast. Clamped to [1, 20].
   * Consumers should use this instead of re-parsing AGENT_TOOL_MAX_TURNS.
   */
  toolMaxTurns: Math.max(1, Math.min(20, parseInt(rawConfig.AGENT_TOOL_MAX_TURNS, 10) || 8)),

  // ── Phase C: X-402 derived helpers ──────────────────────────────────────
  x402Enabled:           rawConfig.X402_ENABLED === "true",
  x402PricePredict:      parseFloat(rawConfig.X402_PRICE_PREDICT)        || 0.1,
  x402PriceMultiPredict: parseFloat(rawConfig.X402_PRICE_MULTI_PREDICT)  || 0.5,

  // ── Phase D: Child agent derived helpers ─────────────────────────────────
  childAgentEnabled:        rawConfig.CHILD_AGENT_ENABLED === "true",
  childAgentFundStrk:       parseFloat(rawConfig.CHILD_AGENT_FUND_STRK)  || 50,
  childAgentReplicateEvery: parseInt(rawConfig.CHILD_AGENT_REPLICATE_EVERY, 10) || 100,
  childAgentMax:            parseInt(rawConfig.CHILD_AGENT_MAX, 10)       || 5,

  // ── Phase F: Compute reserve derived helpers ─────────────────────────────
  computeReserveEnabled: rawConfig.COMPUTE_RESERVE_ENABLED === "true",
};

export type Config = typeof config;
