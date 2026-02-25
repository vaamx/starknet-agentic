---
name: starknet-defi
description: Execute DeFi operations on Starknet including token swaps via avnu aggregator, DCA recurring buys, STRK staking, and lending/borrowing. Supports gasless transactions.
license: Apache-2.0
metadata: {"author":"starknet-agentic","version":"1.0.0","org":"keep-starknet-strange"}
keywords: [starknet, defi, swap, dca, staking, lending, avnu, ekubo, jediswap, zklend, nostra, aggregator, yield]
allowed-tools: [Bash, Read, Write, Glob, Grep, Task]
user-invocable: true
---

# Starknet DeFi Skill

Execute DeFi operations on Starknet using AVNU and native protocols with MCP tools as the default execution path.

## Overview

This skill follows a strict MCP vs Skill split:

- Skill provides decision logic, safety checks, and recovery patterns.
- MCP tools execute supported on-chain actions.
- Direct SDK/contract calls are only for capabilities not yet exposed in MCP.

## MCP Tools Used

| Tool | Use Case | Key Inputs |
|------|----------|------------|
| `starknet_get_quote` | Pre-trade quote and route discovery | `sellToken`, `buyToken`, `amount` |
| `starknet_swap` | Swap execution with AVNU routing | `sellToken`, `buyToken`, `amount`, `slippage?`, `gasfree?` |
| `starknet_build_swap_calls` | Build unsigned swap calls for external signing | `sellTokenAddress`, `buyTokenAddress`, `sellAmount`, `signerAddress`, `slippageBps?` |
| `starknet_vesu_deposit` | Supply assets in Vesu lending pools | `token`, `amount`, `pool?` |
| `starknet_vesu_withdraw` | Withdraw supplied assets from Vesu | `token`, `amount`, `pool?` |
| `starknet_vesu_positions` | Read Vesu positions | `tokens`, `address?`, `pool?` |

Not yet exposed as dedicated MCP tools (direct SDK/contract fallback required):

- AVNU DCA create/list/cancel lifecycle
- AVNU STRK staking lifecycle
- zkLend-specific calls (`deposit`, `borrow`, `withdraw`, `repay`) when mainnet track is enabled

## Prerequisites

```bash
npm install starknet@^8.9.1 @avnu/avnu-sdk@^4.0.1
```

Environment variables:
```bash
STARKNET_RPC_URL=https://starknet-sepolia.public.blastapi.io
STARKNET_ACCOUNT_ADDRESS=0x...
STARKNET_PRIVATE_KEY=0x...
AVNU_BASE_URL=https://sepolia.api.avnu.fi
AVNU_PAYMASTER_URL=https://sepolia.paymaster.avnu.fi
```

Launch scope for v1 is Sepolia only.

## Validation Scripts

Use the bundled scripts under `skills/starknet-defi/scripts/` for quick validation:

- `check-price.ts` - quote price and route for a token pair
- `swap-quote.ts` - full quote details for a sell amount
- `pool-info.ts` - route depth sampling across trade sizes
- `staking-info.ts` - AVNU staking pool and user position inspection
- `dca-orders.ts` - list DCA orders by wallet/status

## Token Swaps (MCP first, AVNU backend)

### MCP Recommended (Production Path)

```typescript
// Always quote first
const quote = await mcpClient.callTool({
  name: "starknet_get_quote",
  arguments: {
    sellToken: "ETH",
    buyToken: "STRK",
    amount: "0.1",
  },
});

// Execute only after quote + policy checks
const result = await mcpClient.callTool({
  name: "starknet_swap",
  arguments: {
    sellToken: "ETH",
    buyToken: "STRK",
    amount: "0.1",
    slippage: 0.01,
    gasfree: false,
  },
});
```

### Direct SDK Fallback (Non-MCP Runtime)

Use this path only when MCP execution is unavailable in your runtime.

```typescript
import { getQuotes, executeSwap, type QuoteRequest } from "@avnu/avnu-sdk";
import { Account, RpcProvider, ETransactionVersion } from "starknet";

const provider = new RpcProvider({ nodeUrl: process.env.STARKNET_RPC_URL });

// starknet.js v8: Account uses options object
const account = new Account({
  provider,
  address,
  signer: privateKey,
  transactionVersion: ETransactionVersion.V3,
});

// Resolve token addresses via avnu SDK (or use MCP server's TokenService)
import { fetchVerifiedTokenBySymbol } from '@avnu/avnu-sdk';

const eth = await fetchVerifiedTokenBySymbol('ETH');
const strk = await fetchVerifiedTokenBySymbol('STRK');

// SDK v4: getQuotes takes QuoteRequest object directly
const quoteParams: QuoteRequest = {
  sellTokenAddress: eth.address,
  buyTokenAddress: strk.address,
  sellAmount: 100000000000000000n, // 0.1 ETH
  takerAddress: account.address,
};

const quotes = await getQuotes(quoteParams);
const bestQuote = quotes[0];

// SDK v4: executeSwap takes single object param
const result = await executeSwap({
  provider: account,
  quote: bestQuote,
  slippage: 0.01, // 1%
  executeApprove: true,
});
console.log("Tx:", result.transactionHash);
```

