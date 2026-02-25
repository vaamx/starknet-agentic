# BitSage Prediction Agent

An autonomous, sovereign AI agent that runs prediction markets on Starknet Sepolia.
Self-sustaining via a STRK treasury — it earns, bets, logs reasoning on-chain, and
can spawn child agents when thriving.

## What it does

- **Autonomous loop** — heartbeat-driven (Conway / Cloudflare Worker / GH Actions)
- **Multi-persona forecasting** — 5 AI agents research, debate, then Brier-weight consensus before betting
- **Survival-gated** — self-throttles model and bet size based on STRK balance
- **Huginn thought provenance** — every reasoning trace hashed and stored on Starknet
- **OpenClaw A2A mesh** — peers can POST forecasts; agent can delegate to peers
- **X-402 payment gating** — optional STRK micropayments per forecast call
- **Child replication** — spawns new agents when thriving, optionally provisioning dedicated BitsagE Cloud runtimes with region failover

## Quick start

```bash
cp .env.example .env
# fill in STARKNET_RPC_URL, AGENT_ADDRESS, AGENT_PRIVATE_KEY, MARKET_FACTORY_ADDRESS
pnpm install
pnpm dev

# before launch (env + tests + production build)
pnpm preflight
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
| `/api/health` | GET | Launch/readiness health summary (healthy/degraded/unhealthy) |
| `/api/metrics` | GET | Runtime/consensus telemetry (`?format=json` or `?format=prometheus`) |
| `/api/alerts/test` | POST | Synthetic alert trigger/resolve test (requires alert test secret; dry-run by default) |
| `/api/predict` | POST | Single-agent forecast (SSE stream) |
| `/api/multi-predict` | POST | Multi-agent debate forecast (SSE stream) |
| `/api/markets` | GET | List markets (`?status=open|all|resolved&limit=20`) with cache fallback |
| `/api/agents` | POST | Spawn agent (`sovereign=true` deploys child wallet; `spawnServer=true` provisions runtime) |
| `/api/agents/:id` | POST | Agent control (`stop`, `pause`, `resume`, `provision_runtime`) |
| `/api/survival` | GET | STRK balance, tier, model, multiplier |
| `/api/soul` | GET | SOUL.md — agent self-description (markdown) |
| `/api/resolve` | POST | Resolve a market via oracle |
| `/api/openclaw/forecast` | POST | Accept external agent forecast (A2A inbound) |
| `/api/openclaw/delegate` | POST | Delegate forecast to external agent (A2A outbound) |
| `/api/proofs` | GET/POST | Proof pipeline (receipt verification, optional Arweave anchor) |
| `/api/proofs/:id` | GET | Proof detail by id |
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
AGENT_TOOL_MAX_TURNS=8
AGENT_LOOP_TICK_TIMEOUT_MS=35000
AGENT_RESEARCH_STEP_TIMEOUT_MS=10000
AGENT_RESEARCH_TOTAL_TIMEOUT_MS=25000
AGENT_MIN_EVIDENCE_SOURCES=2
AGENT_MIN_EVIDENCE_POINTS=4
AGENT_CONSENSUS_ENABLED=true
AGENT_CONSENSUS_MAX_PEERS=8
AGENT_CONSENSUS_BRIER_FLOOR=0.05
AGENT_CONSENSUS_LEAD_WEIGHT=1.0
AGENT_CONSENSUS_MIN_PEERS=1
AGENT_CONSENSUS_MIN_PEER_PREDICTIONS=3
AGENT_CONSENSUS_MIN_TOTAL_PEER_WEIGHT=2
AGENT_CONSENSUS_MAX_SHIFT_PCT=15
AGENT_CONSENSUS_AUTOTUNE_ENABLED=true
AGENT_CONSENSUS_AUTOTUNE_WINDOW=24
AGENT_CONSENSUS_AUTOTUNE_MIN_SAMPLES=6
AGENT_CONSENSUS_AUTOTUNE_DRIFT_LOW=0.01
AGENT_CONSENSUS_AUTOTUNE_DRIFT_HIGH=0.08
AGENT_CONSENSUS_AUTOTUNE_MAX_SHIFT_FLOOR_PCT=5
AGENT_CONSENSUS_AUTOTUNE_MIN_PEERS_CAP=4
AGENT_CONSENSUS_AUTOTUNE_MIN_PEER_PREDICTIONS_CAP=8
AGENT_CONSENSUS_AUTOTUNE_MIN_TOTAL_PEER_WEIGHT_CAP=12

# Heartbeat auth
HEARTBEAT_SECRET=your-secret

# Rate limiting (recommended for production)
RATE_LIMIT_BACKEND=memory            # or upstash
RATE_LIMIT_GLOBAL_PER_MIN=120
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
OPENCLAW_ALLOW_PRIVATE_PEERS=false
OPENCLAW_FORECAST_TTL_HOURS=72

# Survival tiers (STRK amounts)
SURVIVAL_TIER_THRIVING=1000
SURVIVAL_TIER_HEALTHY=100
SURVIVAL_TIER_LOW=10
SURVIVAL_TIER_CRITICAL=1

# Optional: Huginn on-chain thought provenance
# Source of truth (Sepolia): contracts/huginn-registry/deployments/sepolia.json
HUGINN_REGISTRY_ADDRESS=0x...

# Optional: X-402 payment gating
X402_ENABLED=false

# Optional: child agent replication
CHILD_AGENT_ENABLED=false
CHILD_AGENT_FACTORY_ADDRESS=0x2f69e566802910359b438ccdb3565dce304a7cc52edbf9fd246d6ad2cd89ce4

# Optional: child runtime provisioning (each spawned child gets its own server)
BITSAGE_CLOUD_API_URL=
BITSAGE_CLOUD_API_TOKEN=
BITSAGE_CLOUD_ESCROW_ADDRESS=
CHILD_AGENT_SERVER_PROVIDER=bitsage-cloud
CHILD_AGENT_SERVER_ENABLED=false
CHILD_AGENT_SERVER_TIER=nano
CHILD_AGENT_SERVER_REGIONS=iad,sfo,fra
CHILD_AGENT_SERVER_ESCROW_DEPOSIT_STRK=0
CHILD_AGENT_SERVER_HEARTBEAT_EVERY=3
CHILD_AGENT_SERVER_FAILOVER_AFTER_FAILURES=2
CHILD_AGENT_SERVER_MAX_FAILOVERS=5
CHILD_AGENT_SERVER_FAILOVER_COOLDOWN_SECS=180
CHILD_AGENT_SERVER_REGION_QUARANTINE_SECS=600
CHILD_AGENT_SELF_SCHEDULER_ENABLED=false
CHILD_AGENT_SELF_SCHEDULER_INTERVAL_MS=60000
CHILD_AGENT_SELF_SCHEDULER_JITTER_MS=5000

# Optional: per-agent key custody (BYO + sovereign key persistence)
AGENT_KEY_CUSTODY_PROVIDER=memory
AGENT_KEY_CUSTODY_MASTER_KEY=
AGENT_KEY_CUSTODY_AWS_KMS_KEY_ID=
AGENT_KEY_CUSTODY_AWS_REGION=

# Optional: proof pipeline (receipt verify + Arweave anchor via audit relay)
PROOF_PIPELINE_AUTO_ENABLED=true
PROOF_PIPELINE_MAX_RECORDS=500
PROOF_AUDIT_RELAY_URL=
PROOF_AUDIT_RELAY_API_KEY=
PROOF_ARWEAVE_GATEWAY=https://arweave.net

# Optional: metrics alerting hooks (webhook / Slack / PagerDuty)
AGENT_ALERTING_ENABLED=false
AGENT_ALERT_WEBHOOK_URL=
AGENT_ALERT_SLACK_WEBHOOK_URL=
AGENT_ALERT_PAGERDUTY_ROUTING_KEY=
AGENT_ALERT_WEBHOOK_MIN_SEVERITY=info
AGENT_ALERT_SLACK_MIN_SEVERITY=warning
AGENT_ALERT_PAGERDUTY_MIN_SEVERITY=critical
AGENT_ALERT_TEST_SECRET=
AGENT_ALERT_COOLDOWN_SECS=600
AGENT_ALERT_ACTION_WINDOW=200
AGENT_ALERT_MIN_CONSENSUS_SAMPLES=10
AGENT_ALERT_ERROR_RATE_THRESHOLD=0.25
AGENT_ALERT_CONSENSUS_BLOCK_RATE_THRESHOLD=0.35
AGENT_ALERT_CONSENSUS_CLAMP_RATE_THRESHOLD=0.4
AGENT_ALERT_FAILOVER_EVENTS_THRESHOLD=3
AGENT_ALERT_HEARTBEAT_ERRORS_THRESHOLD=4
AGENT_ALERT_QUARANTINED_REGIONS_THRESHOLD=2
AGENT_ALERT_REQUEST_TIMEOUT_MS=8000

# Optional: research tools
TAVILY_API_KEY=tvly-...
BRAVE_SEARCH_API_KEY=...
```

