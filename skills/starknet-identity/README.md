# @starknet-agentic/skill-identity

Starknet Identity skill for AI agents. Register and manage ERC-8004 identities on Starknet with MCP-first execution and direct contract fallbacks for reputation and validation flows.

## Install

```bash
npm install @starknet-agentic/skill-identity
```

## What's Included

- **SKILL.md** - Full skill documentation with MCP tool mapping and operational runbooks
- **scripts/** - Runnable validation scripts for registration, metadata, reputation, and validation status
- **.env.example** - Environment variable template with Sepolia addresses

## MCP Tools Used

Use MCP tools first when available:

- `starknet_register_agent` - mint ERC-8004 identity
- `starknet_set_agent_metadata` - set metadata key/value for agent
- `starknet_get_agent_metadata` - read metadata key/value
- `starknet_get_agent_passport` - read canonical Agent Passport metadata bundle
- `starknet_call_contract` / `starknet_invoke_contract` - direct fallback for reputation/validation registries

## Quick Start

```bash
cp .env.example .env
# Edit .env with your RPC URL, account, and registry addresses
npx tsx scripts/register-agent.ts "MyAgent" "defi" "1.0"
npx tsx scripts/query-reputation.ts 1
npx tsx scripts/set-metadata.ts 1 status "active"
npx tsx scripts/set-metadata.ts 1 capability:swap '{"name":"swap","category":"defi","mcpTool":"starknet_swap"}'
npx tsx scripts/query-validation.ts 1
```

## Features

- Agent registration as ERC-721 NFTs with metadata
- MCP-native identity registration/metadata operations
- Reputation system with cryptographic feedback authorization
- Third-party validation request/response lifecycle
- Agent Passport capability publishing via `caps`, `capability:<name>`, and `passport:schema`
- Full metadata schema (agentName, agentType, version, model, status, etc.)
- A2A Agent Card integration

## Production Notes

- Treat `agentWallet` as reserved metadata managed by dedicated wallet-auth flows.
- Persist `agentId` and transaction hash after registration for reconciliation.
- Use MCP identity tools for write paths; use direct calls only for missing MCP capabilities.
- Keep metadata keys stable (`agentName`, `agentType`, `version`, `status`, `a2aEndpoint`, `caps`, `capability:<name>`, `passport:schema`) to avoid downstream schema drift.

## Related

- [@starknet-agentic/agent-passport](https://www.npmjs.com/package/@starknet-agentic/agent-passport) — Passport client
- [@starknet-agentic/skill-wallet](https://www.npmjs.com/package/@starknet-agentic/skill-wallet) — Wallet management
- [starknet-agentic](https://github.com/Bitsage-Network/starknet-agentic) — Full infrastructure repo
