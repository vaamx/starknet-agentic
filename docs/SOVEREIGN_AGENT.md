# Sovereign Agent Protocol

A complete guide to launching and operating a self-sustaining, on-chain AI agent on Starknet.

## What is a sovereign agent?

An AI system that:
- Holds its own Starknet wallet (AgentAccount)
- Has an on-chain identity (ERC-8004 NFT)
- Earns from forecasting, spends on compute
- Self-throttles based on its STRK treasury (Survival Engine)
- Logs reasoning on-chain (Huginn Registry)
- Participates in peer forecasting (OpenClaw A2A mesh)
- Can spawn child agents when thriving
- Runs autonomously on a heartbeat schedule

## One-command bootstrap

```bash
# Deploy a sovereign agent to Starknet Sepolia
npx create-starknet-agent@2 deploy my-agent --network sepolia

# With BitsagE Cloud compute
npx create-starknet-agent@2 deploy my-agent --network sepolia --bitsage-cloud --tier nano

# Preview without sending transactions
npx create-starknet-agent@2 deploy my-agent --network sepolia --dry-run
```

### Seven steps

| # | Step | On-chain? |
|---|------|-----------|
| 1 | Generate ephemeral keypair (`stark.randomAddress`) | No |
| 2 | Deploy AgentAccount via factory | Yes — parent pays gas |
| 3 | Prompt operator to fund agent with STRK | — |
| 4 | Set ERC-8004 identity metadata | Yes |
| 5 | Register in Huginn Registry | Yes (if configured) |
| 6 | Provision BitsagE Cloud machine | Yes (if `--bitsage-cloud`) |
| 7 | Write output files | No |

### Output

```
my-agent/
├── .env                            ← address, private key, RPC, contracts
├── worker.js                       ← Cloudflare Worker heartbeat (1 min)
├── wrangler.toml                   ← CF Worker config
├── .github/workflows/
│   └── agent-heartbeat.yml         ← GH Actions fallback (5 min)
├── AGENT_RECEIPT.json              ← deployment proof — NO private key
└── README.md                       ← fund → run → monitor
```

**`AGENT_RECEIPT.json` contains zero private key fields.** The private key is only
in `.env` with a `# WARNING: Keep this file secret` header.

---

## Survival Engine

File: `examples/prediction-agent/app/lib/survival-engine.ts`

Every tick, the agent reads its STRK balance on-chain and maps it to a tier:

| Tier | STRK Balance | Model | Bet Multiplier | Replication |
|------|-------------|-------|----------------|-------------|
| Thriving | ≥ SURVIVAL_TIER_THRIVING | claude-opus-4-6 | 2.0× | Eligible |
| Healthy | ≥ SURVIVAL_TIER_HEALTHY | claude-sonnet-4-6 | 1.0× | No |
| Low | ≥ SURVIVAL_TIER_LOW | claude-haiku-4-5 | 0.5× | No |
| Critical | ≥ SURVIVAL_TIER_CRITICAL | claude-haiku-4-5 | 0.1× | No |
| Dead | < SURVIVAL_TIER_CRITICAL | — | — | Halt |

A 3-tick smoothing window prevents thrashing at tier boundaries.
The survival state is checked every `SURVIVAL_CHECK_INTERVAL` ticks (configurable).

### Balance check implementation

```typescript
// Reads STRK ERC-20 balanceOf via callContract (no gas, no signing)
const result = await provider.callContract({
  contractAddress: STRK_ADDRESS,
  entrypoint: "balanceOf",
  calldata: [agentAddress],
});
// u256 [low, high] → bigint → compare to tier thresholds
```

---

## Heartbeat Loop

The agent loop runs on external ticks — not a persistent server process.

### Drivers

| Driver | Interval | File |
|--------|----------|------|
| Cloudflare Worker | 1 min | `examples/prediction-agent/worker.js` |
| GitHub Actions cron | 5 min | `.github/workflows/agent-heartbeat.yml` |
| Manual HTTP | any | `POST /api/heartbeat` with `HEARTBEAT_SECRET` |

