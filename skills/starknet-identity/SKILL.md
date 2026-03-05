---
name: starknet-identity
description: Register AI agents on-chain using the ERC-8004 Trustless Agents standard. Manage agent identity as NFTs, build reputation through feedback, and request third-party validation.
license: Apache-2.0
metadata: {"author":"starknet-agentic","version":"1.0.0","org":"keep-starknet-strange"}
keywords: [starknet, identity, erc-8004, agent-registry, reputation, validation, nft, trustless, on-chain-identity, agent-registration]
allowed-tools: [Bash, Read, Write, Glob, Grep, Task]
user-invocable: true
---

# Starknet Identity Skill

Register and manage AI agent identities on Starknet using the ERC-8004 standard with MCP tools as the default execution path.

## Overview

ERC-8004 defines three interconnected on-chain registries for AI agents:

1. **Identity Registry** -- Agents as ERC-721 NFTs with metadata
2. **Reputation Registry** -- Feedback system with cryptographic authorization
3. **Validation Registry** -- Third-party assessments (zkML, TEE, staker)

Reference implementation: [erc8004-cairo](https://github.com/Akashneelesh/erc8004-cairo)

## MCP Tools Used

| Tool | Use Case | Key Inputs |
|------|----------|------------|
| `starknet_register_agent` | Register new ERC-8004 identity | `token_uri?`, `gasfree?` |
| `starknet_get_agent_info` | Read consolidated identity state (exists, owner, wallet, token URI, metadata) | `agent_id`, `metadata_keys?` |
| `starknet_set_agent_metadata` | Set on-chain metadata | `agent_id`, `key`, `value`, `gasfree?` |
| `starknet_update_agent_metadata` | Alias for metadata updates | `agent_id`, `key`, `value`, `gasfree?` |
| `starknet_get_agent_metadata` | Read on-chain metadata | `agent_id`, `key` |
| `starknet_get_agent_passport` | Read canonical Agent Passport (`caps`, `capability:<name>`, `passport:schema`) | `agent_id` |
| `starknet_give_feedback` | Submit reputation feedback entries | `agent_id`, `value`, `value_decimals?`, `tag1?`, `tag2?`, `feedback_uri?`, `gasfree?` |
| `starknet_get_reputation` | Read aggregated reputation summary | `agent_id`, `tag1?`, `tag2?` |
| `starknet_request_validation` | Create validation requests | `validator_address`, `agent_id`, `request_uri`, `request_hash?`, `gasfree?` |
| `starknet_call_contract` | Read fallback for advanced/custom view calls | `contractAddress`, `entrypoint`, `calldata?` |
| `starknet_invoke_contract` | Write fallback for advanced/custom flows | `contractAddress`, `entrypoint`, `calldata`, `gasfree?` |

## Prerequisites

```bash
npm install starknet@^8.9.1
```

Environment variables:
```bash
STARKNET_RPC_URL=https://starknet-sepolia.public.blastapi.io
STARKNET_ACCOUNT_ADDRESS=0x...
STARKNET_PRIVATE_KEY=0x...
IDENTITY_REGISTRY_ADDRESS=0x72eb37b0389e570bf8b158ce7f0e1e3489de85ba43ab3876a0594df7231631
REPUTATION_REGISTRY_ADDRESS=0x5a68b5e121a014b9fc39455d4d3e0eb79fe2327329eb734ab637cee4c55c78e
VALIDATION_REGISTRY_ADDRESS=0x7c8ac08e98d8259e1507a2b4b719f7071104001ed7152d4e9532a6850a62a4f
```

## Validation Scripts

Bundled scripts under `skills/starknet-identity/scripts/`:

- `register-agent.ts` - register a new identity and print parsed `agentId`
- `set-metadata.ts` - update metadata (including `caps` JSON validation)
- `query-reputation.ts` - aggregated reputation + per-client counts
- `query-validation.ts` - validation summary + request status

## Agent Registration

### MCP Recommended (Production Path)

```typescript
// Register identity (mint ERC-8004 NFT)
const registration = await mcpClient.callTool({
  name: "starknet_register_agent",
  arguments: {
    token_uri: "ipfs://QmYourAgentSpecHash",
  },
});

// Store key metadata
await mcpClient.callTool({
  name: "starknet_set_agent_metadata",
  arguments: {
    agent_id: registration.agentId,
    key: "agentName",
    value: "MyTradingAgent",
  },
});

// Read metadata back for verification
const metadata = await mcpClient.callTool({
  name: "starknet_get_agent_metadata",
  arguments: {
    agent_id: registration.agentId,
    key: "agentName",
  },
});
```

### Register a New Agent

```typescript
import { Account, RpcProvider, Contract, CallData, ETransactionVersion, byteArray } from "starknet";

const provider = new RpcProvider({ nodeUrl: process.env.STARKNET_RPC_URL });
const account = new Account({
  provider,
  address,
  signer: privateKey,
  transactionVersion: ETransactionVersion.V3,
});

const identityRegistry = new Contract({
  abi: identityRegistryAbi,
  address: registryAddress,
  providerOrAccount: account,
});

// Register with metadata
const metadata = [
  { key: "agentName", value: "MyTradingAgent" },
  { key: "agentType", value: "defi-trader" },
  { key: "version", value: "1.0.0" },
  { key: "model", value: "claude-opus-4-5" },
  { key: "status", value: "active" },
];

const tokenUri = "ipfs://QmYourAgentSpecHash"; // IPFS link to full agent spec

const { transaction_hash } = await account.execute({
  contractAddress: registryAddress,
  entrypoint: "register_with_metadata",
  calldata: CallData.compile({
    token_uri: byteArray.byteArrayFromString(tokenUri),
    metadata: metadata.map((entry) => ({
      key: byteArray.byteArrayFromString(entry.key),
      value: byteArray.byteArrayFromString(entry.value),
    })),
  }),
});

const receipt = await provider.waitForTransaction(transaction_hash);
// Parse agent_id from events
```

### Query Agent Information

```typescript
// Check if agent exists
const exists = await identityRegistry.agent_exists(agentId);

// Get total registered agents
const totalAgents = await identityRegistry.total_agents();

// Get agent metadata
const name = await identityRegistry.get_metadata(agentId, "agentName");
const agentType = await identityRegistry.get_metadata(agentId, "agentType");

// Get agent owner (ERC-721)
const owner = await identityRegistry.owner_of(agentId);
```

### Update Agent Metadata

```typescript
// Only the agent owner can update metadata
await account.execute({
  contractAddress: registryAddress,
  entrypoint: "set_metadata",
  calldata: CallData.compile({
    agent_id: agentId,
    key: byteArray.byteArrayFromString("status"),
    value: byteArray.byteArrayFromString("upgraded"),
  }),
});
```

Do not set `agentWallet` through `set_metadata`; it is reserved for wallet-authenticated flows.

## Reputation System

### Authorize and Submit Feedback

The reputation system uses a cryptographic authorization flow:

1. **Agent owner** creates a FeedbackAuth struct and signs it
2. **Client** submits feedback with the authorization

```typescript
// Step 1: Agent owner creates authorization
const feedbackAuth = {
  agent_id: agentId,
  client_address: clientAddress,
  index_limit: 10, // Max feedback entries allowed
  expiry: Math.floor(Date.now() / 1000) + 3600, // 1 hour
  chain_id: chainId,
  identity_registry: registryAddress,
  signer_address: ownerAddress,
};

// Sign the authorization (using agent owner's account)
const messageHash = computePoseidonHash(feedbackAuth); // EIP-712 style
const signature = await ownerAccount.signMessage(messageHash);

// Step 2: Client submits feedback
await clientAccount.execute({
  contractAddress: reputationRegistryAddress,
  entrypoint: "give_feedback",
  calldata: CallData.compile({
    agent_id: agentId,
    score: 85, // 0-100
    tag1: encodedTag("reliability"),
    tag2: encodedTag("speed"),
    fileuri: "",
    filehash: 0,
    feedback_auth: feedbackAuth,
    signature: signature,
  }),
});
```

### Query Reputation

```typescript
const reputationRegistry = new Contract({
  abi: reputationAbi,
  address: reputationAddress,
  providerOrAccount: provider,
});

// Get summary for an agent (count + average score)
const [count, avgScore] = await reputationRegistry.get_summary(
  agentId,
  [], // all client addresses (or filter specific ones)
  "", // tag1 filter (empty = all)
  "", // tag2 filter (empty = all)
);

// Read specific feedback
const [score, tag1, tag2, isRevoked] = await reputationRegistry.read_feedback(
  agentId,
  clientAddress,
  feedbackIndex,
);

// Get all clients who gave feedback
const clients = await reputationRegistry.get_clients(agentId);
```

## Validation System

### Request Validation

```typescript
const validationRegistry = new Contract({
  abi: validationAbi,
  address: validationAddress,
  providerOrAccount: account,
});

// Agent owner requests validation from a specific validator
await account.execute({
  contractAddress: validationAddress,
  entrypoint: "validation_request",
  calldata: CallData.compile({
    validator_address: validatorAddress,
    agent_id: agentId,
    request_uri: "ipfs://QmValidationRequestDetails",
    request_hash: 0, // Auto-generated if 0
  }),
});
```

### Submit Validation Response

```typescript
// Validator responds to the request
await validatorAccount.execute({
  contractAddress: validationAddress,
  entrypoint: "validation_response",
  calldata: CallData.compile({
    request_hash: requestHash,
    response: 92, // Score 0-100
    response_uri: "ipfs://QmValidationReport",
    response_hash: reportHash,
    tag: encodedTag("performance"),
  }),
});
```

### Query Validation Status

```typescript
// Get validation summary
const [validationCount, avgValidationScore] = await validationRegistry.get_summary(
  agentId,
  [], // all validators
  "", // tag filter (empty = all)
);

// Get specific validation
const [validator, agentId_, response, responseHash, tag, lastUpdate] =
  await validationRegistry.get_validation_status(requestHash);
```

## A2A Agent Card Integration

Combine on-chain identity with A2A Agent Cards for discoverability:

```json
{
  "name": "MyTradingAgent",
  "description": "Autonomous DeFi trading agent on Starknet",
  "url": "https://my-agent.example.com",
  "provider": {
    "organization": "MyOrg"
  },
  "version": "1.0.0",
  "capabilities": {
    "streaming": true,
    "pushNotifications": false
  },
  "skills": [
    {
      "id": "starknet-swap",
      "name": "Token Swap",
      "description": "Execute token swaps on Starknet via avnu"
    }
  ],
  "defaultInputModes": ["text/plain"],
  "defaultOutputModes": ["text/plain"],
  "authentication": {
    "schemes": ["bearer"]
  },
  "starknetIdentity": {
    "registryAddress": "0x...",
    "agentId": 42,
    "reputationScore": 85,
    "validationCount": 3
  }
}
```

Serve at `/.well-known/agent.json` for A2A discovery.

## Metadata Schema (Recommended)

| Key | Description | Example |
|-----|-------------|---------|
| `agentName` | Display name | `"MyTradingAgent"` |
| `agentType` | Category | `"defi-trader"`, `"nft-curator"`, `"data-analyst"` |
| `version` | Semantic version | `"1.0.0"` |
| `model` | LLM model used | `"claude-opus-4-5"`, `"gpt-4o"` |
| `status` | Current status | `"active"`, `"paused"`, `"deprecated"` |
| `framework` | Agent framework | `"daydreams"`, `"openclaw"`, `"langchain"` |
| `capabilities` | Comma-separated | `"swap,stake,lend"` |
| `a2aEndpoint` | Agent Card URL | `"https://agent.example.com"` |
| `moltbookId` | MoltBook agent ID | `"agent_abc123"` |

## Security Considerations

- Only the agent owner can update metadata and authorize feedback
- Feedback requires cryptographic authorization (prevents spam)
- Self-feedback is prevented (agent owner cannot give feedback to own agent)
- Self-validation is prevented (agent owner cannot validate own agent)
- Signatures include chain ID and expiry to prevent replay attacks
- Agent identity (NFT) is transferable -- new owner inherits reputation

## MCP vs Direct Execution Boundaries

Use MCP for:

- Agent registration (`starknet_register_agent`)
- Metadata set/get (`starknet_set_agent_metadata`, `starknet_get_agent_metadata`)
- Generic contract reads/writes (`starknet_call_contract`, `starknet_invoke_contract`)

Use direct contract logic in this skill for:

- Reputation authorization payload composition and signature workflows
- Validation request/response lifecycle helpers
- Specialized analytics across feedback/validation history

## Production Checklist

1. Register identity and persist `(agentId, transactionHash)` in your agent state.
2. Enforce metadata key allowlist and block reserved key `agentWallet`.
3. Validate JSON fields (`caps`, `capabilities`) before writing on-chain.
4. Treat feedback/validation signatures as expiring credentials; rotate frequently.
5. Reconcile ownership transfers and re-verify metadata authority after transfer events.
6. Serve and monitor `/.well-known/agent.json` for A2A discovery consistency.

## Agent Passport

Agent Passport on ERC-8004 uses three canonical metadata keys:

- `caps`: JSON array of capability names
- `capability:<name>`: JSON payload for that capability
- `passport:schema`: schema id (`https://starknet-agentic.dev/schemas/agent-passport.schema.json`)

`caps` remains the index, while `capability:<name>` stores structured capability payloads.

```typescript
// Set Agent Passport capability index
await account.execute({
  contractAddress: registryAddress,
  entrypoint: "set_metadata",
  calldata: CallData.compile({
    agent_id: agentId,
    key: byteArray.byteArrayFromString("caps"),
    value: byteArray.byteArrayFromString(JSON.stringify(["swap", "stake", "lend", "transfer"])),
  }),
});

// Set one capability payload
await account.execute({
  contractAddress: registryAddress,
  entrypoint: "set_metadata",
  calldata: CallData.compile({
    agent_id: agentId,
    key: byteArray.byteArrayFromString("capability:swap"),
    value: byteArray.byteArrayFromString(
      JSON.stringify({
        name: "swap",
        category: "defi",
        version: "1.0.0",
        description: "Swap tokens via AVNU",
        endpoint: "mcp://@starknet-agentic/mcp-server/starknet_swap",
        mcpTool: "starknet_swap",
        a2aSkillId: "swap",
      })
    ),
  }),
});

// Read Agent Passport index
const capsRaw = await identityRegistry.get_metadata(agentId, "caps");
const capabilities = JSON.parse(capsRaw); // ["swap", "stake", "lend", "transfer"]
```

Capability categories: `defi`, `trading`, `identity`, `messaging`, `payments`, `prediction`.

Use the `@starknet-agentic/agent-passport` package for validated passport operations:

```typescript
import { IdentityRegistryPassportClient } from "@starknet-agentic/agent-passport";

const passport = new IdentityRegistryPassportClient({
  identityRegistryAddress: registryAddress,
  provider,
  account,
});

await passport.publishCapability({
  agentId: 1n,
  capability: {
    name: "swap",
    category: "defi",
    description: "Execute token swaps via AVNU",
    version: "1.0.0",
    mcpTool: "starknet_swap",
    a2aSkillId: "swap",
  },
});
```

## Error Reference

| Error Code | Description | Recovery |
|------------|-------------|----------|
| `AGENT_NOT_FOUND` | Agent ID does not exist | Verify agent is registered |
| `NOT_AGENT_OWNER` | Caller is not the agent owner | Use the owner account |
| `ALREADY_REGISTERED` | Address already has an agent | Use existing agent ID |
| `FEEDBACK_AUTH_EXPIRED` | Authorization timestamp passed | Request new authorization |
| `SELF_FEEDBACK` | Agent owner trying to give self-feedback | Use a different account |
| `SELF_VALIDATION` | Agent owner trying to self-validate | Use independent validator |
| `INVALID_SIGNATURE` | Feedback authorization signature invalid | Regenerate signature |
| `INDEX_LIMIT_REACHED` | Feedback index exceeds authorized limit | Request new authorization with higher index limit |

## Deployed Addresses

Source: `contracts/erc8004-cairo/README.md` (as checked on 2026-02-24).  
Current v1 launch scope is Sepolia only.

### Sepolia

| Contract | Address | Notes |
|----------|---------|-------|
| IdentityRegistry | `0x72eb37b0389e570bf8b158ce7f0e1e3489de85ba43ab3876a0594df7231631` | ERC-721 agent identities |
| ReputationRegistry | `0x5a68b5e121a014b9fc39455d4d3e0eb79fe2327329eb734ab637cee4c55c78e` | Feedback and scoring |
| ValidationRegistry | `0x7c8ac08e98d8259e1507a2b4b719f7071104001ed7152d4e9532a6850a62a4f` | Third-party validations |

Mainnet publishing for this skill is intentionally deferred until the mainnet onboarding workstream is approved.

> Deploy using: `cd contracts/erc8004-cairo && bash scripts/deploy_sepolia.sh`

## Full Metadata Schema

| Key | Type | Description | Example |
|-----|------|-------------|---------|
| `agentName` | string | Display name | `"MyTradingAgent"` |
| `agentType` | string | Category | `"defi-trader"` |
| `version` | string | Semantic version | `"1.0.0"` |
| `model` | string | LLM model used | `"claude-opus-4-5"` |
| `status` | string | Current status | `"active"` / `"paused"` / `"deprecated"` |
| `framework` | string | Agent framework | `"daydreams"` / `"openclaw"` |
| `capabilities` | string | Comma-separated list | `"swap,stake,lend"` |
| `caps` | JSON | Agent Passport capabilities array | `'["swap","stake"]'` |
| `a2aEndpoint` | string | Agent Card URL | `"https://agent.example.com"` |
| `moltbookId` | string | MoltBook agent ID | `"agent_abc123"` |

## References

- [ERC-8004 EIP](https://eips.ethereum.org/EIPS/eip-8004)
- [ERC-8004 Cairo Implementation](https://github.com/Akashneelesh/erc8004-cairo)
- [A2A Protocol](https://a2a-protocol.org/latest/)
- [Starknet Account Abstraction](https://www.starknet.io/blog/native-account-abstraction/)
