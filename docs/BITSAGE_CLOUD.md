# BitsagE Cloud — STRK-Native Compute Marketplace

A compute marketplace where AI agents pay for server time in STRK.
No SAGE required. No manual Fly.io/Vercel setup. Heartbeat-driven billing with
on-chain replay protection and agent-controlled circuit breakers.

## Overview

```
Agent (Starknet wallet)
  │
  ├─ deposit STRK → BitsageCreditEscrow (on-chain)
  │
  ├─ POST /machines/create → Fly.io machine provisioned
  │
  ├─ POST /machines/{id}/heartbeat (every 60s)
  │    └─ escrow.charge(agent, machine_id, tick_id, cost)
  │         ├─ tick_id > last? (replay protection)
  │         ├─ billing paused? (circuit breaker)
  │         ├─ daily cap exceeded? (spend limit)
  │         └─ deduct from on-chain balance
  │
  └─ withdraw remaining STRK at any time
```

## Components

### 1. BitsageCreditEscrow (Cairo contract)

Location: `contracts/bitsage-escrow/src/bitsage_escrow.cairo`

Chain-agnostic: accepts any ERC-20 at construction. Default: STRK.

```
STRK address (Mainnet + Sepolia):
  0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d
```

#### Interface

```cairo
// Deposit collateral into escrow (agent must approve first)
fn deposit(amount: u256)

// Withdraw unused balance back to wallet (always available)
fn withdraw(amount: u256)

// Check balance
fn balance_of(agent: ContractAddress) -> u256

// Billing — operator-only, idempotent
fn charge(agent, machine_id: felt252, tick_id: u64, amount: u256)

// Circuit breaker — agent-controlled
fn pause_machine(machine_id: felt252)
fn resume_machine(machine_id: felt252)
fn set_daily_cap(cap: u256)   // 0 = no cap

// Timelocked operator rotation
fn propose_operator(new_operator)   // owner-only, starts 48h timelock
fn apply_operator()                 // callable by anyone after 48h
fn cancel_operator()                // owner-only
```

#### Three safety rails

**1. Idempotent charging (replay protection)**

`charge()` requires `tick_id > last_tick[agent][machine_id]`. The tick_id is a
monotonic u64 (e.g. `Math.floor(Date.now() / 60000)` — one per minute).

- Scheduler retries → revert, not double-charge
- Multi-scheduler failover collisions → revert
- API-level replay attacks → revert
- Full `Charged` event emitted for every successful tick (audit trail)

**2. Agent circuit breaker**

Agents can pause/resume billing on any of their machines instantly:

```typescript
// On-chain calls by the agent
await escrow.pause_machine(machine_id)   // stops billing immediately
await escrow.resume_machine(machine_id)  // resumes billing
await escrow.set_daily_cap(strkWei)      // max STRK per UTC day (0 = unlimited)
```

`charge()` checks pause state before any balance mutation. Daily spend is tracked
unconditionally (even without a cap set) for audit purposes.

**3. 48h operator timelock**

The operator address (BitsagE Cloud billing key) can only change after a 48-hour delay:

```
propose_operator(new_addr)   ← owner-only, emits OperatorProposed{apply_after}
wait 48 hours
apply_operator()             ← callable by anyone, completes rotation
```

Agents have 48 hours to `withdraw()` their STRK if they disagree with a key change.
Owner can `cancel_operator()` at any time before `apply_operator()`.

---

### 2. BitsagE Cloud SDK

Location: `packages/bitsage-cloud-sdk/`

```typescript
import { BitsageCloudClient } from "@starknet-agentic/bitsage-cloud-sdk";

const sdk = new BitsageCloudClient({
  baseUrl: "https://api.bitsage.cloud",   // or http://localhost:8080
  rpcUrl: "https://rpc.starknet-testnet.lava.build",
  accountAddress: "0x...",
  privateKey: "0x...",
});

// Deposit STRK into escrow
const txHash = await sdk.depositCredits(10);  // 10 STRK

// Check on-chain balance
const balance = await sdk.getCreditBalance();
// { balanceStrk: "9.950000", balanceWei: "...", estimatedHoursRemaining: { nano: 199, ... } }

// Provision a machine
const machine = await sdk.createMachine({
  agentAddress: "0x...",
  tier: "nano",
  envVars: { MY_VAR: "value" },
});
// { id, flyMachineId, tier, status, createdAt }

// Heartbeat (deducts compute cost)
await sdk.heartbeatMachine(machine.id);
// { ok: true, remainingWei: "..." }

// List and destroy
const machines = await sdk.listMachines();
await sdk.destroyMachine(machine.id);
```

#### X-402 handling

The SDK automatically handles 402 responses:
1. Call API with no payment headers
2. If 402 → parse `X-PAYMENT-REQUIRED` header → sign SNIP-12 TypedData
3. Retry with `X-Payment` signed header
4. Second 402 → throw `BitsageInsufficientBalanceError`

---

### 3. BitsagE Cloud API Service

Location: `services/bitsage-cloud/`

Fastify API server that bridges agents to Fly.io machines and the on-chain escrow.

#### Routes

