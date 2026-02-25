# Prediction Agent Launch Checklist

Production checklist for the Starknet superforecasting prediction agent.

## 1. Preflight

- [ ] End-to-end closure pass: `pnpm --filter prediction-agent launch:closure -- --base-url https://<deployment-host>` (interactive human approvals included).
- [ ] Production-hard closure pass: `pnpm --filter prediction-agent launch:closure -- --production --strict --live-alerts --yes --base-url https://<deployment-host> --market-id <id>`.
- [ ] `pnpm --filter prediction-agent preflight` passes locally (env checks + tests + production build).
- [ ] Secret-store audit passes: `pnpm --filter prediction-agent secrets:audit -- --require-upstash --require-alert-channels`.
- [ ] Optional dry run for template env: `pnpm --filter prediction-agent preflight -- --env-file .env.example --allow-placeholders --skip-test --skip-build`.
- [ ] `HEARTBEAT_SECRET` configured (not empty).
- [ ] `AGENT_ADDRESS`, `AGENT_PRIVATE_KEY`, `MARKET_FACTORY_ADDRESS`, `ACCURACY_TRACKER_ADDRESS` configured.
- [ ] `ANTHROPIC_API_KEY` configured.
- [ ] STRK balance funded for the agent wallet.

## 2. Rate Limit and Abuse Controls

- [ ] `RATE_LIMIT_BACKEND` is explicitly set (`memory` or `upstash`).
- [ ] If using Upstash: `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` configured.
- [ ] `AGENT_STATE_BACKEND=upstash` for multi-replica/serverless persistence.
- [ ] `AGENT_STATE_UPSTASH_KEY` configured and stable across replicas.
- [ ] `RATE_LIMIT_GLOBAL_PER_MIN` tuned for expected traffic.
- [ ] Verify 429 behavior on `/api/predict`, `/api/multi-predict`, `/api/openclaw/*`, `/api/heartbeat`.

## 3. Heartbeat and Failover

- [ ] Cloudflare Worker heartbeat enabled (1 minute).
- [ ] GitHub Actions heartbeat enabled as fallback (5 minutes).
- [ ] Manual heartbeat curl tested with `x-heartbeat-secret`.
- [ ] Autonomous mode tested from dashboard (`Run One Tick` and loop toggle).

## 4. Observability

- [ ] Monitor `/api/status` for signer, AI, and registry readiness.
- [ ] Monitor `/api/metrics` (consensus guardrails, runtime failovers, quarantined regions).
- [ ] If `AGENT_ALERTING_ENABLED=true`, verify webhook/Slack/PagerDuty delivery on threshold breach and recovery.
- [ ] Verify severity routing policy (`AGENT_ALERT_SLACK_MIN_SEVERITY=warning`, `AGENT_ALERT_PAGERDUTY_MIN_SEVERITY=critical`) matches incident expectations.
- [ ] Run `/api/alerts/test` in `dryRun=true` and one live `roundtrip` test to confirm trigger + resolve path.
- [ ] Monitor `/api/survival` for balance tier transitions.
- [ ] Monitor `/api/activity` for on-chain/event anomalies.
- [ ] Capture server logs for `rate-limit`, `heartbeat`, and `openclaw` errors.
- [ ] Run deterministic chaos gate: `pnpm --filter prediction-agent chaos:sim -- --strict --min-failover-success-rate 0.6 --max-consensus-block-rate 0.5`.

## 5. Security

- [ ] Secrets are in deployment secret store, not in repo.
- [ ] `AGENT_PRIVATE_KEY` never returned by any API response.
- [ ] X-402 is enabled if monetizing forecast endpoints (`X402_ENABLED=true`).
- [ ] Session signer mode and allowlist strategy reviewed for production.

## 6. Launch Day Runbook

- [ ] Deploy application.
- [ ] Run deployed smoke command: `pnpm --filter prediction-agent smoke:deployed -- --base-url https://<deployment-host> --heartbeat-secret "$HEARTBEAT_SECRET"`.
- [ ] Run smoke calls:
  - [ ] `GET /api/status`
  - [ ] `GET /api/markets`
  - [ ] `POST /api/heartbeat` with secret
  - [ ] `POST /api/predict` on a valid market
- [ ] Verify one forecast loop end-to-end (research -> prediction -> on-chain write).
- [ ] Announce endpoint URLs for A2A:
  - [ ] `/.well-known/agent.json`
  - [ ] `/.well-known/agent-card.json`

## 7. Post-Launch

- [ ] Watch first hour for 429 spikes and heartbeat failures.
- [ ] Verify no stalled loop (`lastTickAt` advancing).
- [ ] Review trade activity and prediction quality metrics.
- [ ] Rotate secrets if any exposure is suspected.