See `.env.example` for the full list.

## Autonomous scheduling

- On Vercel Hobby, per-minute cron is not available.
- Use the existing Cloudflare Worker (`worker.js` + `wrangler.toml`) and/or `.github/workflows/agent-heartbeat.yml` fallback to call `/api/heartbeat`.
- Set `HEARTBEAT_SECRET` in the scheduler and deployment environment so heartbeat stays authenticated.

## Launch operations

- Launch closure runner (preflight + chaos + alerts + smoke + operator confirmations):
  - `pnpm --filter prediction-agent launch:closure -- --base-url https://your-agent.example`
  - Production-hard gate (enforces Upstash + alert channels + real alert delivery):
    - `pnpm --filter prediction-agent launch:closure -- --production --strict --live-alerts --yes --base-url https://your-agent.example --market-id <id>`
  - Add `--yes --live-alerts` for non-interactive production windows
- Secret-store audit only:
  - `pnpm --filter prediction-agent secrets:audit -- --require-upstash --require-alert-channels`
- One-command preflight: `pnpm --filter prediction-agent preflight`
- Preflight with production gate requirements:
  - `pnpm --filter prediction-agent preflight -- --require-upstash --require-alert-channels`
- Template-only validation (without real secrets): `pnpm --filter prediction-agent preflight -- --env-file .env.example --allow-placeholders --skip-test --skip-build`
- Deterministic chaos hardening run: `pnpm --filter prediction-agent chaos:sim -- --strict --min-failover-success-rate 0.6 --max-consensus-block-rate 0.5`
- Alert pipeline dry-run check:
  - `curl -X POST http://localhost:3001/api/alerts/test -H "content-type: application/json" -H "x-heartbeat-secret: $AGENT_ALERT_TEST_SECRET" -d '{"mode":"roundtrip","severity":"warning","dryRun":true}'`
- Deployed smoke checks (health/status/heartbeat/manifests/predict):
  - `pnpm --filter prediction-agent smoke:deployed -- --base-url https://your-agent.example --heartbeat-secret "$HEARTBEAT_SECRET"`
  - Add `--skip-predict` if forecasting dependencies are intentionally disabled
- Preflight and go-live checklist: `LAUNCH_CHECKLIST.md`
- CI launch gate: `.github/workflows/ci.yml` job `prediction-agent-launch`

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
