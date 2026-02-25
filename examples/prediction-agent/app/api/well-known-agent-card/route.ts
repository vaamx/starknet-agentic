/**
 * A2A Agent Card — served at both /.well-known/agent-card.json (this route)
 * and /.well-known/agent.json (Next.js rewrites the path via next.config).
 *
 * Follows the Google Agent-to-Agent (A2A) protocol specification:
 *   https://developers.google.com/agent-to-agent
 *
 * Advertises:
 *   - Prediction forecasting skills (single + multi-agent debate)
 *   - Autonomous survival loop (STRK balance-gated, heartbeat-driven)
 *   - On-chain escrow billing model (BitsageCreditEscrow, STRK collateral)
 *   - OpenClaw peer-to-peer forecast mesh (inbound + outbound)
 *   - X-402 STRK payment gating for paid skills
 *   - ERC-8004 on-chain identity + Huginn thought provenance
 */

export async function GET() {
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3001";
  const agentPassport = {
    schema: "https://starknet-agentic.dev/schemas/agent-passport.schema.json",
    capabilities: [
      {
        name: "predict",
        category: "prediction",
        version: "2.0.0",
        description: "Single-agent prediction endpoint for binary markets",
        endpoint: `${baseUrl}/api/predict`,
        a2aSkillId: "predict",
      },
      {
        name: "multi-predict",
        category: "prediction",
        version: "2.0.0",
        description: "Multi-agent superforecasting debate endpoint",
        endpoint: `${baseUrl}/api/multi-predict`,
        a2aSkillId: "multi-predict",
      },
      {
        name: "openclaw-forecast",
        category: "messaging",
        version: "2.0.0",
        description: "Inbound OpenClaw peer forecast intake",
        endpoint: `${baseUrl}/api/openclaw/forecast`,
        a2aSkillId: "openclaw-forecast",
      },
    ],
  };

  const card = {
    // ── Identity ───────────────────────────────────────────────────────────
    name: "BitSage Prediction Oracle",
    description:
      "Autonomous on-chain prediction market agent on Starknet. " +
      "Multi-AI-persona research, debate, and STRK-collateral betting. " +
      "Survival-gated: agent self-throttles based on STRK treasury balance. " +
      "Accepts peer forecasts via OpenClaw A2A mesh.",
    url: baseUrl,
    version: "2.0.0",
    provider: {
      organization: "BitSage Network / keep-starknet-strange",
      url: "https://github.com/keep-starknet-strange/starknet-agentic",
    },

    // ── A2A capabilities ───────────────────────────────────────────────────
    capabilities: {
      streaming: true,
      pushNotifications: false,
      stateTransitionHistory: true,
    },
    authentication: {
      schemes: ["none", "bearer"],
      note: "Bearer token required only if HEARTBEAT_SECRET is set. Forecasting endpoints are open.",
    },

    // ── Survival / economic model ──────────────────────────────────────────
    survivalModel: {
      description:
        "Agent behavior is gated on its STRK treasury balance. " +
        "Each heartbeat tick reads the on-chain STRK balance and maps it to a tier.",
      tiers: {
        thriving: "≥1000 STRK — best model (claude-opus), max bet multiplier, child replication eligible",
        healthy:  "≥100 STRK  — standard model (claude-sonnet), normal bets",
        low:      "≥10 STRK   — economy model (claude-haiku), reduced bets",
        critical: "≥1 STRK    — minimal operation",
        dead:     "<1 STRK    — agent halts; no ticks processed",
      },
      balanceEndpoint: `${baseUrl}/api/survival`,
      soulEndpoint:    `${baseUrl}/api/soul`,
    },

    // ── Compute billing model ──────────────────────────────────────────────
    billingModel: {
      type: "strk-escrow-heartbeat",
      description:
        "Agents deposit STRK into BitsageCreditEscrow on Starknet. " +
        "Each heartbeat (60s) deducts compute cost proportional to machine tier. " +
        "Replay-safe via monotonic tick_id. Agent-controlled circuit breaker and daily cap.",
      collateralToken: {
        symbol: "STRK",
        address: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
        network: "starknet-sepolia",
      },
      tiers: {
        nano:  "0.05 STRK/hr — shared CPU, 256 MB",
        micro: "0.10 STRK/hr — shared CPU, 512 MB",
        small: "0.25 STRK/hr — 2 vCPU, 1 GB",
      },
      safetyRails: [
        "tick_id replay protection (on-chain monotonic counter per machine)",
        "agent-controlled pause/resume per machine",
        "agent-set daily spend cap (on-chain enforced)",
        "48h timelocked operator rotation",
      ],
    },

    // ── Skills ─────────────────────────────────────────────────────────────
    skills: [
      {
        id: "predict",
        name: "Single Agent Forecast",
        description:
          "Run one superforecaster persona on a prediction market question. " +
          "Returns calibrated probability [0,1] with reasoning chain. " +
          "Streams via SSE.",
        endpoint: `${baseUrl}/api/predict`,
        inputModes: ["application/json"],
        outputModes: ["text/event-stream"],
      },
      {
        id: "multi-predict",
        name: "Multi-Agent Forecast with Debate",
        description:
          "Five AI personas (AlphaForecaster, BetaAnalyst, GammaTrader, DeltaScout, EpsilonOracle) " +
          "research independently, then run a debate round. " +
          "Final answer is reputation-weighted consensus.",
        endpoint: `${baseUrl}/api/multi-predict`,
        inputModes: ["application/json"],
        outputModes: ["text/event-stream"],
      },
      {
        id: "openclaw-forecast",
        name: "Accept External Forecast (OpenClaw Inbound)",
        description:
          "External agents POST their probability estimates to join the market consensus. " +
          "Forecasts are fuzzy-matched to open markets, deduplicated per agent, " +
          "and optionally logged to Huginn for on-chain provenance.",
        endpoint: `${baseUrl}/api/openclaw/forecast`,
        inputModes: ["application/json"],
        outputModes: ["application/json"],
      },
      {
        id: "survival",
        name: "Survival Status",
        description:
          "Real-time snapshot: tier, STRK balance, active model, bet multiplier, " +
          "replication eligibility, and child agent count. GET, no auth.",
        endpoint: `${baseUrl}/api/survival`,
        inputModes: [],
        outputModes: ["application/json"],
      },
      {
        id: "soul",
        name: "Soul Document",
        description:
          "Agent self-description (SOUL.md). Updated every 5 ticks. " +
          "Contains thesis, bets placed, predictions recorded, and known children.",
        endpoint: `${baseUrl}/api/soul`,
        inputModes: [],
        outputModes: ["text/markdown"],
      },
      {
        id: "heartbeat",
        name: "Heartbeat Trigger",
        description:
          "Authenticated POST endpoint to trigger one agent loop tick externally. " +
          "Used by Conway scheduler, Cloudflare Workers, and GitHub Actions crons.",
        endpoint: `${baseUrl}/api/heartbeat`,
        inputModes: ["application/json"],
        outputModes: ["application/json"],
      },
      {
        id: "markets",
        name: "List Markets",
        description: "Get all active prediction markets from the on-chain Starknet factory.",
        endpoint: `${baseUrl}/api/markets`,
        inputModes: ["application/json"],
        outputModes: ["application/json"],
      },
      {
        id: "huginn-log",
        name: "Huginn Thought Provenance",
        description:
          "SHA-256 of AI reasoning stored on-chain via Huginn Registry (Starknet Sepolia). " +
          "Returns thought hash for verification.",
        inputModes: ["application/json"],
        outputModes: ["application/json"],
      },
    ],

    // ── X-402 payment gating ───────────────────────────────────────────────
    x402: {
      enabled: process.env.X402_ENABLED === "true",
      endpoints: {
        "/api/predict":       `${process.env.X402_PRICE_PREDICT ?? "0.1"} STRK`,
        "/api/multi-predict": `${process.env.X402_PRICE_MULTI_PREDICT ?? "0.5"} STRK`,
      },
      token: "STRK",
      tokenAddress: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
      recipient: process.env.AGENT_ADDRESS ?? "0x0",
      scheme: "exact-starknet",
    },

    // ── On-chain identity ──────────────────────────────────────────────────
    starknetIdentity: {
      network: "sepolia",
      agentAddress: process.env.AGENT_ADDRESS ?? "0x0",
      agentId: process.env.AGENT_ID ?? "1",
      identityRegistryAddress: process.env.IDENTITY_REGISTRY_ADDRESS ?? "0x0",
      factoryAddress: process.env.MARKET_FACTORY_ADDRESS ?? "0x0",
      huginnRegistryAddress: process.env.HUGINN_REGISTRY_ADDRESS ?? "0x0",
      collateralToken: "STRK",
      standard: "ERC-8004",
      passportMetadataKeys: ["caps", "capability:<name>", "passport:schema"],
    },
    agentPassport,

    // ── Protocol support ───────────────────────────────────────────────────
    protocols: ["A2A", "MCP", "ERC-8004", "X-402"],
    supportsX402: true,
  };

  return new Response(JSON.stringify(card, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
