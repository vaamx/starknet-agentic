# Cross-chain ERC-8004 Demo (Base Sepolia + Starknet Sepolia)

This example demonstrates one end-to-end flow:

1. Deploy an agent account on Starknet via `AgentAccountFactory`
2. Register an ERC-8004 identity on Base Sepolia
3. Write a shared `agentURI` (data URI) on both registries with both registrations
4. Emit a single `crosschain_receipt.json`

## Prerequisites

- Node.js 20+
- `pnpm install`
- A funded Starknet Sepolia deployer account
- A funded Base Sepolia EOA

## Setup

```bash
cd examples/crosschain-demo
cp .env.example .env
# fill required keys
```

## Run

```bash
# Standard mode (agent account pays for post-deploy URI update)
pnpm demo

# Sponsored mode (AVNU paymaster for Starknet txs)
pnpm demo:gasfree

# Sponsored + optional tx verification from new account
pnpm demo:verify
```

## Output

The script writes `crosschain_receipt.json` with:

- Starknet: account address, agent id, deploy tx hash, URI update tx hash
- Base: agent id, register tx hash, URI update tx hash
- Shared URI used on both chains

## Notes

- Default EVM network is Base Sepolia (`eip155:84532`).
- Default Starknet network is Sepolia (`starknet:SN_SEPOLIA`).
- This is a v1 demo flow for identity linkage. Bridge automation is out of scope.