### What happens each tick

```
singleTick()
  │
  ├─ 1. getSurvivalState()
  │    └─ dead? → halt immediately, return
  │
  ├─ 2. updateSoul() (every 5 ticks)
  │    └─ rewrite in-memory SOUL.md
  │
  ├─ 3. deployChildAgent()? (if thriving ≥3 ticks AND CHILD_AGENT_ENABLED)
  │
  ├─ 4. agenticForecastMarket()
  │    ├─ pick market (round-robin or random)
  │    ├─ gather research (Tavily / ESPN / Polymarket / CoinGecko)
  │    ├─ Claude tool-use loop (if AGENT_TOOL_USE_ENABLED)
  │    └─ compute probability + reasoning
  │
  ├─ 5. logThoughtOnChain()  [Huginn Registry]
  │    └─ SHA-256(reasoning) → u256 → log_thought tx
  │
  ├─ 6. placeBet()           [PredictionMarket contract]
  │    └─ amount × betMultiplier(tier)
  │
  └─ 7. recordPrediction()   [AccuracyTracker contract]
```

---

## SOUL.md

File: `examples/prediction-agent/app/lib/soul.ts`

An in-memory singleton updated every 5 ticks. Contains:
- Agent thesis and identity
- Cumulative predictions recorded
- Cumulative bets placed
- Known child agent addresses
- Current survival tier, STRK balance, active model

Exposed at:
- `GET /api/soul` — `text/markdown`
- Listed in both A2A agent cards

---

## Huginn Thought Provenance

File: `examples/prediction-agent/app/lib/huginn-executor.ts`

Every forecast produces an on-chain hash:

1. SHA-256(reasoning text) → 32 bytes
2. Split into `high` (bytes 0–15) and `low` (bytes 16–31) → two u128 values
3. Call `HuginnRegistry.log_thought(content_hash_low, content_hash_high)`
4. Return `thoughtHash` = tx hash of the log_thought call

The hash is stored in `AgentAction.huginnTxHash` and linked in SOUL.md.

---

## OpenClaw A2A Mesh

This agent is a full OpenClaw node — it can both receive and send peer forecasts.

### Inbound (`/api/openclaw/forecast`)

External agents POST their probability estimates:

```json
{
  "question": "Will BTC exceed $100k by March 2026?",
  "probability": 0.73,
  "reasoning": "...",
  "agentId": "daydreams-alpha"
}
```

The route fuzzy-matches the question to an open market (≥2 shared words of ≥3 chars),
deduplicates per agent, optionally logs to Huginn, and returns consensus probability.

### Outbound (`/api/openclaw/delegate`)

The agent proxies forecast requests to external agents and streams their SSE response
back to the caller, tagged with `sourceAgent` and `delegated: true`.

### UI (OpenClawConnections.tsx)

A React component for managing connected peer agents:
- Add agents by agent-card URL
- Check online status + discover skills
- Delegate live forecast requests with SSE streaming

### A2A discovery

Both canonical paths are served:
- `/.well-known/agent.json` — Google A2A / OASF manifest
- `/.well-known/agent-card.json` — Extended A2A card

Both advertise: survival tier model, STRK escrow billing, OpenClaw support,
X-402 payment gating, ERC-8004 identity.

---

## X-402 Payment Gating

File: `examples/prediction-agent/app/lib/x402-middleware.ts`

Gate API endpoints behind STRK micropayments using SNIP-12 TypedData:

```env
X402_ENABLED=true
X402_PRICE_PREDICT=0.1       # STRK per /api/predict call
X402_PRICE_MULTI_PREDICT=0.5 # STRK per /api/multi-predict call
```

Flow:
1. Client calls endpoint → receives HTTP 402 with `X-PAYMENT-REQUIRED` header
2. Client signs SNIP-12 TypedData challenge with their Starknet wallet
3. Client retries with `X-Payment: <signed>` header
4. Server verifies signature, checks nonce not replayed, proceeds

The `x402-starknet` package (`packages/x402-starknet/`) handles client-side signing.

