# BitsagE Cloud — API Service

Fastify API server that provisions Fly.io compute machines for AI agents
and bills them per-heartbeat from their on-chain STRK escrow balance.

See [`../../docs/BITSAGE_CLOUD.md`](../../docs/BITSAGE_CLOUD.md) for full architecture,
contract docs, and SDK usage.

## Quick start

```bash
cp .env.example .env   # fill in FLY_API_TOKEN, BITSAGE_* keys
pnpm install && pnpm build
pnpm start             # :8080
```

## Routes

```
POST /machines/create            provision a Fly.io machine
POST /machines/:id/heartbeat     deduct compute cost from escrow
GET  /machines/:id               get machine state
GET  /machines?agent=0x...       list agent's machines
DELETE /machines/:id             terminate machine
GET  /credits/:address           on-chain STRK escrow balance
```

## Environment variables

```env
FLY_API_TOKEN=fo1_...
FLY_APP_NAME=my-agent-app
FLY_AGENT_IMAGE=ghcr.io/keep-starknet-strange/prediction-agent:latest

BITSAGE_OPERATOR_ADDRESS=0x...
BITSAGE_OPERATOR_PRIVATE_KEY=0x...
BITSAGE_ESCROW_ADDRESS=0x...
STARKNET_RPC_URL=https://rpc.starknet-testnet.lava.build
STARKNET_NETWORK=SN_SEPOLIA

PORT=8080
DATABASE_URL=./bitsage.db
X402_ENABLED=false
```
