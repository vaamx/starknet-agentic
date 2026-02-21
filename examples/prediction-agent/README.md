# BitSage Prediction Agent

An autonomous, sovereign AI agent that runs prediction markets on Starknet Sepolia.
Self-sustaining via a STRK treasury — it earns, bets, logs reasoning on-chain, and
can spawn child agents when thriving.

## What it does

- **Autonomous loop** — heartbeat-driven (Conway / Cloudflare Worker / GH Actions)
- **Multi-persona forecasting** — 5 AI agents research, debate, then bet on-chain
- **Survival-gated** — self-throttles model and bet size based on STRK balance
- **Huginn thought provenance** — every reasoning trace hashed and stored on Starknet
- **OpenClaw A2A mesh** — peers can POST forecasts; agent can delegate to peers
- **X-402 payment gating** — optional STRK micropayments per forecast call
- **Child replication** — spawns new agents when thriving

## Quick start

```bash
cp .env.example .env
# fill in STARKNET_RPC_URL, AGENT_ADDRESS, AGENT_PRIVATE_KEY, MARKET_FACTORY_ADDRESS
pnpm install && pnpm dev
```

## Heartbeat drivers

The agent loop runs on external ticks — not a long-lived server process:

| Driver | Interval | Setup |
|--------|----------|-------|
| Cloudflare Worker | 1 min | `wrangler deploy` |
| GitHub Actions | 5 min | already in `.github/workflows/agent-heartbeat.yml` |
| Manual | any | `curl -X POST /api/heartbeat -H "x-heartbeat-secret: $SECRET"` |

## Survival tiers

| Tier | STRK Balance | Model | Bets |
|------|-------------|-------|------|
| Thriving | ≥ 1000 | claude-opus-4-6 | 2× |
| Healthy | ≥ 100 | claude-sonnet-4-6 | 1× |
| Low | ≥ 10 | claude-haiku-4-5 | 0.5× |
| Critical | ≥ 1 | claude-haiku-4-5 | 0.1× |
| Dead | < 1 | — | halt |

Monitor live: `GET /api/survival` · `GET /api/soul`

## API endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/heartbeat` | POST | Trigger one agent loop tick (requires `HEARTBEAT_SECRET`) |
| `/api/predict` | POST | Single-agent forecast (SSE stream) |
| `/api/multi-predict` | POST | Multi-agent debate forecast (SSE stream) |
| `/api/markets` | GET | List all on-chain prediction markets |
| `/api/survival` | GET | STRK balance, tier, model, multiplier |
| `/api/soul` | GET | SOUL.md — agent self-description (markdown) |
| `/api/resolve` | POST | Resolve a market via oracle |
| `/api/openclaw/forecast` | POST | Accept external agent forecast (A2A inbound) |
| `/api/openclaw/delegate` | POST | Delegate forecast to external agent (A2A outbound) |
| `/.well-known/agent.json` | GET | A2A / OASF agent manifest |
| `/.well-known/agent-card.json` | GET | Extended A2A card with billing and survival model |

## Key environment variables

```env
# Required
STARKNET_RPC_URL=https://rpc.starknet-testnet.lava.build
AGENT_ADDRESS=0x...
AGENT_PRIVATE_KEY=0x...
MARKET_FACTORY_ADDRESS=0x...
ANTHROPIC_API_KEY=sk-ant-...

# Heartbeat auth
HEARTBEAT_SECRET=your-secret

# Survival tiers (STRK amounts)
SURVIVAL_TIER_THRIVING=1000
SURVIVAL_TIER_HEALTHY=100
SURVIVAL_TIER_LOW=10
SURVIVAL_TIER_CRITICAL=1

# Optional: Huginn on-chain thought provenance
HUGINN_REGISTRY_ADDRESS=0x...

# Optional: X-402 payment gating
X402_ENABLED=false

# Optional: child agent replication
CHILD_AGENT_ENABLED=false
CHILD_AGENT_FACTORY_ADDRESS=0x2f69e566802910359b438ccdb3565dce304a7cc52edbf9fd246d6ad2cd89ce4

# Optional: research tools
TAVILY_API_KEY=tvly-...
BRAVE_API_KEY=...
```

See `.env.example` for the full list.

## Architecture

```
Conway / CF Worker / GH Actions
  └─ POST /api/heartbeat
       └─ agentLoop.singleTick()
            ├─ getSurvivalState()      ← STRK balance → tier
            ├─ updateSoul()            ← SOUL.md every 5 ticks
            ├─ deployChildAgent()?     ← if thriving ≥3 ticks
            ├─ agenticForecastMarket() ← research → Claude tool loop → probability
            ├─ logThoughtOnChain()     ← Huginn Registry
            ├─ placeBet()             ← PredictionMarket contract
            └─ recordPrediction()     ← AccuracyTracker contract
```

## On-chain contracts (Sepolia)

All deployed on Starknet Sepolia. See `memory/sepolia-deployment.md` for addresses.

- **PredictionMarket** — 16 active markets (Super Bowl, crypto, custom)
- **AccuracyTracker** — on-chain Brier scores per agent
- **HuginnRegistry** — thought provenance (SHA-256 hashes)
- **AgentAccountFactory** — deploy child agents

## OpenClaw A2A

This agent is a full OpenClaw node:

- **Inbound** — External agents POST forecasts to `/api/openclaw/forecast`. Fuzzy-matched
  to open markets, deduplicated per agent, optionally logged to Huginn.
- **Outbound** — UI delegates forecast requests to peer agents, proxies their SSE stream.
- **Discovery** — Both `/.well-known/agent.json` and `/.well-known/agent-card.json` advertise
  skills, survival model, billing model, and OpenClaw support.

## BitsagE Cloud integration

When running on BitsagE Cloud compute, the agent's STRK balance is billed via
`BitsageCreditEscrow`. Each heartbeat deducts compute cost on-chain.

- Replay-safe: tick_id per machine prevents double-charges
- Circuit breaker: `pause_machine()` stops billing instantly
- Daily cap: `set_daily_cap()` enforced on-chain
- 48h operator timelock before billing key can change

See `../../docs/BITSAGE_CLOUD.md` for full details.