### Quote Response Fields (SDK v4)

```typescript
interface Quote {
  quoteId: string;
  sellTokenAddress: string;
  buyTokenAddress: string;
  sellAmount: bigint;
  buyAmount: bigint;
  sellAmountInUsd: number;
  buyAmountInUsd: number;
  priceImpact: number;        // In basis points (15 = 0.15%)
  gasFeesInUsd: number;
  routes: Array<{
    name: string;             // e.g., "Ekubo", "JediSwap"
    percent: number;          // e.g., 0.8 = 80%
  }>;
  fee: {
    avnuFees: bigint;
    integratorFees: bigint;
  };
}
```

### Build Swap Calls (for multicall composition)

```typescript
import { quoteToCalls } from "@avnu/avnu-sdk";

const calls = await quoteToCalls({
  quoteId: bestQuote.quoteId,
  takerAddress: account.address,
  slippage: 0.01,
  executeApprove: true,
});
// `calls` can be combined with other calls in account.execute([...calls, ...otherCalls])
```

### Gasless Swap (Pay Gas in Token) - SDK v4 + PaymasterRpc

```typescript
import { getQuotes, executeSwap } from "@avnu/avnu-sdk";
import { PaymasterRpc } from "starknet";

const quotes = await getQuotes(quoteParams);
const bestQuote = quotes[0];

// SDK v4: Use PaymasterRpc from starknet.js
// Sepolia: https://sepolia.paymaster.avnu.fi
const paymaster = new PaymasterRpc({
  nodeUrl: process.env.AVNU_PAYMASTER_URL || "https://sepolia.paymaster.avnu.fi",
});

const result = await executeSwap({
  provider: account,
  quote: bestQuote,
  slippage: 0.01,
  executeApprove: true,
  paymaster: {
    active: true,
    provider: paymaster,
    params: {
      feeMode: {
        mode: "default",
        gasToken: "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8", // USDC
      },
    },
  },
});
```

## DCA (Dollar Cost Averaging)

Status: direct SDK path (no dedicated MCP DCA tool yet).

### Create DCA Order

```typescript
import { executeCreateDca } from "@avnu/avnu-sdk";
import moment from "moment";

const totalSellAmount = 100n * 10n ** 6n; // 100 USDC
const sellAmountPerCycle = 10n * 10n ** 6n; // 10 USDC per cycle

const dcaOrder = {
  sellTokenAddress: usdcAddress,
  buyTokenAddress: strkAddress,
  sellAmount: `0x${totalSellAmount.toString(16)}`,
  sellAmountPerCycle: `0x${sellAmountPerCycle.toString(16)}`,
  frequency: moment.duration(1, "day"),
  pricingStrategy: {},
  traderAddress: account.address,
};

const result = await executeCreateDca({
  provider: account,
  order: dcaOrder,
});
```

### Check and Cancel DCA

```typescript
import { getDcaOrders, executeCancelDca, DcaOrderStatus } from "@avnu/avnu-sdk";

const page = await getDcaOrders({
  traderAddress: account.address,
  status: DcaOrderStatus.ACTIVE,
  page: 0,
  size: 20,
});

// Cancel an order
const firstOrder = page.content[0];
if (firstOrder) {
  await executeCancelDca({
    provider: account,
    orderAddress: firstOrder.orderAddress,
  });
}
```

## STRK Staking

Status: direct SDK path (no dedicated MCP staking tool yet).

### Stake STRK

```typescript
import { executeStake, getAvnuStakingInfo } from "@avnu/avnu-sdk";

// Get pool info
const stakingInfo = await getAvnuStakingInfo();
const pool = stakingInfo.delegationPools[0];

const result = await executeStake({
  provider: account,
  poolAddress: pool.poolAddress,
  amount: BigInt(100) * 10n ** 18n, // 100 STRK (18 decimals)
});
```

### Get User Staking Info

```typescript
import { getUserStakingInfo } from "@avnu/avnu-sdk";

const STRK_ADDRESS = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const userInfo = await getUserStakingInfo(STRK_ADDRESS, account.address);
console.log("Staked:", userInfo.amount);
console.log("Unclaimed rewards:", userInfo.unclaimedRewards);
console.log("Pending unpool:", userInfo.unpoolAmount);
```

### Claim Rewards

