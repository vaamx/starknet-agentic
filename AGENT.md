# Agent Context -- Starknet Agentic

## Mission

Make Starknet the financial rails for the agentic era. Every AI agent -- regardless of framework -- should be able to hold a wallet, transact, build reputation, and participate in DeFi on Starknet with minimal friction.

## What This Repository Is

A consolidated infrastructure layer that provides:

1. **Smart contracts** (Cairo) for agent wallets, on-chain identity, and thought provenance
2. **MCP server** for tool-based Starknet access from any agent
3. **A2A adapter** for agent-to-agent discovery and communication
4. **Skills marketplace** for Claude Code and OpenClaw agents
5. **CLI scaffolding** (`create-starknet-agent`) for project bootstrapping
6. **E2E onboarding examples** for cross-chain agent registration

## References

The `references/` directory is your knowledge base for agentic development on Starknet. Always consult it before writing skills, contracts, or integrations.

- **`references/starknet-docs/`** -- Official Starknet documentation (git submodule from [starknet-io/starknet-docs](https://github.com/starknet-io/starknet-docs)). Use this as the authoritative source for Starknet architecture, Cairo language, account abstraction, transaction lifecycle, messaging, and protocol-level details.
- **`references/agentskills/`** -- AgentSkills specifications covering integration patterns, skill format, and what skills are.

When building anything in this repo, ground your work in these references rather than relying solely on training data.

## The Agent Standards Stack

Three protocols are converging into the standard infrastructure for AI agents:

```
┌──────────────────────────────────────┐
│  ERC-8004: On-Chain Identity & Trust │  Who agents are, why to trust them
├──────────────────────────────────────┤
│  A2A: Agent-to-Agent Communication   │  How agents talk to each other
├──────────────────────────────────────┤
│  MCP: Agent-to-Tool Connectivity     │  What agents can do
└──────────────────────────────────────┘
```

Starknet Agentic implements all three layers with Starknet as the settlement and identity layer.

## Existing Ecosystem Assets

### Already Built (Reusable)

| Asset | Where | What We Use |
|-------|-------|-------------|
| ERC-8004 Cairo contracts | [erc8004-cairo](https://github.com/Akashneelesh/erc8004-cairo) | Identity, Reputation, Validation registries. 131+ unit tests + 47 E2E tests. Production-ready on Sepolia. |
| avnu Skill | [avnu-skill](https://github.com/avnu-labs/avnu-skill) | Swap, DCA, staking, gasless/gasfree patterns. Documentation + scripts. |
| Daydreams StarknetChain | [daydreams/defai](https://github.com/daydreamsai/daydreams) | Minimal IChain (read/write) using starknet.js v6. We extend this. |
| Lucid Agents Extension System | [lucid-agents](https://github.com/daydreamsai/lucid-agents) | WalletConnector, PaymentsRuntime, EntrypointDef interfaces. We implement for Starknet. |
| Snak Agent Kit | [snak](https://github.com/KasarLabs/snak) | MCP-native toolkit with plugin architecture. We can contribute plugins. |
| Cartridge Controller | [cartridge.gg](https://docs.cartridge.gg) | Session key implementation for smart wallets. Reference for our Agent Account. |

### Gaps to Fill

| Gap | Priority | Status |
|-----|----------|--------|
| Agent Account contract | HIGH | **TESTED** (110 tests) - needs Sepolia deployment, see `contracts/agent-account/` |
| Starknet MCP server with DeFi | HIGH | **DONE** - 23 tools implemented including identity/reputation/validation + mini-pay helpers |
| Starknet wallet skill | HIGH | **DONE** - complete at `skills/starknet-wallet/` |
| CLI scaffolding tool | HIGH | **DONE** - `packages/create-starknet-agent/` (npm publish pending) |
| Agent onboarding E2E flow | HIGH | **DONE** - `examples/onboard-agent/` + `examples/crosschain-demo/` |
| Huginn onboarding skill | MEDIUM | **DONE** - `skills/huginn-onboard/` |
| A2A support for Starknet agents | MEDIUM | **DONE** - functional at `packages/starknet-a2a/` |
| MCP identity tools | MEDIUM | **DONE** - register/info/metadata + reputation + validation request shipped |
| Cross-chain ERC-8004 demo | MEDIUM | **DONE** - Base Sepolia ↔ Starknet flow at `examples/crosschain-demo/` |
| ProveWork (TaskEscrow) contract | HIGH | **DONE** - `contracts/task-escrow/` (14 tests) |
| StarkMint (BondingCurve) contracts | HIGH | **DONE** - `contracts/bonding-curve/` (AgentToken + BondingCurve + Factory) |
| Agent Guilds (DAO) contracts | HIGH | **DONE** - `contracts/agent-guilds/` (GuildRegistry + GuildDAO) |
| Economy MCP tools | HIGH | **DONE** - 16 tools (5 ProveWork + 5 StarkMint + 6 Guilds) |
| Economy skills | HIGH | **DONE** - `skills/starknet-provework/`, `skills/starknet-starkmint/`, `skills/starknet-guilds/` |
| Economy frontends | HIGH | **DONE** - ProveWork, StarkMint, Guilds pages in prediction-agent |
| Resolution Oracle hardening | HIGH | **DONE** - DB layer, store, agent loop wiring, API, UI panel |
| AgentSouk marketplace | HIGH | **DONE** - ERC-8004 reader + search/filter UI |
| Lucid Agents Starknet connector | LOW | **TODO** - deferred to v2.0 |
| Daydreams DeFi extension | LOW | **TODO** - deferred to v2.0 |
| MoltBook presence | LOW | **TODO** - Deploy Starknet ecosystem bot |
| Cross-chain identity bridge | LOW | **TODO** - Bridge ERC-8004 between EVM and Starknet |

## Agent Wallet Architecture

The Agent Account contract is the core primitive. It extends Starknet's native AA:

```
┌─────────────────────────────────────┐
│           Agent Account             │
│                                     │
│  ┌──────────┐  ┌────────────────┐   │
│  │  Owner   │  │  Session Keys  │   │
│  │  (human) │  │  (agents)      │   │
│  └──────────┘  └────────────────┘   │
│                                     │
│  Policies:                          │
│  - Allowed contracts & methods      │
│  - Spending limits per period       │
│  - Time bounds (expiry)             │
│  - Kill switch (owner revokes all)  │
│                                     │
│  Features:                          │
│  - Paymaster support (no ETH req)   │
│  - Event logging (for reputation)   │
│  - Multi-call batching              │
│  - Nonce abstraction (parallel tx)  │
└─────────────────────────────────────┘
```

## MCP Server Tools

The Starknet MCP server exposes these tools to any MCP-compatible agent:

### Implemented Tools (Production)

| Tool | Description | Status |
|------|-------------|--------|
| `starknet_get_balance` | Query single token balance | Implemented |
| `starknet_get_balances` | Batch balance query (single RPC call) | Implemented |
| `starknet_transfer` | Send tokens with gasfree option | Implemented |
| `starknet_call_contract` | Read contract state (view functions) | Implemented |
| `starknet_invoke_contract` | Write to contracts (state-changing) | Implemented |
| `starknet_swap` | Execute token swaps via avnu aggregator | Implemented |
| `starknet_get_quote` | Get swap quotes without executing | Implemented |
| `starknet_estimate_fee` | Estimate transaction fees | Implemented |
| `starknet_create_payment_link` | Create Starknet payment links | Implemented |
| `starknet_parse_payment_link` | Parse Starknet payment links | Implemented |
| `starknet_create_invoice` | Create stateless payment invoices | Implemented |
| `starknet_get_invoice_status` | Check invoice status and transfer fulfillment | Implemented |
| `starknet_generate_qr` | Generate QR-style payment payloads | Implemented |
| `starknet_register_agent` | Register ERC-8004 agent identity | Implemented |
| `starknet_get_agent_info` | Read consolidated ERC-8004 identity info | Implemented |
| `starknet_set_agent_metadata` | Set ERC-8004 metadata | Implemented |
| `starknet_update_agent_metadata` | Alias for metadata updates | Implemented |
| `starknet_get_agent_metadata` | Read ERC-8004 metadata | Implemented |
| `starknet_get_agent_passport` | Read Agent Passport metadata | Implemented |
| `starknet_give_feedback` | Submit reputation feedback | Implemented |
| `starknet_get_reputation` | Read reputation summary | Implemented |
| `starknet_request_validation` | Create validation requests | Implemented |
| `x402_starknet_sign_payment_required` | X-402 payment protocol signing | Implemented |

### Economy Tools (Implemented)

| Tool | Description | Status |
|------|-------------|--------|
| `provework_post_task` | Post task with STRK reward escrow | Implemented |
| `provework_bid_task` | Bid on open task | Implemented |
| `provework_submit_proof` | Submit completion proof hash | Implemented |
| `provework_approve_task` | Approve and release payment | Implemented |
| `provework_cancel_task` | Cancel open task and refund reward | Implemented |
| `provework_dispute_task` | Dispute submitted task | Implemented |
| `provework_resolve_dispute` | Owner-arbitrated dispute resolution | Implemented |
| `provework_force_settle` | Force settle after 7-day window | Implemented |
| `provework_get_tasks` | List available tasks | Implemented |
| `starkmint_launch_token` | Launch agent token with bonding curve | Implemented |
| `starkmint_buy` | Buy tokens on bonding curve | Implemented |
| `starkmint_sell` | Sell tokens on bonding curve | Implemented |
| `starkmint_get_price` | Get buy/sell price quote | Implemented |
| `starkmint_get_launches` | List token launches | Implemented |
| `guild_create` | Create agent guild (DAO) | Implemented |
| `guild_join` | Join guild with STRK stake | Implemented |
| `guild_leave` | Leave guild, reclaim stake | Implemented |
| `guild_propose` | Create governance proposal | Implemented |
| `guild_vote` | Stake-weighted vote on proposal | Implemented |
| `guild_execute` | Execute passed proposal | Implemented |

### Planned Tools (Nice to Have)

| Tool | Description | Priority |
|------|-------------|----------|
| `starknet_get_nonce` | Get current nonce | Low |
| `starknet_deploy_contract` | Deploy new contracts | Low |
| `starknet_get_events` | Query on-chain events | Low |
| `starknet_stake` | Stake STRK or liquid staking tokens | Low |
| `starknet_create_dca` | Create Dollar Cost Averaging orders | Low |

## Skills Format

Skills follow the AgentSkills convention used by Claude Code and OpenClaw:

```yaml
---
name: starknet-wallet
description: >
  Create and manage Starknet wallets for AI agents. Transfer tokens,
  check balances, manage session keys, and interact with smart contracts.
keywords:
  - starknet
  - wallet
  - transfer
  - balance
  - session-keys
  - account-abstraction
allowed-tools:
  - Bash
  - Read
  - Write
  - Glob
  - Grep
  - Task
user-invocable: true
---
```

Each skill directory contains:
- `SKILL.md` -- Main skill file with frontmatter and quick reference
- `references/` -- Deep-dive documentation for specific topics
- `scripts/` -- Runnable TypeScript/Python examples

## Platform Integration Patterns

### For Daydreams
```typescript
import { extension, action, service } from "@daydreamsai/core";

export const starknetExtension = extension({
  name: "starknet",
  services: [starknetProviderService],
  actions: [transferAction, swapAction, registerAgentAction],
  contexts: { wallet: starknetWalletContext },
  inputs: { "starknet:event": onChainEventInput },
  outputs: { "starknet:tx": transactionOutput },
});
```

### For Lucid Agents
```typescript
import { Extension, WalletConnector } from "@lucid-agents/types";

export function starknetWallet(config: StarknetConfig): Extension {
  return {
    name: "starknet-wallet",
    build(ctx) {
      return { wallets: createStarknetWalletRuntime(config) };
    },
  };
}
```

### For MCP (any agent)
```json
{
  "mcpServers": {
    "starknet": {
      "command": "node",
      "args": ["./packages/starknet-mcp-server/dist/index.js"],
      "env": {
        "STARKNET_RPC_URL": "https://starknet-mainnet.g.alchemy.com/v2/YOUR_KEY",
        "STARKNET_ACCOUNT_ADDRESS": "0x...",
        "STARKNET_PRIVATE_KEY": "0x..."
      }
    }
  }
}
```

## Key Starknet Addresses

### Mainnet
- ETH: `0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7`
- STRK: `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d`
- USDC: `0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8`
- USDT: `0x068f5c6a61780768455de69077e07e89787839bf8166decfbf92b645209c0fb8`

### API Endpoints
- avnu Mainnet: `https://starknet.api.avnu.fi`
- avnu Sepolia: `https://sepolia.api.avnu.fi`
- avnu Paymaster Mainnet: `https://starknet.paymaster.avnu.fi`
- avnu Paymaster Sepolia: `https://sepolia.paymaster.avnu.fi`

## Decision Log

| Decision | Rationale |
|----------|-----------|
| Cairo for contracts, not Solidity | Native to Starknet, leverages AA and ZK natively |
| MCP as primary integration protocol | Most portable -- works with Claude, ChatGPT, Cursor, OpenClaw |
| ERC-8004 for identity | Only standardized on-chain agent identity; Cairo impl exists |
| avnu for DeFi aggregation | Best Starknet DEX aggregator; SDK well-documented |
| Skills marketplace in-repo | Lower friction than separate registry; grow with ecosystem |
| pnpm workspaces for TS packages | Standard monorepo management; matches Daydreams/Lucid |
