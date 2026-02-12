---
name: cairo-security
description: Use when reviewing Cairo contracts for security — common vulnerabilities, audit patterns, production hardening, Cairo-specific pitfalls, L1/L2 bridging safety, session key security. Sourced from public audits and the Cairo Book.
license: Apache-2.0
metadata: {"author":"starknet-agentic","version":"2.0.0","org":"keep-starknet-strange"}
keywords: [cairo, security, audit, vulnerabilities, access-control, reentrancy, starknet, production, hardening, l1-l2, session-keys]
allowed-tools: [Bash, Read, Write, Glob, Grep, Task]
user-invocable: true
---

# Cairo Security

Security patterns and common vulnerabilities for Cairo smart contracts on Starknet. Sourced from public audit reports, the [Cairo Book security chapter](https://book.cairo-lang.org/ch104-01-general-recommendations.html), [Crytic's Not So Smart Contracts](https://github.com/crytic/building-secure-contracts/tree/master/not-so-smart-contracts/cairo), [Code4rena Starknet Perpetual audit](https://code4rena.com/reports/2025-03-starknet-perpetual), and [chipi-pay Nethermind AuditAgent findings](https://github.com/chipi-pay/sessions-smart-contract).

> **Workflow:** Use this skill as a review pass after your contract compiles and tests pass. Not a replacement for a professional audit.

## When to Use

- Reviewing a contract before audit or deployment
- Checking for common Cairo/Starknet vulnerabilities
- Hardening a contract for production
- Implementing access control, upgrade safety, input validation
- Writing session key or delegated execution contracts
- Reviewing L1/L2 bridge handlers

**Not for:** Writing contracts (use cairo-contracts), testing (use cairo-testing), gas optimization (use cairo-optimization)

## Pre-Deployment Checklist

Before any mainnet deployment:

- [ ] All tests pass (`snforge test`)
- [ ] No `unwrap()` on user-controlled inputs — use `expect()` or pattern match
- [ ] Access control on all state-changing functions
- [ ] Zero-address checks on constructor arguments
- [ ] Initializer can only be called once
- [ ] Events emitted for all state changes (upgrades, config, pausing, privileged actions)
- [ ] No storage collisions between components
- [ ] Upgrade function protected by owner/admin check
- [ ] Checks-effects-interactions pattern on all external calls
- [ ] No unbounded loops on user-controlled data
- [ ] L1 handler validates `from_address` against trusted L1 contract
- [ ] Boolean returns from ERC20 `transfer`/`transfer_from` checked
- [ ] Operator precedence verified in complex boolean expressions
- [ ] Bit-packing does not exceed 251 bits for felt252
- [ ] Contract verified on block explorer

---

## 1. Access Control, Upgrades & Initializers

*Source: [Cairo Book ch104](https://book.cairo-lang.org/ch104-01-general-recommendations.html), [Code4rena Starknet Perpetual H-02](https://code4rena.com/reports/2025-03-starknet-perpetual)*

The most common critical findings in Starknet audits are "who can call this?" and "can this be re-initialized?"

### Missing Access Control

```cairo
// BAD — anyone can mint
fn mint(ref self: ContractState, to: ContractAddress, amount: u256) {
    self.erc20.mint(to, amount);
}

// GOOD — only minter role
fn mint(ref self: ContractState, to: ContractAddress, amount: u256) {
    self.access_control.assert_only_role(MINTER_ROLE);
    self.erc20.mint(to, amount);
}
```

### Unprotected Upgrade (Full Contract Takeover)

If a non-authorized user can upgrade, they replace the class with anything and get full control.

```cairo
// BAD — anyone can upgrade
fn upgrade(ref self: ContractState, new_class_hash: ClassHash) {
    self.upgradeable.upgrade(new_class_hash);
}

// GOOD — owner-only, with event
fn upgrade(ref self: ContractState, new_class_hash: ClassHash) {
    self.ownable.assert_only_owner();
    self.upgradeable.upgrade(new_class_hash);
    self.emit(Upgraded { new_class_hash });
}
```

### Re-Initializable Initializer

A publicly exposed initializer that can be called post-deploy is a frequent vulnerability.

```cairo
// BAD — can be called multiple times
fn initializer(ref self: ContractState, owner: ContractAddress) {
    self.ownable.initializer(owner);
}

// GOOD — one-shot guard
#[storage]
struct Storage {
    initialized: bool,
}

fn initializer(ref self: ContractState, owner: ContractAddress) {
    assert!(!self.initialized.read(), "ALREADY_INIT");
    self.initialized.write(true);
    self.ownable.initializer(owner);
}
```

**Rule:** If it must be external during deployment, make sure it can only be called once. If it doesn't need to be external, keep it internal.

---

## 2. Checks-Effects-Interactions (Reentrancy)

*Source: [0xEniotna/Starknet-contracts-vulnerabilities](https://github.com/0xEniotna/Starknet-contracts-vulnerabilities), Code4rena Starknet Perpetual H-02*

Code4rena's H-02 finding on Starknet Perpetual: `_execute_transfer` applied state diffs *before* performing checks. Always: check, then update state, then call external contracts.

```cairo
// BAD — state update after external call (reentrancy window)
fn withdraw(ref self: ContractState, amount: u256) {
    let caller = get_caller_address();
    let balance = self.balances.read(caller);
    assert(balance >= amount, 'Insufficient balance');

    IERC20Dispatcher { contract_address: self.token.read() }
        .transfer(caller, amount);       // external call FIRST

    self.balances.write(caller, balance - amount);  // state update AFTER
}

// GOOD — checks-effects-interactions
fn withdraw(ref self: ContractState, amount: u256) {
    let caller = get_caller_address();
    let balance = self.balances.read(caller);
    assert(balance >= amount, 'Insufficient balance');

    self.balances.write(caller, balance - amount);  // state update FIRST

    IERC20Dispatcher { contract_address: self.token.read() }
        .transfer(caller, amount);       // external call LAST
}
```

---

## 3. Cairo-Specific Pitfalls

*Source: [Cairo Book ch104](https://book.cairo-lang.org/ch104-01-general-recommendations.html)*

These are unique to Cairo and not found in Solidity auditing guides.

### Operator Precedence Bug

In Cairo, `&&` has higher precedence than `||`. Combined boolean expressions must be parenthesized.

```cairo
// BAD — && binds tighter than ||, so this means:
// mode == None || (mode == Recovery && coll_ok && debt_ok)
assert!(
    mode == Mode::None || mode == Mode::Recovery && ctx.coll_ok && ctx.debt_ok,
    "EMERGENCY_MODE"
);

// GOOD — explicit parentheses
assert!(
    (mode == Mode::None || mode == Mode::Recovery) && (ctx.coll_ok && ctx.debt_ok),
    "EMERGENCY_MODE"
);
```

### Unsigned Loop Underflow

Decrementing a `u32` counter past 0 panics. Use signed integers or explicit break.

```cairo
// BAD — panics when i decrements below 0
let mut i: u32 = n - 1;
while i >= 0 {  // always true for unsigned, then underflow panic
    process(i);
    i -= 1;
}

// GOOD — signed counter
let mut i: i32 = (n.try_into().unwrap()) - 1;
while i >= 0 {
    process(i.try_into().unwrap());
    i -= 1;
}
```

### Bit-Packing Overflow into felt252

Packing multiple fields into one `felt252` is common for gas optimization, but the sum of field sizes must not exceed 251 bits.

```cairo
// GOOD — explicit width checks before packing
fn pack_order(book_id: u256, tick_u24: u256, index_u40: u256) -> felt252 {
    assert!(book_id < (1_u256 * POW_2_187), "BOOK_OVER");
    assert!(tick_u24 < (1_u256 * POW_2_24), "TICK_OVER");
    assert!(index_u40 < (1_u256 * POW_2_40), "INDEX_OVER");
    let packed: u256 = (book_id * POW_2_64) + (tick_u24 * POW_2_40) + index_u40;
    packed.try_into().expect("PACK_OVERFLOW")
}
```

### `deploy_syscall(deploy_from_zero=true)` Collisions

Deterministic deployment from zero can collide if two contracts deploy with the same calldata. Set `deploy_from_zero` to `false` unless you specifically need deterministic addresses.

### `get_caller_address().is_zero()` Is Useless

On Starknet, `get_caller_address()` is never the zero address (unlike Solidity's `msg.sender` for contract creation). Zero-address checks on caller are dead code.

### Unsafe `unwrap()` on User Input

*Source: [chipi-pay Nethermind AuditAgent finding #9](https://github.com/chipi-pay/sessions-smart-contract) — DoS via unsafe unwrap*

```cairo
// BAD — panics if conversion fails, exploitable DoS
let value: u64 = input.try_into().unwrap();

// GOOD — safe conversion
let value: u64 = match input.try_into() {
    Option::Some(v) => v,
    Option::None => { return 0; }  // safe failure, no panic
};
```

---

## 4. Token Integration Pitfalls

*Source: [Cairo Book ch104](https://book.cairo-lang.org/ch104-01-general-recommendations.html)*

### Always Check Boolean Returns

While OpenZeppelin's ERC20 reverts on failure, not all ERC-20 implementations do. Some return `false` without panicking.

```cairo
// BAD — ignores return value
IERC20Dispatcher { contract_address: token }.transfer(to, amount);

// GOOD — check the return
let success = IERC20Dispatcher { contract_address: token }.transfer(to, amount);
assert(success, 'Transfer failed');
```

### CamelCase / snake_case Dual Interfaces

Most ERC20 tokens on Starknet use `snake_case`. Legacy tokens may have `camelCase` entrypoints (`transferFrom` vs `transfer_from`). If your contract interacts with arbitrary tokens, handle both or verify the tokens you'll integrate with.

---

## 5. L1/L2 Bridging Safety

*Source: [Crytic/building-secure-contracts](https://github.com/crytic/building-secure-contracts/tree/master/not-so-smart-contracts/cairo)*

### L1 Handler Must Validate Caller

The `#[l1_handler]` attribute marks an entrypoint as callable from L1. Always validate that `from_address` is the trusted L1 contract.

```cairo
// BAD — anyone on L1 can call this
#[l1_handler]
fn handle_deposit(
    ref self: ContractState,
    from_address: felt252,
    account: ContractAddress,
    amount: u256
) {
    self.balances.write(account, self.balances.read(account) + amount);
}

// GOOD — validate L1 caller
#[l1_handler]
fn handle_deposit(
    ref self: ContractState,
    from_address: felt252,
    account: ContractAddress,
    amount: u256
) {
    let l1_bridge = self.l1_bridge.read();
    assert!(!l1_bridge.is_zero(), "UNINIT_BRIDGE");
    assert!(from_address == l1_bridge, "ONLY_L1_BRIDGE");
    self.balances.write(account, self.balances.read(account) + amount);
}
```

### L1-to-L2 Message Failure

L1->L2 messages can fail silently if the L2 handler reverts. The message stays in a "pending" state and can be retried, but the L1 side may have already updated its state. Design for idempotent handlers or include replay protection.

### L1/L2 Address Conversion

L1 (Ethereum) addresses are 20 bytes. Starknet addresses are felt252. Incorrect conversion or comparison between the two is a common bug. Always use explicit conversion functions and never compare raw values across domains.

### Replay Protection

Cross-chain messages need nonces or unique identifiers to prevent replay. If a message can be re-consumed, an attacker can double-credit.

---

## 6. Economic / DoS Patterns

*Source: [Cairo Book ch104](https://book.cairo-lang.org/ch104-01-general-recommendations.html)*

### Unbounded Loops

User-controlled iterations can exceed the Starknet steps limit, bricking the contract permanently — no one can interact with it anymore.

```cairo
// BAD — unbounded loop, attacker grows the list to exceed step limit
fn process_all(ref self: ContractState) {
    let mut i = 0;
    let count = self.pending_count.read();
    while i < count {
        self._process(i);
        i += 1;
    }
}

// GOOD — pagination pattern with bounded iterations
fn process_batch(ref self: ContractState, start: u64, max: u64) -> u64 {
    let mut i = start;
    let end = core::cmp::min(self.pending_count.read(), start + max);
    while i < end {
        self._process(i);
        i += 1;
    }
    end  // return next cursor
}
```

### Bad Randomness

Never use `block_timestamp`, `block_number`, or transaction hashes as randomness sources. They are known to validators/sequencers before execution. Use Pragma VRF or similar oracle-based randomness.

---

## 7. Session Key Security

*Source: [chipi-pay SNIP draft and Nethermind AuditAgent findings](https://github.com/chipi-pay/sessions-smart-contract) — 18 findings across 4 scans*

For contracts implementing session key delegation (relevant to AI agents):

### Admin Selector Blocklist

Session keys MUST NOT be able to call privileged functions. Each of these was discovered in a separate Nethermind audit scan:

```cairo
const BLOCKED_SELECTORS: [felt252; 7] = [
    selector!("upgrade"),                   // scan 1: contract replacement
    selector!("add_or_update_session_key"), // scan 1: create unrestricted sessions
    selector!("revoke_session_key"),        // scan 1: revoke other sessions
    selector!("__execute__"),               // scan 2: nested execution privilege escalation
    selector!("set_public_key"),            // scan 3: owner key rotation (OZ PublicKeyImpl)
    selector!("setPublicKey"),              // scan 3: owner key rotation (OZ PublicKeyCamelImpl)
    selector!("execute_from_outside_v2"),   // scan 3: nested SNIP-9 double-consumption
];
```

**Key lesson:** The denylist approach is inherently fragile — each audit scan found new selectors. Prefer the self-call block (below) as the primary defense.

### Self-Call Block (Primary Defense)

Block ALL calls where `call.to == get_contract_address()` when the session has no explicit whitelist. This eliminates the entire class of privilege escalation via self-calls, protecting against any future OZ embedded impl exposing new privileged selectors.

```cairo
// In validation, when allowed_entrypoints_len == 0:
for call in calls {
    assert(call.to != get_contract_address(), 'SESSION_NO_SELF_CALL');
}
```

### Spending Limits (Value Control)

Selector whitelists control *which functions* a session can call, but not *how much value* each call moves. A session authorized to call `transfer` can transfer the entire balance.

```cairo
struct SpendingPolicy {
    token_address: ContractAddress,
    max_amount_per_call: u256,
    max_amount_per_window: u256,    // rolling window cap
    window_seconds: u64,             // e.g., 86400 = 24h
    amount_spent_in_window: u256,
    window_start: u64,
}
```

**Why rolling window instead of total cap?** A total cap (`max = 100 USDC`) doesn't protect against burst attacks — the attacker drains it in one call. A rolling window (`max 10 USDC per 24h`) limits damage even if the key is compromised for days.

### Call Consumption Ordering

*Source: chipi-pay Nethermind scan 2, finding #3*

Increment `calls_used` AFTER signature verification, not before. Otherwise a session with `max_calls = 1` fails on its first valid use because the counter was incremented before the limit check runs.

### `is_valid_signature` Has No Call Context

*Source: chipi-pay Nethermind scan 1, finding #5*

`is_valid_signature(hash, signature)` receives only hash and signature — no calls. It cannot enforce selector whitelists. Enforce whitelists in `__validate__` and `execute_from_outside_v2` where calls are available. This is an inherent ERC-1271 limitation, not a bug.

---

## 8. Real Audit Findings Reference

### CVE-2024-45304 — OpenZeppelin Cairo Ownership Bug

OZ Cairo Contracts before v0.16.0: `renounce_ownership` could be used to transfer ownership unintentionally. Fixed in v0.16.0.

### Code4rena Starknet Perpetual (2025) — 2 High, 3 Medium

- **H-01:** Malicious signed price injection via `assets.price_tick()` — attacker could inject an arbitrary price
- **H-02:** `_execute_transfer` wrong order of operations — state diff applied before check (checks-effects-interactions violation)

### chipi-pay Session Contract — 18 Findings, 4 Nethermind Scans

- Scan 1: 10 findings (3 High — unrestricted `__execute__` caller, whitelist bypass in `is_valid_signature`, call-limit bypass via `calls_used` reset)
- Scan 2: 3 findings (1 High — nested `__execute__` privilege escalation)
- Scan 3: 5 findings (2 High — `set_public_key`/`setPublicKey` not in blocklist)
- Scan 4: 0 findings — clean report after self-call block + expanded blocklist

**Pattern:** Every scan found new privileged selectors exposed by OZ embedded implementations. The self-call block (scan 4) eliminated the entire vulnerability class.

---

## 9. Upgrade Safety

### Before Upgrading

1. New class hash should be declared and verified on explorer
2. Test upgrade on Sepolia first
3. Verify storage layout compatibility
4. Have a rollback plan (old class hash declared, ready to re-upgrade)

### Storage Layout Rules

- Never remove or reorder existing storage fields
- Only append new fields at the end
- Component substorage names must stay the same
- Map key types must not change

---

## 10. Audit Preparation

### What Auditors Look For

1. **Access control completeness** — every external `ref self` function has authorization
2. **Input validation** — all user inputs checked before use
3. **State consistency** — no paths where state becomes inconsistent
4. **Economic invariants** — total supply == sum of balances, etc.
5. **Upgrade governance** — who can upgrade, timelocks
6. **Event completeness** — all state changes emit events
7. **Error messages** — all asserts have descriptive messages
8. **L1/L2 message safety** — from_address validated, replay protected
9. **Unbounded iteration** — no user-growable loops
10. **Boolean return checks** — ERC20 transfer/approve returns checked

### Documentation for Auditors

Provide:
- Architecture diagram (contracts + interactions)
- Invariants the system should maintain
- Known trust assumptions
- Admin capabilities and their risks
- Expected call flows for each user type
- L1/L2 message flow diagrams (if applicable)

---

## 11. Production Operations

### Monitoring

- Watch for unexpected `upgrade` calls
- Monitor admin role grants/revocations
- Track session key creation and revocation patterns
- Alert on large transfers or unusual call patterns
- Monitor L1/L2 message consumption (stuck messages)

### Incident Response

1. **Kill switch** — ability to pause the contract
2. **Session revocation** — revoke all active sessions immediately
3. **Upgrade path** — deploy fix, declare, upgrade
4. **Communication** — notify users via events and off-chain channels

---

## Sources

- [Cairo Book — General Recommendations (ch104)](https://book.cairo-lang.org/ch104-01-general-recommendations.html)
- [Crytic — Not So Smart Contracts (Cairo)](https://github.com/crytic/building-secure-contracts/tree/master/not-so-smart-contracts/cairo)
- [0xEniotna — Starknet Contract Vulnerabilities](https://github.com/0xEniotna/Starknet-contracts-vulnerabilities)
- [Code4rena — Starknet Perpetual Audit Report (2025)](https://code4rena.com/reports/2025-03-starknet-perpetual)
- [chipi-pay — Session Key Contract + SNIP Draft](https://github.com/chipi-pay/sessions-smart-contract)
- [amanusk — Awesome Starknet Security](https://github.com/amanusk/awesome-starknet-security)
- [OpenZeppelin Cairo Contracts Advisories](https://advisories.gitlab.com/pkg/pypi/openzeppelin-cairo-contracts)
