---
name: cairo-security
description: Use when reviewing Cairo contracts for security — common vulnerabilities, audit patterns, production hardening, access control, reentrancy, overflow, and upgrade safety.
license: Apache-2.0
metadata: {"author":"starknet-agentic","version":"1.0.0","org":"keep-starknet-strange"}
keywords: [cairo, security, audit, vulnerabilities, access-control, reentrancy, starknet, production, hardening]
allowed-tools: [Bash, Read, Write, Glob, Grep, Task]
user-invocable: true
---

# Cairo Security

Security patterns and common vulnerabilities for Cairo smart contracts on Starknet. Use as a review checklist before deployment.

## When to Use

- Reviewing a contract before audit or deployment
- Checking for common Cairo/Starknet vulnerabilities
- Hardening a contract for production
- Implementing access control, upgrade safety, input validation
- Writing session key or delegated execution contracts

**Not for:** Writing contracts (use cairo-contracts), testing (use cairo-testing), gas optimization (use cairo-optimization)

## Pre-Deployment Checklist

Before any mainnet deployment:

- [ ] All tests pass (`snforge test`)
- [ ] No `unwrap()` on user-controlled inputs — use `expect()` or pattern match
- [ ] Access control on all state-changing functions
- [ ] Zero-address checks on constructor arguments
- [ ] Events emitted for all state changes
- [ ] No storage collisions between components
- [ ] Upgrade function protected by owner/admin check
- [ ] Reentrancy guard on external-call-then-state-update patterns
- [ ] Integer overflow/underflow considered (Cairo panics on overflow by default, but check u256 edge cases)
- [ ] Contract verified on block explorer

## Common Vulnerabilities

### 1. Missing Access Control

The most common vulnerability. Every state-changing function must check authorization.

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

### 2. Unsafe `unwrap()` on User Input

`unwrap()` panics on failure. For user-controlled values, this is a DoS vector or unexpected revert.

```cairo
// BAD — panics if conversion fails
let value: u64 = input.try_into().unwrap();

// GOOD — safe conversion with explicit error
let value: u64 = match input.try_into() {
    Option::Some(v) => v,
    Option::None => { return; }  // or return error
};
```

### 3. Missing Zero-Address Validation

```cairo
// BAD
fn constructor(ref self: ContractState, owner: ContractAddress) {
    self.ownable.initializer(owner);
}

// GOOD
fn constructor(ref self: ContractState, owner: ContractAddress) {
    assert(!owner.is_zero(), 'Owner cannot be zero address');
    self.ownable.initializer(owner);
}
```

### 4. Reentrancy via External Calls

Cairo doesn't have a native reentrancy guard in the language. If you call an external contract before updating state, it can call back.

```cairo
// BAD — state update after external call
fn withdraw(ref self: ContractState, amount: u256) {
    let balance = self.balances.read(caller);
    assert(balance >= amount, 'Insufficient balance');

    // External call BEFORE state update
    IERC20Dispatcher { contract_address: self.token.read() }
        .transfer(caller, amount);

    // State update AFTER — reentrancy window
    self.balances.write(caller, balance - amount);
}

// GOOD — checks-effects-interactions pattern
fn withdraw(ref self: ContractState, amount: u256) {
    let balance = self.balances.read(caller);
    assert(balance >= amount, 'Insufficient balance');

    // State update FIRST
    self.balances.write(caller, balance - amount);

    // External call LAST
    IERC20Dispatcher { contract_address: self.token.read() }
        .transfer(caller, amount);
}
```

### 5. Unprotected Upgrade Function

```cairo
// BAD — anyone can upgrade (full contract takeover)
fn upgrade(ref self: ContractState, new_class_hash: ClassHash) {
    self.upgradeable.upgrade(new_class_hash);
}

// GOOD
fn upgrade(ref self: ContractState, new_class_hash: ClassHash) {
    self.ownable.assert_only_owner();
    self.upgradeable.upgrade(new_class_hash);
}
```

### 6. Storage Collision Between Components

