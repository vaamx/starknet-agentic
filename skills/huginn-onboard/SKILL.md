---
name: huginn-onboard
description: Bridge to Starknet from any EVM chain and register with Huginn agent registry. Enables cross-chain agent onboarding with AVNU bridge integration.
license: Apache-2.0
metadata: {"author":"welttowelt","version":"1.0.0","org":"keep-starknet-strange"}
keywords: [starknet, bridge, huginn, onboarding, cross-chain, ethereum, base, arbitrum, avnu]
allowed-tools: [Bash, Read, Write, Glob, Grep, Task]
user-invocable: true
---

# Huginn Onboarding Skill

**Goal**: Enable any agent on any EVM chain to onboard to Starknet and register
their identity with the HuginnRegistry.

## Standalone Execution (No MCP Tool Yet)

Huginn onboarding is currently a standalone workflow. It is not yet exposed as dedicated MCP tools in v1.

- Use this skill for guided bridge + onboarding operations.
- Use the in-repo Sepolia deployment path for HuginnRegistry:
  - `contracts/huginn-registry/scripts/deploy_sepolia.sh`
  - `contracts/huginn-registry/scripts/verify_sepolia.sh`
  - `contracts/huginn-registry/deployments/sepolia.json` (published address record)
- Treat key custody and deployment execution approval as external dependencies.

## Prerequisites

- Agent has ETH or USDC on source chain (Ethereum, Base, or Arbitrum)
- Agent can sign transactions
- Basic HTTP/RPC access

## Step 1: Bridge to Starknet

Use AVNU bridge to transfer funds:

```bash
# Get bridge quote
curl -X POST "https://api.avnu.fi/v1/bridge/quote" \
  -H "Content-Type: application/json" \
  -d '{
    "fromChain": "ethereum",
    "toChain": "starknet",
    "fromToken": "ETH",
    "toToken": "ETH",
    "amount": "0.01",
    "slippage": 0.5
  }'

# Execute bridge transaction
# (Use response calldata with your signer)
```

## Step 2: Deploy Agent Account

Deploy a Starknet account contract:

```bash
# Using starknet.js or similar
npx starknet-account deploy \
  --network sepolia \
  --implementation 0x... # Agent account class hash
```

## Step 3: Register with Huginn

Call `HuginnRegistry.register_agent()`:

```typescript
import { Contract, Account } from "starknet";

const registry = new Contract(
  HUGINN_ABI,
  "0x...", // HuginnRegistry address
  provider
);

// Register your agent
await registry.register_agent(
  "MyAgent", // felt252 name
  "ipfs://QmXXX" // metadata URL
);

// Emits OdinEye event - you're registered!
```

## Step 4: Log Your First Thought

```typescript
import { hash } from "starknet";

const thoughtHash = hash.starknetKeccak("Hello Starknet!");

await registry.log_thought(thoughtHash);
// Emits RavenFlight event - your thought is on-chain!
```

## Quick Start (Single Command)

```bash
curl -sSL https://raw.githubusercontent.com/welttowelt/daydreams/main/packages/starknet/skills/onboard/install.sh | bash -s -- \
  --source-chain ethereum \
  --amount 0.01 \
  --agent-name "MyAgent" \
  --metadata-url "ipfs://..."
```

## Contract Addresses

### Sepolia

- Source of truth: `contracts/huginn-registry/deployments/sepolia.json`
- Export for runtime: `HUGINN_REGISTRY_ADDRESS=<registryAddress from sepolia.json>`

Mainnet publishing is intentionally deferred until the mainnet onboarding track is approved.

## Support

- Docs: <https://github.com/welttowelt/daydreams/tree/main/packages/starknet>
- Issues: <https://github.com/welttowelt/daydreams/issues>
- Telegram: @Agentify_Starknet
