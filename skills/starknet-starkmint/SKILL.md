---
name: starknet-starkmint
description: Launch and trade agent tokens with bonding curves on Starknet via the StarkMint protocol
keywords:
  - starknet
  - starkmint
  - bonding-curve
  - agent-token
  - token-launch
  - defi
allowed-tools:
  - starkmint_launch_token
  - starkmint_buy
  - starkmint_sell
  - starkmint_get_price
  - starkmint_get_launches
user-invocable: false
---

# StarkMint — Agent Token Launchpad

StarkMint enables AI agents to launch their own ERC-20 tokens with automated bonding curves. Each token is bound to an ERC-8004 agent identity, creating a direct link between agent reputation and token value.

## Curve Types

| Type | Formula | Best For |
|------|---------|----------|
| Linear (0) | `price = base + slope * supply` | Gradual price discovery |
| Quadratic (1) | `price = a * supply^2` | Strong early-mover advantage |
| Sigmoid (2) | Placeholder (falls back to linear in v1) | Stable mature pricing (planned) |

## MCP Tools Used

### Launch a Token

```
starkmint_launch_token
  factoryAddress: "0x..."
  name: "PredictorCoin"
  symbol: "PRED"
  curveType: 0           # linear
  feeBps: 100            # 1% fee
  agentId: "1"           # ERC-8004 agent ID
```

### Buy Tokens

```
starkmint_buy
  curveAddress: "0x..."
  amount: "100"          # 100 agent tokens
```

### Sell Tokens

```
starkmint_sell
  curveAddress: "0x..."
  amount: "50"
```

### Check Price

```
starkmint_get_price
  curveAddress: "0x..."
  amount: "10"
```

### List All Launches

```
starkmint_get_launches
  factoryAddress: "0x..."
  limit: 20
```

## Error Codes

| Error | Recovery |
|-------|----------|
| `fee too high` | Fee BPS must be ≤ 1000 (10%) |
| `amount must be > 0` | Buy/sell amount cannot be zero |
| `insufficient supply` | Cannot sell more tokens than current supply |
| `caller is zero` | Must call from a valid account |
| `only owner` | Only curve owner can withdraw fees |
| `no fees to withdraw` | No accumulated fees to collect |

## Architecture

- **AgentToken**: Minimal ERC-20 with mint/burn restricted to bonding curve
- **BondingCurve**: Automated market maker with configurable curve shape and fees
- **StarkMintFactory**: Deploys token + curve pairs via `deploy_syscall`
- **Fee collection**: Buy fee added on top of raw cost, sell fee deducted from proceeds. Owner can withdraw via `withdraw_fees`
- **Planned**: ERC-8004 identity verification on launch (not yet enforced in v1)
- **Planned**: Minimum reserve ratio protection (not yet implemented in v1)
