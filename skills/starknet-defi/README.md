# @starknet-agentic/skill-defi

Starknet DeFi skill for AI agents. Execute swaps, DCA, staking, and lending workflows with an MCP-first architecture and direct SDK fallbacks where MCP tools are not yet available.

## Install

```bash
npm install @starknet-agentic/skill-defi
```

## What's Included

- **SKILL.md** - Full skill documentation with MCP tool mapping, runbooks, and code examples
- **scripts/** - Runnable examples (quote/depth checks + staking and DCA visibility)
- **.env.example** - Environment variable template

## MCP Tools Used

Use MCP tools first for production execution:

- `starknet_get_quote` - price and route discovery
- `starknet_swap` - swap execution
- `starknet_build_swap_calls` - unsigned call generation for external signing
- `starknet_vesu_deposit`, `starknet_vesu_withdraw`, `starknet_vesu_positions` - lending operations via Vesu

Direct SDK/contract usage in this skill is reserved for operations not yet exposed via MCP (AVNU DCA lifecycle, AVNU staking lifecycle, zkLend-specific calls).

## Quick Start

```bash
cp .env.example .env
# Edit .env with your wallet + RPC
npx tsx scripts/check-price.ts ETH USDC 1
npx tsx scripts/swap-quote.ts ETH USDC 0.1
npx tsx scripts/pool-info.ts ETH/STRK
npx tsx scripts/staking-info.ts
npx tsx scripts/dca-orders.ts
```

## Features

- MCP-first swap execution via AVNU
- STRK staking (stake, claim rewards, unstake)
- DCA (Dollar Cost Averaging) orders
- Lending via MCP Vesu tools, plus zkLend advanced patterns (when mainnet track is enabled)
- Gasless swaps via paymaster
- Market data and price feeds
- Token address reference (Sepolia v1 baseline)

## Production Notes

- Always quote before swap and enforce per-trade max notional limits.
- Treat `QUOTE_EXPIRED`, `SLIPPAGE`, and `INSUFFICIENT_LIQUIDITY` as retryable with refreshed quotes.
- Reserve direct SDK execution for gaps in MCP capabilities to avoid duplicated execution logic.
- Use `starknet_build_swap_calls` or `starknet_build_calls` when execution and signing are separated.
- Current launch scope is Sepolia only; do not assume mainnet endpoints in v1 automation.

## Related

- [@starknet-agentic/skill-wallet](https://www.npmjs.com/package/@starknet-agentic/skill-wallet) — Wallet management
- [@starknet-agentic/skill-identity](https://www.npmjs.com/package/@starknet-agentic/skill-identity) — On-chain identity
- [starknet-agentic](https://github.com/Bitsage-Network/starknet-agentic) — Full infrastructure repo
