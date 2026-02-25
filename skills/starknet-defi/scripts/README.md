# Starknet DeFi Scripts

Operational scripts for validating DeFi flows used by the `starknet-defi` skill.

## Setup

```bash
cd skills/starknet-defi
npm install
cp .env.example .env
```

## Scripts

### `check-price`

Quick quote snapshot for a pair.

```bash
npm run check-price -- ETH USDC 1
```

### `swap-quote`

Detailed quote output for trade planning.

```bash
npm run swap-quote -- ETH USDC 0.1
```

### `pool-info`

Liquidity depth probe across increasing trade sizes.

```bash
npm run pool-info -- ETH/STRK
```

### `staking-info`

Inspect AVNU staking pools and optional user position.

```bash
npm run staking-info
npm run staking-info -- 0xYOUR_ADDRESS
```

### `dca-orders`

List DCA orders for an address and status.

```bash
npm run dca-orders
npm run dca-orders -- 0xYOUR_ADDRESS active
```

Status options: `active`, `closed`, `indexing`, `all`.

## Notes

- Scripts are intended for validation and operations support.
- Production execution should prefer MCP tools where available.
- Amount parsing is decimal-safe to avoid floating-point errors.
- Default `.env.example` is configured for Starknet Sepolia (v1 launch baseline).
