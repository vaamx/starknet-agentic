---
name: starknet-predict
description: Interact with Starknet prediction markets on Sepolia. Place bets, view open markets and implied probabilities, record probability predictions on-chain for Brier score tracking, claim winnings from resolved markets, and create new markets via the factory contract.
license: Apache-2.0
metadata: {"author":"starknet-agentic","version":"1.0.0","org":"keep-starknet-strange"}
keywords: [starknet, prediction-market, bet, forecast, probability, brier-score, strk, claim, sepolia, factory]
allowed-tools: [Bash, Read, Write]
user-invocable: true
---

# Starknet Prediction Market Skill

Interact with on-chain prediction markets on Starknet Sepolia. Place bets with STRK collateral, record probability forecasts for accuracy tracking, and claim winnings after resolution.

## Prerequisites

```bash
npm install starknet@^8.9.1
```

Environment variables:
```
STARKNET_RPC_URL=https://rpc.starknet-testnet.lava.build
STARKNET_ACCOUNT_ADDRESS=0x...
STARKNET_PRIVATE_KEY=0x...
MARKET_FACTORY_ADDRESS=0x...   # Sepolia factory
ACCURACY_TRACKER_ADDRESS=0x... # Brier score tracker
```

## Contract Addresses (Sepolia)

See `memory/sepolia-deployment.md` for the latest deployed addresses.

- **MarketFactory**: Creates new prediction markets
- **AccuracyTracker**: Records predictions and computes Brier scores
- **Collateral Token**: STRK `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d`

## MCP Tools

### List Markets

```
prediction_get_markets { factoryAddress: "0x..." }
```

Returns all markets with: `id`, `address`, `status` (0=OPEN, 1=RESOLVED), `impliedProbYes`, `totalPool`, `resolutionTime`.

### Place a Bet

```
prediction_bet {
  marketAddress: "0x...",
  outcome: 1,            // 1 = YES, 0 = NO
  amount: "5",           // STRK amount (human-readable)
  collateralToken: "STRK"
}
```

This executes a multicall: `approve` + `bet`. Session key must allow both the collateral token and market contract.

### Full Bet Flow (starknet.js)

```typescript
import { Account, RpcProvider, CallData, cairo } from "starknet";

const provider = new RpcProvider({ nodeUrl: process.env.STARKNET_RPC_URL });
const account = new Account({
  provider,
  address: process.env.STARKNET_ACCOUNT_ADDRESS,
  signer: process.env.STARKNET_PRIVATE_KEY,
});

const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const marketAddress = "0x...";
const amount = 5n * 10n ** 18n; // 5 STRK in wei

const result = await account.execute([
  {
    contractAddress: STRK,
    entrypoint: "approve",
    calldata: CallData.compile({ spender: marketAddress, amount: cairo.uint256(amount) }),
  },
  {
    contractAddress: marketAddress,
    entrypoint: "bet",
    calldata: CallData.compile({ outcome: 1, amount: cairo.uint256(amount) }),
  },
]);
console.log("Bet tx:", result.transaction_hash);
```

### Record Probability Prediction

```
prediction_record_prediction {
  trackerAddress: "0x...",
  marketId: 3,
  probability: 0.73   // 73% YES
}
```

Stores prediction on-chain. Used to compute Brier score = `(outcome - predicted)²` after resolution.

### View Leaderboard

```
prediction_get_leaderboard {
  trackerAddress: "0x...",
  marketId: 3
}
```

Returns ranked agents by Brier score (lower = better calibration).

### Claim Winnings

```
prediction_claim { marketAddress: "0x..." }
```

Calls `claim()` on a RESOLVED market. Caller receives proportional share of the winning pool.

### Create a New Market

```typescript
const factory = "0x..."; // MarketFactory address
const question = "Will STRK exceed $0.15 by March?"; // max 31 chars on-chain
const resolutionTime = Math.floor(Date.now() / 1000) + 30 * 86400; // 30 days

await account.execute([{
  contractAddress: factory,
  entrypoint: "create_market",
  calldata: CallData.compile([
    BigInt(shortString.encodeShortString(question.slice(0, 31))),
    BigInt(resolutionTime),
    BigInt(oracleAddress),
    BigInt(STRK),
    100n, // feeBps (1%)
  ]),
}]);
```

## Market Status Codes

| Status | Meaning |
|--------|---------|
| 0 | OPEN — bets accepted |
| 1 | RESOLVED — outcome decided, claims open |
| 2 | CANCELLED — refunds available |

## Error Codes

| Error | Cause | Recovery |
|-------|-------|---------|
| `Insufficient allowance` | Approve call missing or too low | Include approve in same multicall |
| `Market not open` | Market status != 0 | Check `get_status()` first |
| `Already claimed` | Claim called twice | Idempotent — ignore |
| `No winning position` | Bet was on losing outcome | No action needed |
| `Resolution time not reached` | Resolving too early | Wait until `resolutionTime` passes |
