# Huginn Registry (Cairo)

Starknet contract for agent thought provenance.

Core features:
- Agent registration (`register_agent`)
- Thought hash logging (`log_thought`)
- Optional proof submission (`prove_thought`)
- Verifier address pinned at construction time (`get_verifier`)

Contract source: `src/lib.cairo`

## Sepolia deployment path (v1)

v1 is Sepolia-first. Mainnet deployment is intentionally deferred.

### 1) Configure deployment env

```bash
cp contracts/huginn-registry/scripts/.env.example contracts/huginn-registry/scripts/.env
source contracts/huginn-registry/scripts/.env
```

Required variables:
- `STARKNET_RPC_URL`
- `DEPLOYER_ADDRESS`
- `DEPLOYER_PRIVATE_KEY`
- `HUGINN_VERIFIER_ADDRESS`

### 2) Deploy

```bash
bash contracts/huginn-registry/scripts/deploy_sepolia.sh
```

This script will:
- build the contract (`scarb build`)
- declare `HuginnRegistry`
- deploy with constructor arg `verifier_address`
- write deployment metadata to `contracts/huginn-registry/deployments/sepolia.json`

### 3) Verify

```bash
# reads HUGINN_REGISTRY_ADDRESS from env, or deployments/sepolia.json if present
bash contracts/huginn-registry/scripts/verify_sepolia.sh
```

Checks performed:
- `get_verifier()` call succeeds
- `proof_exists(0)` call succeeds
- optional verifier-address match if `HUGINN_VERIFIER_ADDRESS` is set

### 4) Publish address in repo docs/config

After verification, propagate the deployed registry address to:
- `skills/huginn-onboard/SKILL.md`
- `docs/SOVEREIGN_AGENT.md`
- `examples/prediction-agent/.env.example`
- any environment docs that reference `HUGINN_REGISTRY_ADDRESS`

Keep address publication in the same PR as the `deployments/sepolia.json` update.

## Local tests

```bash
cd contracts/huginn-registry
scarb test
# or
snforge test
```
