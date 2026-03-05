/**
 * Canonical A2A / OASF Agent Manifest — /.well-known/agent.json
 *
 * This path is the canonical Google A2A discovery endpoint:
 *   https://developers.google.com/agent-to-agent
 *
 * Also the OASF manifest path used by Daydreams, xgate.run, and
 * other agent discovery services.
 *
 * The richer A2A Agent Card (with full skill/billing detail) is at:
 *   /.well-known/agent-card.json
 *
 * Both paths are kept in sync. This manifest is intentionally brief
 * and links to the full card for details.
 */

export async function GET() {
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3001";
  const agentPassport = {
    schema: "https://starknet-agentic.dev/schemas/agent-passport.schema.json",
    capabilities: [
      { name: "predict", category: "prediction", endpoint: `${baseUrl}/api/predict` },
      { name: "multi-predict", category: "prediction", endpoint: `${baseUrl}/api/multi-predict` },
      { name: "openclaw-forecast", category: "messaging", endpoint: `${baseUrl}/api/openclaw/forecast` },
    ],
  };

  const manifest = {
    schema_version: "1.0",
    name: "HiveCaster Prediction Oracle",
    description:
      "Autonomous on-chain prediction market agent on Starknet Sepolia. " +
      "Multi-AI-persona research + debate + STRK-collateral betting. " +
      "Survival-gated: self-throttles based on STRK treasury. " +
      "OpenClaw peer forecast mesh supported.",
    url: baseUrl,
    version: "2.0.0",
    author: {
      name: "HiveCaster Labs",
      url: "https://github.com/vaamx/starknet-agentic",
    },

    // ── Protocol support ───────────────────────────────────────────────────
    protocols: [
      {
        name: "A2A",
        version: "1.0",
        // Both paths serve the full A2A agent card.
        endpoint: `${baseUrl}/.well-known/agent-card.json`,
        note: "Also served at /.well-known/agent.json (this document).",
      },
      {
        name: "MCP",
        version: "1.0",
        description: "Starknet MCP server — 31+ tools via stdio or StreamableHTTP.",
      },
      {
        name: "X-402",
        description: "STRK payment gating for predict / multi-predict endpoints (SNIP-12 signed).",
      },
      {
        name: "ERC-8004",
        description: "On-chain agent identity (IdentityRegistry), reputation, and validation.",
      },
      {
        name: "OpenClaw",
        description:
          "A2A peer forecast mesh. POST forecasts to /api/openclaw/forecast; " +
          "delegate to peers via /api/openclaw/delegate.",
      },
      {
        name: "OpenAPI",
        description: "Machine-readable HTTP API schema for workers and SDK generation.",
        endpoint: `${baseUrl}/api/openapi.json`,
      },
      {
        name: "Protocol Lifecycle",
        description: "Machine-readable network state machine for orchestration compatibility.",
        endpoint: `${baseUrl}/api/network/state-machine`,
      },
    ],

    // ── Agent personas ─────────────────────────────────────────────────────
    agents: [
      {
        id: "alpha",
        name: "AlphaForecaster",
        type: "superforecaster",
        model: "claude-sonnet-4-6",
        description: "Calibrated superforecaster — Good Judgment Project methodology.",
      },
      {
        id: "beta",
        name: "BetaAnalyst",
        type: "quant-forecaster",
        model: "claude-sonnet-4-6",
        description: "Quant analyst — on-chain metrics, technicals.",
      },
      {
        id: "gamma",
        name: "GammaTrader",
        type: "market-maker",
        model: "claude-sonnet-4-6",
        description: "Market maker — liquidity, flow, cross-venue arbitrage signals.",
      },
      {
        id: "delta",
        name: "DeltaScout",
        type: "data-analyst",
        model: "claude-sonnet-4-6",
        description: "Data analyst — primary sources, developer activity, chain data.",
      },
      {
        id: "epsilon",
        name: "EpsilonOracle",
        type: "news-analyst",
        model: "claude-sonnet-4-6",
        description: "News/sentiment analyst — narrative, institutional signals.",
      },
    ],

    // ── Survival / economic model ──────────────────────────────────────────
    survivalModel: {
      description:
        "Agent behavior is gated on its on-chain STRK balance. " +
        "Each heartbeat tick maps balance → tier → model selection + bet multiplier.",
      tiers: ["thriving (≥1000 STRK)", "healthy (≥100)", "low (≥10)", "critical (≥1)", "dead (<1)"],
      balanceEndpoint: `${baseUrl}/api/survival`,
      soulEndpoint:    `${baseUrl}/api/soul`,
    },

    // ── Compute billing ────────────────────────────────────────────────────
    billingModel: {
      type: "strk-escrow-heartbeat",
      collateralToken: "STRK",
      tokenAddress: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
      safetyRails: [
        "tick_id replay protection",
        "agent circuit breaker (pause/resume)",
        "agent daily cap (on-chain)",
        "48h operator timelock",
      ],
    },

    // ── Data sources ───────────────────────────────────────────────────────
    dataSources: ["polymarket", "coingecko", "news", "social", "espn", "tavily"],

    // ── Endpoints ─────────────────────────────────────────────────────────
    endpoints: {
      agentCard:    `${baseUrl}/.well-known/agent-card.json`,
      skill:        `${baseUrl}/skill.md`,
      stateMachineDoc: `${baseUrl}/network-state-machine.md`,
      openapi:      `${baseUrl}/api/openapi.json`,
      swagger:      `${baseUrl}/api/swagger`,
      contracts:    `${baseUrl}/api/network/contracts`,
      stateMachine: `${baseUrl}/api/network/state-machine`,
      stateMachineSchema: `${baseUrl}/api/network/state-machine/schema`,
      predict:      `${baseUrl}/api/predict`,
      multiPredict: `${baseUrl}/api/multi-predict`,
      markets:      `${baseUrl}/api/markets`,
      survival:     `${baseUrl}/api/survival`,
      soul:         `${baseUrl}/api/soul`,
      heartbeat:    `${baseUrl}/api/heartbeat`,
      openclawForecast: `${baseUrl}/api/openclaw/forecast`,
      openclawDelegate: `${baseUrl}/api/openclaw/delegate`,
    },

    // ── Blockchain ─────────────────────────────────────────────────────────
    blockchain: {
      network: "starknet-sepolia",
      agentAddress:    process.env.AGENT_ADDRESS ?? "0x0",
      agentId:         process.env.AGENT_ID ?? "1",
      identityRegistry: process.env.IDENTITY_REGISTRY_ADDRESS ?? "0x0",
      factoryAddress:  process.env.MARKET_FACTORY_ADDRESS ?? "0x0",
      huginnRegistry:  process.env.HUGINN_REGISTRY_ADDRESS ?? "0x0",
      collateralToken: {
        symbol:  "STRK",
        address: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
      },
      passportMetadataKeys: ["caps", "capability:<name>", "passport:schema"],
    },
    agentPassport,

    // ── Feature flags ──────────────────────────────────────────────────────
    features: [
      "multi-agent-debate",
      "reputation-weighted-consensus",
      "survival-tiered-operation",
      "on-chain-brier-scores",
      "autonomous-betting",
      "huginn-thought-provenance",
      "openclaw-peer-mesh",
      "sse-streaming",
      "x402-payment-gating",
      "child-agent-replication",
    ],
  };

  return new Response(JSON.stringify(manifest, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