```typescript
import { executeClaimRewards } from "@avnu/avnu-sdk";

// Claim and restake (compound)
await executeClaimRewards({
  provider: account,
  poolAddress: poolAddress,
  restake: true,
});
```

### Unstake

```typescript
import { executeInitiateUnstake, executeUnstake } from "@avnu/avnu-sdk";

// Step 1: Initiate (starts cooldown -- 21 days for STRK)
await executeInitiateUnstake({
  provider: account,
  poolAddress: poolAddress,
  amount: BigInt(50) * 10n ** 18n, // 50 STRK
});

// Step 2: Complete unstake (after cooldown period)
await executeUnstake({
  provider: account,
  poolAddress: poolAddress,
});
```

## Market Data

### Token Prices

```typescript
import { getPrices, fetchTokens, fetchVerifiedTokenBySymbol } from "@avnu/avnu-sdk";

// Get token by symbol
const strk = await fetchVerifiedTokenBySymbol("STRK");

// Get prices for multiple tokens
const prices = await getPrices([ethAddress, strkAddress, usdcAddress]);
// prices = { "0x049d...": 3200.50, "0x047...": 1.23, ... }

// Browse tokens with pagination
const tokens = await fetchTokens({ page: 0, size: 20, tags: ["verified"] });
```

## Protocol Reference

| Protocol | Operations | Notes |
|----------|-----------|-------|
| **AVNU** | Swap aggregation, DCA, staking, gasless | Best-price routing across Starknet DEXs |
| **Ekubo** | AMM, concentrated liquidity | Highest TVL on Starknet |
| **JediSwap** | AMM, classic pools | V2 with concentrated liquidity |
| **Vesu** | Lending supply/withdraw/positions | Exposed through MCP tools |
| **zkLend** | Lending, borrowing | Deferred for mainnet track |
| **Nostra** | Lending, borrowing | Deferred for mainnet track |

## Configuration

| Variable | Purpose | Default |
|----------|---------|---------|
| `STARKNET_RPC_URL` | Starknet JSON-RPC endpoint | Required |
| `STARKNET_ACCOUNT_ADDRESS` | Agent's account address | Required |
| `STARKNET_PRIVATE_KEY` | Agent's signing key | Required |
| `AVNU_BASE_URL` | avnu API base URL | `https://sepolia.api.avnu.fi` |
| `AVNU_PAYMASTER_URL` | avnu paymaster URL | `https://sepolia.paymaster.avnu.fi` |
| `AVNU_PAYMASTER_API_KEY` | Optional key for sponsored gas mode | None |

### avnu URL Reference

| Network | API URL | Paymaster URL |
|---------|---------|---------------|
| Sepolia | `https://sepolia.api.avnu.fi` | `https://sepolia.paymaster.avnu.fi` |

## Error Handling

```typescript
async function safeSwap(account, quote, slippage = 0.01) {
  try {
    return await executeSwap({
      provider: account,
      quote,
      slippage,
      executeApprove: true,
    });
  } catch (error) {
    if (error.message?.includes("INSUFFICIENT_BALANCE")) {
      throw new Error("Not enough tokens for swap");
    }
    if (error.message?.includes("SLIPPAGE") || error.message?.includes("Insufficient tokens received")) {
      // Retry with higher slippage
      return await executeSwap({
        provider: account,
        quote,
        slippage: slippage * 2,
        executeApprove: true,
      });
    }
    if (error.message?.includes("QUOTE_EXPIRED")) {
      throw new Error("Quote expired. Please retry the operation.");
    }
    if (error.message?.includes("INSUFFICIENT_LIQUIDITY")) {
      throw new Error("Insufficient liquidity. Try a smaller amount.");
    }
    throw error;
  }
}
```

## Production Checklist

1. Call `starknet_get_quote` before every swap execution.
2. Enforce max notional and allowlist per strategy/policy.
3. Use decimal-safe conversions (`BigInt`) for all amount math.
4. Refresh quote on retry; do not retry with stale `quoteId`.
5. Wait for transaction finality and persist `transactionHash` for reconciliation.
6. For external signing flows, build unsigned calls with MCP and keep signing outside the skill runtime.

## Operation Runbook

| Stage | Symptom | Automated Response | Operator Action |
|-------|---------|--------------------|-----------------|
| Quote | `INSUFFICIENT_LIQUIDITY` / no route | Reduce size and re-quote | Move pair to degraded mode if repeated |
| Quote | `QUOTE_EXPIRED` | Fetch fresh quote and retry once | Check RPC/API latency if frequent |
| Execute | `SLIPPAGE` / insufficient received | Re-quote and retry with bounded slippage bump | Tighten max volatility windows |
| Execute | `INSUFFICIENT_BALANCE` | Abort and re-sync balances | Refill wallet or rebalance treasury |
| Execute | Nonce conflict | Refresh nonce and retry | Investigate concurrent writers |
| Post-trade | Tx pending too long | Poll receipt with timeout, then mark unknown | Manually reconcile on explorer |

