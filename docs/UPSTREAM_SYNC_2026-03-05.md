# Upstream Sync -- March 5, 2026

This document captures upstream ecosystem information received after the last roadmap/doc update and converts it into actionable repo work.

## Incoming Signals

### 1) Starkzap used as DeFi execution surface in adversarial Sepolia demo

Reported outcome:
- Autonomous agent executed transfers/swaps through Starkzap.
- Adversarial attempts (oversized spend, revoked session key, forbidden selectors) were blocked by policy/crypto controls.
- Framing: execution (Starkzap) is separated from authorization/policy (starknet-agentic + SISNA envelope).

Provided references:
- X post: `https://x.com/omarespejel/status/2029323422480630089`
- Transfer tx: `https://sepolia.voyager.online/tx/0x3038127239416ed2afc3f6bfa2c1c64ab7bbee4e9a525df88828ebcf942232b`
- Session-key swap tx: `https://sepolia.voyager.online/tx/0x55953168086ab15a4f9b04244107b0f8676b6f2e2b42cf2efe328ac2eb6ab69`
- Oversized spend reverted tx: `https://sepolia.voyager.online/tx/0x3900f732b2e9061350be30707ca7bcf48d16b346041c85ebbff3b90772a3609`

### 2) Starkzap Developer Challenge context

Challenge window:
- Starts: February 24, 2026 10:00 UTC
- Ends: March 17, 2026 23:59 UTC
- Prize distribution: March 18, 2026 before 23:59 UTC

Provided references:
- Starkzap repo: `https://github.com/keep-starknet-strange/starkzap`
- awesome-starkzap repo: `https://github.com/keep-starknet-strange/awesome-starkzap`
- Discord: `https://discord.com/invite/starknet-community`

### 3) Adjacent opportunity signals

Provided context includes:
- OpenClaw agent workflow/operator patterns (mobile-first orchestration, SOUL.md/AGENTS.md/MEMORY.md style, cron/heartbeat reliability).
- Prediction-market builder landscape snapshots (Polymarket app leaderboard, quant content, sports mechanism-design stack).
- LiveKit Agents UI component library for voice-agent frontends:
  `https://github.com/livekit/components-js/tree/main/packages/shadcn`

## Verification Status (as of March 5, 2026)

- Independently confirmed reachable:
  - Starkzap GitHub repo
  - awesome-starkzap GitHub repo
- Not independently confirmed in this environment:
  - X post contents
  - Voyager transaction pages

Treat transaction-level claims as "reported by upstream contact" until reproducible checks are added in-repo.

## Required Repo Updates

### A) Execution-surface architecture update

1. Document a pluggable execution surface model:
   - `Execution Surface`: Starkzap / AVNU / direct contract invoke
   - `Policy Surface`: session key scopes, selector allowlists, spending limits, revocation.
2. Update docs to state that execution and authorization are intentionally decoupled.

### B) Reproducibility work

1. Add a reproducibility harness for the three claimed Sepolia tx scenarios:
   - happy-path transfer
   - session-key swap via proxy
   - oversized spend revert
2. Persist:
   - tx hash
   - calldata summary
   - expected policy check and reason code
   - pass/fail assertions

### C) MCP/server integration track

1. Add a Starkzap-backed swap/transfer provider adapter behind a feature flag.
2. Keep current AVNU path as default until parity tests pass.
3. Add provider parity tests:
   - quote consistency
   - execution success/failure class mapping
   - structured error propagation into MCP responses.

### D) Prediction-market alignment

1. Evaluate a Starkzap-enabled execution path for prediction-agent real bet flow.
2. Keep existing on-chain contract flow intact; add explicit mode selection in config.
3. Add operator-facing docs for when to use:
   - direct market contract calls
   - Starkzap mediated execution.

## Open Questions

1. Should Starkzap become first-class in `packages/starknet-mcp-server` (provider abstraction), or live as a separate package first?
2. Which policy layer is canonical in this repo for adversarial proofs (Agent Account only vs Agent Account + external SISNA policy envelope)?
3. Do we treat challenge-oriented builds (March 2026 window) as short-lived examples or core package investments?

## Immediate Next Actions

- [ ] Add roadmap item for Starkzap execution-surface integration and reproducibility.
- [ ] Add docs section in specification describing execution/policy separation.
- [ ] Create issue group for tx-proof reproducibility and provider parity tests.
- [ ] Add prediction-agent task to support execution mode flags.
