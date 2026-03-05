# HiveCaster Deep Dive -- State, Gaps, and Plan (March 5, 2026)

## 1) Executive Summary

HiveCaster can be positioned as:
- **Agentic prediction intelligence on Starknet** (forecasting + reputation)
- **with optional execution surfaces** (direct contract calls now, Starkzap adapter next)
- **and cross-venue market intelligence** (Polymarket/Limitless/Raize scanner as signals layer)

Current repo already has the right primitives in place:
- Cairo prediction market contracts + tests
- Accuracy tracker with Brier-based weighting
- Multi-agent forecasting UI/API scaffold
- Early cross-venue arb signal package

But it is not yet a production superforecasting market stack. Main gaps are:
- execution abstraction (Starkzap/AVNU/direct)
- robust market/data ingestion
- forecast calibration pipeline and evaluation discipline
- policy/authorization hardening integrated into prediction flows

## 2) Repo Reality (What Exists Today)

### 2.1 On-chain prediction core (Cairo)

Path: `contracts/prediction-market/`

Implemented components:
- `market.cairo`
  - binary outcome market
  - collateralized betting (`bet`), oracle resolution (`resolve`), proportional payout (`claim`)
  - implied probability from pool ratios
  - reentrancy guard
- `market_factory.cairo`
  - deploy/create markets, sequential IDs
- `accuracy_tracker.cairo`
  - per-agent prediction recording
  - market finalization and Brier score updates
  - weighted aggregate probability based on inverse avg Brier

Testing signal:
- Extensive snforge tests for market behavior, factory behavior, and Brier math.
- This is a strong foundation for reputation-weighted forecast aggregation.

### 2.2 Prediction-agent app scaffold (Next.js)

Path: `examples/prediction-agent/`

Implemented components:
- Market and leaderboard pages
- Betting endpoint (`/api/bet`) using direct Starknet account execution
- Multi-agent forecasting endpoint (`/api/multi-predict`) with SSE streaming
- Research pipeline with data sources:
  - Polymarket Gamma
  - CoinGecko
  - news/social adapters
- Agent loop engine for autonomous recurring analysis

Key caveat:
- Much of the execution loop is still demo/simulated (especially non-alpha personas and betting loop behavior).

### 2.3 Cross-venue signal engine

Path: `packages/prediction-arb-scanner/`

Implemented components:
- canonical event key normalization
- per-venue snapshot model
- spread/edge scoring
- Opportunity object generation
- Starknet hedge-recipe strings

Key caveat:
- explicitly MVP0, **signals-only**, no execution, partial pairwise logic.

## 3) Upstream + Starkzap Implications

From incoming upstream intel and current roadmap/docs:
- Starkzap is now framed as a real execution surface under a separate policy layer.
- Repo already contains a Starkzap skill and roadmap item for execution-surface integration.
- This aligns well with HiveCaster architecture if we enforce:
  - **execution/policy separation**
  - **provider abstraction**
  - **parity tests across providers**

Practical implication for HiveCaster:
- Forecasting/reputation should remain protocol-native and provider-agnostic.
- Bet/swap/transfer actions should route through a pluggable execution adapter:
  - `direct` (today)
  - `starkzap` (next)
  - `avnu` (where needed)

## 4) Polymarket Builder Logic to Internalize

For app-level reality, winning Polymarket-adjacent products tend to combine:
- speed + UI clarity
- distribution (social, mobile, bots)
- orderflow tooling (alerts, copy flow, portfolio context)
- research context and narrative framing

For HiveCaster, this means:
- Do not only build a prediction UI.
- Build a **decision surface**:
  - market scan
  - forecast rationale
  - confidence/calibration history
  - execution recommendation and constraints

## 5) Quant/Superforecasting Reality Check

What should be considered baseline (not optional):
- Proper scoring rules tracked by market regime and horizon:
  - Brier (already present on-chain)
  - log loss (off-chain analytics)
- Calibration diagnostics:
  - reliability curves
  - sharpness vs calibration decomposition
- Temporal validation discipline:
  - walk-forward backtests
  - no leakage from post-resolution information
- Portfolio/risk overlay:
  - max position sizing
  - drawdown constraints
  - liquidity/slippage-aware expected value

Current status in repo:
- foundation exists (Brier + reputation weighting),
- but no full quant evaluation pipeline yet.

## 6) HiveCaster Positioning (Recommended)

One-line positioning:
- **HiveCaster is a Starknet-native agentic superforecasting market stack with provable reputation and pluggable execution surfaces.**

Three product pillars:
1. **Forecast engine**: multi-agent probabilistic forecasts + uncertainty-aware reasoning
2. **Reputation engine**: on-chain Brier history + weighted consensus
3. **Execution engine**: policy-constrained transaction routing (direct/Starkzap/AVNU)

## 7) Critical Gaps to Close (Priority)

### P0
- Add execution mode abstraction to prediction-agent and MCP paths.
- Add reproducibility tests for adversarial policy scenarios (overspend/revocation/forbidden selectors).
- Add forecast evaluation pipeline (offline) and publish calibration metrics.

### P1
- Upgrade data ingestion for Polymarket/related venues with schema stability + retries + provenance metadata.
- Convert scanner from MVP0 pair logic to robust multi-venue matching.
- Add operator policy templates (risk tiers) for agent execution.

### P2
- Add superforecaster league mechanics (agent cohorts, transparent scoreboards, horizon-specific ratings).
- Add copy-trade / strategy-follow features only after calibration trust threshold is met.

## 8) 30-Day Execution Plan for HiveCaster

Week 1:
- Introduce `EXECUTION_MODE=direct|starkzap|avnu` in prediction-agent.
- Implement adapter interface and keep direct as default.
- Add structured logs for forecast->decision->execution chain.

Week 2:
- Build forecast evaluation job:
  - Brier/log loss by agent, category, and horizon
  - calibration reports
- Persist metrics in a queryable store.

Week 3:
- Integrate Starkzap execution path behind feature flag.
- Add parity tests and failure-class mapping.

Week 4:
- Ship “HiveCaster Console”:
  - market scan
  - agent probability dispersion
  - weighted consensus
  - policy constraints and execution mode transparency

## 9) Risks

- Overfitting to short-term market noise (especially social signals).
- False confidence from simulated/demo paths.
- Execution-policy coupling mistakes if adapters bypass policy checks.
- Liquidity/slippage underestimation in real deployment.

## 10) Definition of Done for “HiveCaster v1”

HiveCaster v1 is real when all are true:
- Forecasts are evaluated continuously with public calibration metrics.
- Reputation-weighted consensus is traceable to historical outcomes.
- Execution can be switched across adapters without changing policy constraints.
- Adversarial policy tests are reproducible and passing.
- End users can distinguish signal quality from speculation hype in the UI.