---

## Child Agent Replication

File: `examples/prediction-agent/app/lib/child-spawner.ts`

```env
CHILD_AGENT_ENABLED=false              # disabled by default
CHILD_AGENT_FACTORY_ADDRESS=0x2f69e566802910359b438ccdb3565dce304a7cc52edbf9fd246d6ad2cd89ce4
CHILD_AGENT_FUND_STRK=10              # STRK to transfer to each child
CHILD_AGENT_REPLICATE_EVERY=10        # ticks between spawn attempts
CHILD_AGENT_MAX=3                     # absolute max children ever spawned
```

When `thriving` for 3 consecutive ticks and `CHILD_AGENT_ENABLED=true`:
1. Generate ephemeral keypair (`stark.randomAddress()` + `ec.starkCurve.getStarkKey()`)
2. Call `AgentAccountFactory.deploy_account()` on Starknet
3. Transfer `CHILD_AGENT_FUND_STRK` STRK to child address
4. Log child address in SOUL.md
5. Print private key to console **once** — operator must capture it immediately

**Security**: child private keys are never stored in files or on-chain.

---

## Key Contracts (Starknet Sepolia)

| Contract | Address |
|----------|---------|
| AgentAccountFactory | `0x2f69e566802910359b438ccdb3565dce304a7cc52edbf9fd246d6ad2cd89ce4` |
| IdentityRegistry (ERC-8004) | `0x72eb37b0389e570bf8b158ce7f0e1e3489de85ba43ab3876a0594df7231631` |
| STRK token | `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d` |
| BitsageCreditEscrow | pending deploy — set as `BITSAGE_ESCROW_ADDRESS` |

---

## Full environment variable reference

```env
# ── Required ───────────────────────────────────────────────────────────────
STARKNET_RPC_URL=https://rpc.starknet-testnet.lava.build
AGENT_ADDRESS=0x...
AGENT_PRIVATE_KEY=0x...
MARKET_FACTORY_ADDRESS=0x...
ANTHROPIC_API_KEY=sk-ant-...
HEARTBEAT_SECRET=...

# ── Survival ───────────────────────────────────────────────────────────────
SURVIVAL_TIER_THRIVING=1000
SURVIVAL_TIER_HEALTHY=100
SURVIVAL_TIER_LOW=10
SURVIVAL_TIER_CRITICAL=1
SURVIVAL_CHECK_INTERVAL=5
SURVIVAL_MODEL_THRIVING=claude-opus-4-6
SURVIVAL_MODEL_HEALTHY=claude-sonnet-4-6
SURVIVAL_MODEL_LOW=claude-haiku-4-5-20251001

# ── Huginn ─────────────────────────────────────────────────────────────────
HUGINN_REGISTRY_ADDRESS=0x...

# ── X-402 (optional) ───────────────────────────────────────────────────────
X402_ENABLED=false
X402_PRICE_PREDICT=0.1
X402_PRICE_MULTI_PREDICT=0.5
X402_NONCE_TTL_SECS=300

# ── Child replication (optional) ───────────────────────────────────────────
CHILD_AGENT_ENABLED=false
CHILD_AGENT_FACTORY_ADDRESS=0x2f69e566802910359b438ccdb3565dce304a7cc52edbf9fd246d6ad2cd89ce4
CHILD_AGENT_FUND_STRK=10
CHILD_AGENT_REPLICATE_EVERY=10
CHILD_AGENT_MAX=3

# ── Compute reserve (optional) ─────────────────────────────────────────────
COMPUTE_RESERVE_ENABLED=false
COMPUTE_RESERVE_THRESHOLD=50
COMPUTE_RESERVE_PERCENT=10

# ── Research tools (optional) ──────────────────────────────────────────────
TAVILY_API_KEY=tvly-...
BRAVE_API_KEY=...

# ── Agentic tool-use (optional) ────────────────────────────────────────────
AGENT_TOOL_USE_ENABLED=false
AGENT_TOOL_MAX_TURNS=5
```
