# @starknet-agentic/bitsage-cloud-sdk

TypeScript SDK for BitsagE Cloud — STRK-native compute marketplace for AI agents.

See [`../../docs/BITSAGE_CLOUD.md`](../../docs/BITSAGE_CLOUD.md) for full docs.

## Install

```bash
pnpm add @starknet-agentic/bitsage-cloud-sdk
```

## Usage

```typescript
import { BitsageCloudClient } from "@starknet-agentic/bitsage-cloud-sdk";

const sdk = new BitsageCloudClient({
  baseUrl: "https://api.bitsage.cloud",
  rpcUrl: "https://rpc.starknet-testnet.lava.build",
  accountAddress: "0x...",
  privateKey: "0x...",
});

await sdk.depositCredits(10);                           // 10 STRK
const balance = await sdk.getCreditBalance();           // { balanceStrk, balanceWei, estimatedHoursRemaining }
const machine = await sdk.createMachine({ agentAddress: "0x...", tier: "nano" });
await sdk.heartbeatMachine(machine.id);                 // deduct compute cost
await sdk.destroyMachine(machine.id);
```

## Machine tiers

| Tier | CPU | RAM | STRK/hr |
|------|-----|-----|---------|
| `nano` | 1 shared | 256 MB | 0.05 |
| `micro` | 1 shared | 512 MB | 0.10 |
| `small` | 2 shared | 1 GB | 0.25 |