## Lending (MCP Vesu + zkLend fallback)

### MCP Recommended (Vesu)

```typescript
await mcpClient.callTool({
  name: "starknet_vesu_deposit",
  arguments: {
    token: "USDC",
    amount: "250",
  },
});

await mcpClient.callTool({
  name: "starknet_vesu_positions",
  arguments: {
    tokens: ["USDC", "ETH", "STRK"],
  },
});

await mcpClient.callTool({
  name: "starknet_vesu_withdraw",
  arguments: {
    token: "USDC",
    amount: "50",
  },
});
```

### Direct zkLend (Advanced Fallback)

### Deposit Collateral

```typescript
import { Account, RpcProvider, CallData, cairo } from "starknet";

const ZKLEND_MARKET = "0x04c0a5193d58f74fbace4b74dcf65481e734ed1714121bdc571da345540efa05";
const ETH_ADDRESS = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";

// Approve + deposit in a multicall
const { transaction_hash } = await account.execute([
  {
    contractAddress: ETH_ADDRESS,
    entrypoint: "approve",
    calldata: CallData.compile({
      spender: ZKLEND_MARKET,
      amount: cairo.uint256(depositAmountWei),
    }),
  },
  {
    contractAddress: ZKLEND_MARKET,
    entrypoint: "deposit",
    calldata: CallData.compile({
      token: ETH_ADDRESS,
      amount: cairo.felt(depositAmountWei),
    }),
  },
]);
```

### Borrow

```typescript
const { transaction_hash } = await account.execute({
  contractAddress: ZKLEND_MARKET,
  entrypoint: "borrow",
  calldata: CallData.compile({
    token: USDC_ADDRESS,
    amount: cairo.felt(borrowAmountRaw),
  }),
});
```

### Withdraw

```typescript
const { transaction_hash } = await account.execute({
  contractAddress: ZKLEND_MARKET,
  entrypoint: "withdraw",
  calldata: CallData.compile({
    token: ETH_ADDRESS,
    amount: cairo.felt(withdrawAmountWei),
  }),
});
```

### Repay

```typescript
// Approve + repay
const { transaction_hash } = await account.execute([
  {
    contractAddress: USDC_ADDRESS,
    entrypoint: "approve",
    calldata: CallData.compile({
      spender: ZKLEND_MARKET,
      amount: cairo.uint256(repayAmountRaw),
    }),
  },
  {
    contractAddress: ZKLEND_MARKET,
    entrypoint: "repay",
    calldata: CallData.compile({
      token: USDC_ADDRESS,
      amount: cairo.felt(repayAmountRaw),
    }),
  },
]);
```

## Error Reference

| Error Code | Description | Recovery |
|------------|-------------|----------|
| `INSUFFICIENT_BALANCE` | Not enough tokens for operation | Check balance before transacting |
| `SLIPPAGE_EXCEEDED` | Price moved beyond tolerance | Retry with higher slippage or smaller amount |
| `QUOTE_EXPIRED` | avnu quote timed out | Fetch a new quote and retry |
| `INSUFFICIENT_LIQUIDITY` | Pool lacks depth for trade size | Split into smaller trades or try different pair |
| `APPROVAL_REQUIRED` | Token not approved for spender | Call approve() before the operation |
| `HEALTH_FACTOR_LOW` | Lending position at risk | Repay debt or add collateral |
| `BORROW_CAP_REACHED` | Protocol borrow limit hit | Try smaller amount or different token |
| `COOLDOWN_ACTIVE` | Unstaking cooldown in progress | Wait for cooldown period (21 days for STRK) |

## Token Address Reference

### Sepolia

| Token | Address | Decimals |
|-------|---------|----------|
| ETH | `0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7` | 18 |
| STRK | `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d` | 18 |
| USDC | `0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8` | 6 |
| USDT | `0x068f5c6a61780768455de69077e07e89787839bf8166decfbf92b645209c0fb8` | 6 |

## Protocol Endpoints

| Protocol | Network | URL |
|----------|---------|-----|
| avnu API | Sepolia | `https://sepolia.api.avnu.fi` |
| avnu Paymaster | Sepolia | `https://sepolia.paymaster.avnu.fi` |

## References

- [avnu SDK Documentation](https://docs.avnu.fi/)
- [avnu Skill (detailed)](https://github.com/avnu-labs/avnu-skill)
- [Ekubo Protocol](https://docs.ekubo.org/)
- [Vesu Documentation](https://docs.vesu.xyz/)
- [zkLend Documentation](https://docs.zklend.com/)
- [Nostra Finance](https://docs.nostra.finance/)
