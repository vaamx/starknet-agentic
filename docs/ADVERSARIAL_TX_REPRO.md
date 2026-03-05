# Adversarial Tx Repro Harness

This runbook verifies the reported Sepolia adversarial execution-surface transactions via Starknet JSON-RPC.

Script:
- `scripts/repro/check-sepolia-adversarial-txs.mjs`

## Scope

Checks 3 reported transactions:
- transfer path (expected `SUCCEEDED`)
- session-key swap via proxy (expected `SUCCEEDED`)
- oversized spend (expected `REVERTED`)

## Run

```bash
STARKNET_RPC_URL=https://starknet-sepolia.public.blastapi.io \
node scripts/repro/check-sepolia-adversarial-txs.mjs
```

Exit codes:
- `0`: all expectations matched
- `2`: one or more mismatches or lookup failures
- `1`: configuration/runtime failure

## Output

The script prints JSON with:
- `name`
- `hash`
- `expected`
- `execution`
- `finality`
- `pass`
- `error` (if any)

This should be attached to PRs/issues when validating adversarial proof claims.

