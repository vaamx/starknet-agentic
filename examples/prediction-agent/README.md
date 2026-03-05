# HiveCaster Prediction Agent

## Production DB (Postgres + Prisma)

1. Set `DATABASE_URL` in `.env` (see `.env.example`).
2. Generate Prisma client:
```bash
npm run prisma:generate
```
3. Apply migrations:
```bash
npm run prisma:migrate:deploy
```

Migration files are in `prisma/migrations/`.

## Auth + RBAC

- Auth is session-cookie based (`hc_session`).
- CSRF protection is enforced for all authenticated mutating routes (`POST/PUT/PATCH/DELETE`) using same-origin + CSRF cookie/header.
- Roles: `owner`, `admin`, `analyst`, `viewer`.
- New signups automatically get an organization + `owner` membership.
- `AUTH_SECRET` must be set to a strong value (>= 32 chars; required in production).
- Agent lifecycle routes are role-locked: list/detail requires `viewer`, spawn/control/remove requires `admin`.
- High-cost endpoints are rate-limited per org/user (`/api/predict`, `/api/multi-predict`, `/api/data-sources`, `/api/agent-loop`).

## Tenant-aware analytics

All forecast/research/execution/audit telemetry is stored org-scoped and powers:

- `GET /api/analytics/overview`
- `GET /api/ops/forecasts`
- `GET /api/ops/research`
- `GET /api/ops/executions`

## Superforecasting engine (Phase 1/2 hardening)

- Multi-agent consensus now uses a weighted ensemble model (calibration/Brier + persona confidence + research quality).
- Each persona now executes a forecast skill plan (base rates, catalyst mapping, scenario tree, disconfirming evidence) and injects that plan into prompt context.
- Consensus responses include:
  - `confidenceInterval` (low/high band)
  - `disagreement` (agent dispersion)
  - `confidenceScore`
  - `marketEdge` and scenario bands (`bear`, `base`, `bull`)
- Research aggregation computes per-source quality signals:
  - reliability, freshness, confidence, coverage, and fetch latency
  - exported to UI and injected into forecasting context
- Analytics overview now includes forecast quality metrics:
  - average Brier, log loss, sharpness, calibration gap, and Brier skill score

## Phase 2B: Reliability backtesting + calibration memory

- Source reliability backtesting is now computed from resolved forecasts + research artifacts, per source (`polymarket`, `coingecko`, `news`, `social`).
- Forecast pipelines consume backtested source reliability to blend with live source quality during inference.
- Per-agent calibration memory (sample count, bias, reliability, memory strength) is applied to forecast probabilities before execution/consensus.
- Data source responses now include source backtest metadata for UI observability.
- Quant analytics now surfaces:
  - source reliability backtesting table
  - agent calibration memory table

## Market creation UX upgrade

- New market flow includes preflight quality scoring, binary/time-bound validation, quick templates, category + resolution criteria inputs, and resolution preview.
- Server-side market quality validation blocks low-quality or duplicate market questions.

## Execution profile hardening

- `EXECUTION_SURFACE` chooses runtime path: `direct`, `starkzap`, or `avnu`.
- `EXECUTION_PROFILE` defaults to `hardened`.
- In `hardened`, Starkzap is restricted to: `placeBet`, `recordPrediction`, `claimWinnings`.
- `createMarket`, `resolveMarket`, and `finalizeMarket` are blocked on Starkzap in `hardened`; use `direct` for those operations.
- `STARKZAP_FALLBACK_TO_DIRECT=true` enables provider-unavailable fallback for allowed Starkzap operations.

## Phase 2C: Runtime + typegen determinism

- Runtime baseline is now Node.js `>=22.0.0` (`package.json` + `.nvmrc`).
- Runtime guardrails are enforced before `dev`, `build`, and `start`.
- Deterministic typed-route generation is enforced via:
  - `pnpm run typegen` (cleans stale `.next` type artifacts then runs `next typegen`)
  - `pnpm run typecheck` (clean + typegen + `tsc --noEmit`)
- Next config pins Turbopack root to this app directory to avoid workspace root drift during builds.

## Production deploy checklist (Phase 2C)

1. Runtime baseline
   - Confirm Node version is `>=22`:
   ```bash
   node -v
   ```
2. Dependencies + Prisma
   - Install and generate Prisma client:
   ```bash
   pnpm install
   pnpm run prisma:generate
   pnpm run prisma:migrate:deploy
   ```
3. Type safety + tests
   - Run deterministic type checks and test suite:
   ```bash
   pnpm run typecheck
   pnpm run test
   ```
4. Build artifact
   - Build production bundle:
   ```bash
   pnpm run build
   ```
5. Env + security gates
   - Verify required env vars (`AUTH_SECRET`, `DATABASE_URL`, Starknet addresses, Anthropic key if used).
   - Verify RBAC + CSRF routes are enabled in deployed config.
6. Functional smoke checks (post-deploy)
   - Auth flow: signup/login/logout/session.
   - Market flow: create -> predict -> multi-predict -> settle path.
   - Analytics flow: overview + exports + source backtest visibility.