When using multiple components, storage slots can collide if both use `#[substorage(v0)]` with overlapping key paths.

```cairo
// Each component MUST have unique substorage names
#[storage]
struct Storage {
    #[substorage(v0)]
    ownable: OwnableComponent::Storage,      // unique namespace
    #[substorage(v0)]
    erc20: ERC20Component::Storage,          // unique namespace
    #[substorage(v0)]
    my_component: MyComponent::Storage,      // unique namespace
}
```

### 7. Missing Event Emission

State changes without events are invisible to indexers, frontends, and auditors.

```cairo
// BAD
fn set_fee(ref self: ContractState, new_fee: u256) {
    self.ownable.assert_only_owner();
    self.fee.write(new_fee);
}

// GOOD
fn set_fee(ref self: ContractState, new_fee: u256) {
    self.ownable.assert_only_owner();
    let old_fee = self.fee.read();
    self.fee.write(new_fee);
    self.emit(FeeUpdated { old_fee, new_fee });
}
```

## Session Key Security

For contracts implementing session key delegation (relevant to AI agents):

### Admin Selector Blocklist

Session keys MUST NOT be able to call privileged functions:

```cairo
const BLOCKED_SELECTORS: [felt252; 7] = [
    selector!("upgrade"),
    selector!("add_or_update_session_key"),
    selector!("revoke_session_key"),
    selector!("__execute__"),
    selector!("set_public_key"),
    selector!("setPublicKey"),
    selector!("execute_from_outside_v2"),
];
```

**Why each is blocked:**
- `upgrade` — replaces the entire contract
- `add_or_update_session_key` — creates unrestricted sessions
- `revoke_session_key` — revokes other sessions
- `__execute__` — bypasses all session restrictions via nested execution
- `set_public_key` / `setPublicKey` — full account takeover via owner key rotation
- `execute_from_outside_v2` — double-consumption via nested SNIP-9

### Self-Call Block

Block ALL calls where `call.to == get_contract_address()` for sessions with empty whitelists. This eliminates the entire class of privilege escalation via self-calls.

### Spending Limits

Selector whitelists alone don't limit value. A session authorized to call `transfer` can transfer the entire balance. Add per-token spending limits:
- `max_amount_per_call` — cap per individual transfer
- `max_amount_per_window` — rolling window cap (e.g., 100 USDC per 24h)

### Call Consumption Ordering

Increment `calls_used` AFTER signature verification, not before. Otherwise a session with `max_calls = 1` fails on its first valid use.

## Upgrade Safety

### Before Upgrading

1. New class hash should be declared and verified
2. Test upgrade on Sepolia first
3. Verify storage layout compatibility (new version must not change existing storage slot layout)
4. Have a rollback plan (declare the old class hash, ready to upgrade back)

### Storage Layout Rules

- Never remove or reorder existing storage fields
- Only append new fields at the end
- Component substorage names must stay the same
- Map key types must not change

## Audit Preparation

### What Auditors Look For

1. **Access control completeness** — every external `ref self` function has authorization
2. **Input validation** — all user inputs checked before use
3. **State consistency** — no paths where state can become inconsistent
4. **Economic invariants** — total supply == sum of balances, etc.
5. **Upgrade governance** — who can upgrade, are there timelocks
6. **Event completeness** — all state changes emit events
7. **Error messages** — all asserts have descriptive messages

### Documentation for Auditors

Provide:
- Architecture diagram (contracts + interactions)
- Invariants the system should maintain
- Known trust assumptions
- Admin capabilities and their risks
- Expected call flows for each user type

## Production Operations

### Monitoring

- Watch for unexpected `upgrade` calls
- Monitor admin role grants/revocations
- Track session key creation and revocation patterns
- Alert on large transfers or unusual call patterns

### Incident Response

1. **Kill switch** — ability to pause the contract
2. **Session revocation** — revoke all active sessions immediately
3. **Upgrade path** — deploy fix, declare, upgrade
4. **Communication** — notify users via events and off-chain channels
