# BitsageCreditEscrow

STRK-native compute credit escrow contract for BitsagE Cloud.
Chain-agnostic: accepts any ERC-20 at construction.

See [`../../docs/BITSAGE_CLOUD.md`](../../docs/BITSAGE_CLOUD.md) for full docs.

## Interface

```cairo
fn deposit(amount: u256)            // agent deposits STRK
fn balance_of(agent) -> u256        // read balance
fn withdraw(amount: u256)           // agent withdraws (always available)

fn charge(agent, machine_id: felt252, tick_id: u64, amount: u256) // operator-only, idempotent

fn pause_machine(machine_id: felt252)   // agent pauses billing
fn resume_machine(machine_id: felt252)  // agent resumes
fn set_daily_cap(cap: u256)             // agent sets daily spend cap (0 = unlimited)

fn propose_operator(new_operator)   // owner-only, starts 48h timelock
fn apply_operator()                 // callable by anyone after 48h
fn cancel_operator()                // owner-only
```

## Safety rails

1. **Idempotent charging** — `tick_id` must strictly increase per `(agent, machine_id)`
2. **Circuit breaker** — agent can pause/resume billing per machine instantly
3. **Daily cap** — on-chain enforced max spend per UTC day
4. **48h operator timelock** — agents have time to withdraw before operator key changes

## Build

```bash
scarb build --ignore-cairo-version
```

## Deploy (Sepolia)

```bash
starkli deploy \
  target/dev/bitsage_escrow_BitsageEscrow.contract_class.json \
  <owner> <operator> 0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d
```
