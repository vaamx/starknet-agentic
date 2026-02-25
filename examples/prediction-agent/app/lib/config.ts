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
  AGENT_MIN_EVIDENCE_SOURCES: z.string().default("2"),
  AGENT_MIN_EVIDENCE_POINTS: z.string().default("4"),
  AGENT_CONSENSUS_ENABLED: z.string().default("true"),
  AGENT_CONSENSUS_MAX_PEERS: z.string().default("8"),
  AGENT_CONSENSUS_BRIER_FLOOR: z.string().default("0.05"),
  AGENT_CONSENSUS_LEAD_WEIGHT: z.string().default("1.0"),
  AGENT_CONSENSUS_MIN_PEERS: z.string().default("1"),
  AGENT_CONSENSUS_MIN_PEER_PREDICTIONS: z.string().default("3"),
  AGENT_CONSENSUS_MIN_TOTAL_PEER_WEIGHT: z.string().default("2"),
  AGENT_CONSENSUS_MAX_SHIFT_PCT: z.string().default("15"),
  AGENT_CONSENSUS_AUTOTUNE_ENABLED: z.string().default("true"),
  AGENT_CONSENSUS_AUTOTUNE_WINDOW: z.string().default("24"),
  AGENT_CONSENSUS_AUTOTUNE_MIN_SAMPLES: z.string().default("6"),
  AGENT_CONSENSUS_AUTOTUNE_DRIFT_LOW: z.string().default("0.01"),
  AGENT_CONSENSUS_AUTOTUNE_DRIFT_HIGH: z.string().default("0.08"),
  AGENT_CONSENSUS_AUTOTUNE_MAX_SHIFT_FLOOR_PCT: z.string().default("5"),
  AGENT_CONSENSUS_AUTOTUNE_MIN_PEERS_CAP: z.string().default("4"),
  AGENT_CONSENSUS_AUTOTUNE_MIN_PEER_PREDICTIONS_CAP: z.string().default("8"),
  AGENT_CONSENSUS_AUTOTUNE_MIN_TOTAL_PEER_WEIGHT_CAP: z.string().default("12"),
  AGENT_ALERTING_ENABLED: z.string().default("false"),
  AGENT_ALERT_WEBHOOK_URL: z.string().url().optional(),
  AGENT_ALERT_SLACK_WEBHOOK_URL: z.string().url().optional(),
  AGENT_ALERT_PAGERDUTY_ROUTING_KEY: z.string().optional(),
  AGENT_ALERT_WEBHOOK_MIN_SEVERITY: z
    .enum(["info", "warning", "critical"])
    .default("info"),
  AGENT_ALERT_SLACK_MIN_SEVERITY: z
    .enum(["info", "warning", "critical"])
    .default("warning"),
  AGENT_ALERT_PAGERDUTY_MIN_SEVERITY: z
    .enum(["info", "warning", "critical"])
    .default("critical"),
  AGENT_ALERT_TEST_SECRET: z.string().optional(),
  AGENT_ALERT_COOLDOWN_SECS: z.string().default("600"),
  AGENT_ALERT_ACTION_WINDOW: z.string().default("200"),
  AGENT_ALERT_MIN_CONSENSUS_SAMPLES: z.string().default("10"),
  AGENT_ALERT_ERROR_RATE_THRESHOLD: z.string().default("0.25"),
  AGENT_ALERT_CONSENSUS_BLOCK_RATE_THRESHOLD: z.string().default("0.35"),
  AGENT_ALERT_CONSENSUS_CLAMP_RATE_THRESHOLD: z.string().default("0.4"),
  AGENT_ALERT_FAILOVER_EVENTS_THRESHOLD: z.string().default("3"),
  AGENT_ALERT_HEARTBEAT_ERRORS_THRESHOLD: z.string().default("4"),
  AGENT_ALERT_QUARANTINED_REGIONS_THRESHOLD: z.string().default("2"),
  AGENT_ALERT_REQUEST_TIMEOUT_MS: z.string().default("8000"),
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
  // Phase D2 — Child runtime provisioning (BitsagE Cloud)
  BITSAGE_CLOUD_API_URL: z.string().url().optional(),
  BITSAGE_CLOUD_API_TOKEN: z.string().optional(),
  BITSAGE_CLOUD_ESCROW_ADDRESS: z.string().optional(),
  CHILD_AGENT_SERVER_PROVIDER: z.enum(["bitsage-cloud"]).default("bitsage-cloud"),
  CHILD_AGENT_SERVER_ENABLED: z.string().default("false"),
  CHILD_AGENT_SERVER_TIER: z.enum(["nano", "micro", "small"]).default("nano"),
  CHILD_AGENT_SERVER_REGIONS: z.string().default(""),
  CHILD_AGENT_SERVER_ESCROW_DEPOSIT_STRK: z.string().default("0"),
  CHILD_AGENT_SERVER_HEARTBEAT_EVERY: z.string().default("3"),
  CHILD_AGENT_SERVER_FAILOVER_AFTER_FAILURES: z.string().default("2"),
  CHILD_AGENT_SERVER_MAX_FAILOVERS: z.string().default("5"),
  CHILD_AGENT_SERVER_FAILOVER_COOLDOWN_SECS: z.string().default("180"),
  CHILD_AGENT_SERVER_REGION_QUARANTINE_SECS: z.string().default("600"),
  // Phase F — Compute reserve sweep (default OFF)
  COMPUTE_RESERVE_ENABLED:   z.string().default("false"),
  COMPUTE_RESERVE_THRESHOLD: z.string().default("200"),
  COMPUTE_RESERVE_PERCENT:   z.string().default("20"),
  // Phase G — API rate limiting
  RATE_LIMIT_BACKEND: z.enum(["memory", "upstash"]).default("memory"),
  RATE_LIMIT_GLOBAL_PER_MIN: z.string().default("120"),
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  OPENCLAW_ALLOW_PRIVATE_PEERS: z.string().default("false"),
  OPENCLAW_FORECAST_TTL_HOURS: z.string().default("72"),
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
  agentMinEvidenceSources: Math.max(
    1,
    parseInt(rawConfig.AGENT_MIN_EVIDENCE_SOURCES, 10) || 2
  ),
  agentMinEvidencePoints: Math.max(
    1,
    parseInt(rawConfig.AGENT_MIN_EVIDENCE_POINTS, 10) || 4
  ),
  agentConsensusEnabled: rawConfig.AGENT_CONSENSUS_ENABLED !== "false",
  agentConsensusMaxPeers: Math.max(
    0,
    parseInt(rawConfig.AGENT_CONSENSUS_MAX_PEERS, 10) || 8
  ),
  agentConsensusBrierFloor: Math.max(
    0.001,
    parseFloat(rawConfig.AGENT_CONSENSUS_BRIER_FLOOR) || 0.05
  ),
  agentConsensusLeadWeight: Math.max(
    0.1,
    parseFloat(rawConfig.AGENT_CONSENSUS_LEAD_WEIGHT) || 1.0
  ),
  agentConsensusMinPeers: Math.max(
    0,
    parseInt(rawConfig.AGENT_CONSENSUS_MIN_PEERS, 10) || 1
  ),
  agentConsensusMinPeerPredictions: Math.max(
    1,
    parseInt(rawConfig.AGENT_CONSENSUS_MIN_PEER_PREDICTIONS, 10) || 3
  ),
  agentConsensusMinTotalPeerWeight: Math.max(
    0,
    parseFloat(rawConfig.AGENT_CONSENSUS_MIN_TOTAL_PEER_WEIGHT) || 2
  ),
  agentConsensusMaxShift: Math.max(
    0,
    Math.min(
      0.49,
      (parseFloat(rawConfig.AGENT_CONSENSUS_MAX_SHIFT_PCT) || 15) / 100
    )
  ),
  agentConsensusAutotuneEnabled:
    rawConfig.AGENT_CONSENSUS_AUTOTUNE_ENABLED !== "false",
  agentConsensusAutotuneWindow: Math.max(
    4,
    parseInt(rawConfig.AGENT_CONSENSUS_AUTOTUNE_WINDOW, 10) || 24
  ),
  agentConsensusAutotuneMinSamples: Math.max(
    2,
    parseInt(rawConfig.AGENT_CONSENSUS_AUTOTUNE_MIN_SAMPLES, 10) || 6
  ),
  agentConsensusAutotuneDriftLow: Math.max(
    0,
    parseFloat(rawConfig.AGENT_CONSENSUS_AUTOTUNE_DRIFT_LOW) || 0.01
  ),
  agentConsensusAutotuneDriftHigh: Math.max(
    0.0001,
    parseFloat(rawConfig.AGENT_CONSENSUS_AUTOTUNE_DRIFT_HIGH) || 0.08
  ),
  agentConsensusAutotuneMaxShiftFloor: Math.max(
    0,
    Math.min(
      0.49,
      (parseFloat(rawConfig.AGENT_CONSENSUS_AUTOTUNE_MAX_SHIFT_FLOOR_PCT) || 5) /
        100
    )
  ),
  agentConsensusAutotuneMinPeersCap: Math.max(
    1,
    parseInt(rawConfig.AGENT_CONSENSUS_AUTOTUNE_MIN_PEERS_CAP, 10) || 4
  ),
  agentConsensusAutotuneMinPeerPredictionsCap: Math.max(
    1,
    parseInt(rawConfig.AGENT_CONSENSUS_AUTOTUNE_MIN_PEER_PREDICTIONS_CAP, 10) || 8
  ),
  agentConsensusAutotuneMinTotalPeerWeightCap: Math.max(
    0,
    parseFloat(rawConfig.AGENT_CONSENSUS_AUTOTUNE_MIN_TOTAL_PEER_WEIGHT_CAP) || 12
  ),
  agentAlertingEnabled: rawConfig.AGENT_ALERTING_ENABLED === "true",
  agentAlertWebhookUrl: rawConfig.AGENT_ALERT_WEBHOOK_URL,
  agentAlertSlackWebhookUrl: rawConfig.AGENT_ALERT_SLACK_WEBHOOK_URL,
  agentAlertPagerDutyRoutingKey: rawConfig.AGENT_ALERT_PAGERDUTY_ROUTING_KEY,
  agentAlertWebhookMinSeverity: rawConfig.AGENT_ALERT_WEBHOOK_MIN_SEVERITY,
  agentAlertSlackMinSeverity: rawConfig.AGENT_ALERT_SLACK_MIN_SEVERITY,
  agentAlertPagerDutyMinSeverity:
    rawConfig.AGENT_ALERT_PAGERDUTY_MIN_SEVERITY,
  agentAlertTestSecret:
    rawConfig.AGENT_ALERT_TEST_SECRET ?? rawConfig.HEARTBEAT_SECRET,
  agentAlertCooldownSecs: Math.max(
    0,
    parseInt(rawConfig.AGENT_ALERT_COOLDOWN_SECS, 10) || 600
  ),
  agentAlertActionWindow: Math.max(
    20,
    parseInt(rawConfig.AGENT_ALERT_ACTION_WINDOW, 10) || 200
  ),
  agentAlertMinConsensusSamples: Math.max(
    1,
    parseInt(rawConfig.AGENT_ALERT_MIN_CONSENSUS_SAMPLES, 10) || 10
  ),
  agentAlertErrorRateThreshold: Math.max(
    0,
    Math.min(1, parseFloat(rawConfig.AGENT_ALERT_ERROR_RATE_THRESHOLD) || 0.25)
  ),
  agentAlertConsensusBlockRateThreshold: Math.max(
    0,
    Math.min(
      1,
      parseFloat(rawConfig.AGENT_ALERT_CONSENSUS_BLOCK_RATE_THRESHOLD) || 0.35
    )
  ),
  agentAlertConsensusClampRateThreshold: Math.max(
    0,
    Math.min(
      1,
      parseFloat(rawConfig.AGENT_ALERT_CONSENSUS_CLAMP_RATE_THRESHOLD) || 0.4
    )
  ),
  agentAlertFailoverEventsThreshold: Math.max(
    1,
    parseInt(rawConfig.AGENT_ALERT_FAILOVER_EVENTS_THRESHOLD, 10) || 3
  ),
  agentAlertHeartbeatErrorsThreshold: Math.max(
    1,
    parseInt(rawConfig.AGENT_ALERT_HEARTBEAT_ERRORS_THRESHOLD, 10) || 4
  ),
  agentAlertQuarantinedRegionsThreshold: Math.max(
    1,
    parseInt(rawConfig.AGENT_ALERT_QUARANTINED_REGIONS_THRESHOLD, 10) || 2
  ),
  agentAlertRequestTimeoutMs: Math.max(
    1000,
    parseInt(rawConfig.AGENT_ALERT_REQUEST_TIMEOUT_MS, 10) || 8000
  ),

  // ── Phase C: X-402 derived helpers ──────────────────────────────────────
  x402Enabled:           rawConfig.X402_ENABLED === "true",
  x402PricePredict:      parseFloat(rawConfig.X402_PRICE_PREDICT)        || 0.1,
  x402PriceMultiPredict: parseFloat(rawConfig.X402_PRICE_MULTI_PREDICT)  || 0.5,

  // ── Phase D: Child agent derived helpers ─────────────────────────────────
  childAgentEnabled:        rawConfig.CHILD_AGENT_ENABLED === "true",
  childAgentFundStrk:       parseFloat(rawConfig.CHILD_AGENT_FUND_STRK)  || 50,
  childAgentReplicateEvery: parseInt(rawConfig.CHILD_AGENT_REPLICATE_EVERY, 10) || 100,
  childAgentMax:            parseInt(rawConfig.CHILD_AGENT_MAX, 10)       || 5,
  childServerEnabled:
    rawConfig.CHILD_AGENT_SERVER_ENABLED === "true" &&
    !!rawConfig.BITSAGE_CLOUD_API_URL,
  childServerProvider: rawConfig.CHILD_AGENT_SERVER_PROVIDER,
  childServerTier: rawConfig.CHILD_AGENT_SERVER_TIER,
  childServerRegions: rawConfig.CHILD_AGENT_SERVER_REGIONS
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0),
  childServerEscrowDepositStrk: Math.max(
    0,
    parseFloat(rawConfig.CHILD_AGENT_SERVER_ESCROW_DEPOSIT_STRK) || 0
  ),
  childServerHeartbeatEvery: Math.max(
    1,
    parseInt(rawConfig.CHILD_AGENT_SERVER_HEARTBEAT_EVERY, 10) || 3
  ),
  childServerFailoverAfterFailures: Math.max(
    1,
    parseInt(rawConfig.CHILD_AGENT_SERVER_FAILOVER_AFTER_FAILURES, 10) || 2
  ),
  childServerMaxFailovers: Math.max(
    0,
    parseInt(rawConfig.CHILD_AGENT_SERVER_MAX_FAILOVERS, 10) || 5
  ),
  childServerFailoverCooldownSecs: Math.max(
    0,
    parseInt(rawConfig.CHILD_AGENT_SERVER_FAILOVER_COOLDOWN_SECS, 10) || 180
  ),
  childServerRegionQuarantineSecs: Math.max(
    0,
    parseInt(rawConfig.CHILD_AGENT_SERVER_REGION_QUARANTINE_SECS, 10) || 600
  ),

  // ── Phase F: Compute reserve derived helpers ─────────────────────────────
  computeReserveEnabled: rawConfig.COMPUTE_RESERVE_ENABLED === "true",

  // ── Phase G: Rate limiting derived helpers ───────────────────────────────
  rateLimitBackend: rawConfig.RATE_LIMIT_BACKEND,
  rateLimitGlobalPerMin: Math.max(
    1,
    parseInt(rawConfig.RATE_LIMIT_GLOBAL_PER_MIN, 10) || 120
  ),
  upstashRateLimitEnabled:
    rawConfig.RATE_LIMIT_BACKEND === "upstash" &&
    !!rawConfig.UPSTASH_REDIS_REST_URL &&
    !!rawConfig.UPSTASH_REDIS_REST_TOKEN,
  openclawAllowPrivatePeers: rawConfig.OPENCLAW_ALLOW_PRIVATE_PEERS === "true",
  openclawForecastTtlHours: Math.max(
    1,
    parseInt(rawConfig.OPENCLAW_FORECAST_TTL_HOURS, 10) || 72
  ),
};

export type Config = typeof config;