```
POST /machines/create
  Body: { agentAddress, tier?, envVars? }
  Requires: ≥1 hour of STRK in escrow upfront
  Returns: { id, flyMachineId, tier, status, createdAt }

POST /machines/:id/heartbeat
  Deducts compute cost. tick_id = Math.floor(Date.now()/60000).
  If balance < cost → marks machine "dead", terminates Fly machine (async)
  Returns: { ok: true, remainingWei } or { ok: false, terminated: true }

GET /machines/:id
GET /machines?agent=0x...

DELETE /machines/:id
  Marks dead, destroys Fly machine.

GET /credits/:address
  Returns: { agentAddress, balanceStrk, balanceWei, estimatedHoursRemaining }
```

#### Machine tiers

| Tier | CPU | RAM | STRK/hr |
|------|-----|-----|---------|
| `nano` | 1 shared | 256 MB | 0.05 |
| `micro` | 1 shared | 512 MB | 0.10 |
| `small` | 2 shared | 1 GB | 0.25 |

Prices use pure BigInt arithmetic — no float precision loss.

#### Environment variables

```env
# Fly.io
FLY_API_TOKEN=fo1_...
FLY_APP_NAME=my-agents-app
FLY_AGENT_IMAGE=ghcr.io/keep-starknet-strange/prediction-agent:latest

# Starknet operator
BITSAGE_OPERATOR_ADDRESS=0x...
BITSAGE_OPERATOR_PRIVATE_KEY=0x...
BITSAGE_ESCROW_ADDRESS=0x...    # BitsageCreditEscrow deployed address
STARKNET_RPC_URL=https://rpc.starknet-testnet.lava.build
STARKNET_NETWORK=SN_SEPOLIA

# Service
PORT=8080
DATABASE_URL=./bitsage.db

# X-402 gating (optional)
X402_ENABLED=true
```

#### Database schema (SQLite)

```sql
CREATE TABLE machines (
  id              TEXT PRIMARY KEY,      -- internal UUID
  fly_machine_id  TEXT UNIQUE NOT NULL,  -- Fly.io machine ID
  agent_address   TEXT NOT NULL,         -- Starknet address
  tier            TEXT NOT NULL,
  status          TEXT DEFAULT 'starting', -- starting | running | dead
  created_at      TEXT NOT NULL,
  last_heartbeat  TEXT,
  deducted_total  TEXT DEFAULT '0'       -- bigint as string
);
```

#### Running locally

```bash
cd services/bitsage-cloud
cp .env.example .env
pnpm install && pnpm build
X402_ENABLED=false pnpm start

# Test balance endpoint
curl http://localhost:8080/credits/0x1491...
```

#### Deploying to Fly.io

```bash
cd services/bitsage-cloud
fly deploy
fly secrets set FLY_API_TOKEN=... BITSAGE_OPERATOR_PRIVATE_KEY=...
```

---

## Deploying BitsageCreditEscrow to Sepolia

```bash
cd contracts/bitsage-escrow
scarb build --ignore-cairo-version

# Deploy with starkli or sncast
starkli deploy \
  --account ~/.starkli-wallets/operator.json \
  target/dev/bitsage_escrow_BitsageEscrow.contract_class.json \
  <owner_address> \
  <operator_address> \
  0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d
  # ^ STRK token on Sepolia
```

Record the deployed address as `BITSAGE_ESCROW_ADDRESS` in all service `.env` files.

---

## Security design

### Trust model

```
Owner (multisig or deployer)
  └─ can: set_operator (via 48h timelock), transfer ownership

Operator (BitsagE Cloud API key)
  └─ can: charge() only
  └─ cannot: withdraw agent funds, change owner, skip timelock

Agent (Starknet wallet)
  └─ can: deposit, withdraw (always), pause_machine, set_daily_cap
  └─ cannot: charge themselves, change operator
```

### What stops the operator from overdrafting?

- `charge()` asserts `prev >= amount` before deducting — on-chain, uncircumventable
- Agent can `pause_machine()` instantly to stop all billing
- Agent can `set_daily_cap()` to limit daily exposure
- Agent can `withdraw()` their full balance at any time
- Operator key change requires 48h timelock — agents have time to exit

### Cairo ERC-20 import note

The contract uses an inline `IERC20Transfer` interface instead of importing from OZ.
This avoids module path churn between OZ versions (v3.0.0 restructured `token::erc20::interface`).
The inline approach is more robust across Cairo/OZ version upgrades.

---

## Integration with prediction agent survival loop

The prediction agent's survival engine (`survival-engine.ts`) reads STRK balance
directly from the STRK ERC-20 contract — **not** from BitsagE Cloud's escrow balance.

The two are separate:
- **STRK wallet balance** → survival tier, model selection, bet sizing
- **Escrow balance** → compute billing (BitsagE Cloud deducts here)

Agents should maintain enough STRK in their wallet for both:
- Prediction collateral (bets)
- Compute budget (deposited into escrow)

The `COMPUTE_RESERVE_ENABLED` flag in the prediction agent can automatically hold back
a percentage of STRK from betting to ensure compute budget is never exhausted.
