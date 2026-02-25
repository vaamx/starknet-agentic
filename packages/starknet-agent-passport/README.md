# @starknet-agentic/agent-passport

Agent Passport conventions and client utilities on top of ERC-8004 `IdentityRegistry`.

This package uses existing `set_metadata/get_metadata` flows and standardizes capability metadata so identities can be consumed consistently across MCP, A2A, and app-specific surfaces.

## Metadata Convention (v1)

All values are JSON strings.

- `caps`: JSON array of capability names. Example: `["swap","forecast"]`
- `capability:<name>`: JSON object describing one capability
- `passport:schema`: schema id string (`https://starknet-agentic.dev/schemas/agent-passport.schema.json`)

Example capability object:

```json
{
  "name": "forecast",
  "category": "prediction",
  "description": "Generate calibrated probabilities for binary markets",
  "version": "1.0.0",
  "endpoint": "https://agent.example.com/api/predict",
  "mcpTool": "starknet_call_contract",
  "a2aSkillId": "forecast"
}
```

Capability categories are currently:

- `defi`
- `trading`
- `identity`
- `messaging`
- `payments`
- `prediction`

## API

`IdentityRegistryPassportClient`:

- `publishCapability({ agentId, capability })`
- `publishPassport({ agentId, passport })`
- `getPassport(agentId)`
- `getMetadata(agentId, key)` / `setMetadata(agentId, key, value)`

Validation helpers:

- `validatePassport(data)`
- `parseCapsList(raw)` / `stringifyCapsList(names)`
- `capabilityKey(name)`

## Example

```ts
import { IdentityRegistryPassportClient } from "@starknet-agentic/agent-passport"

const client = new IdentityRegistryPassportClient({
  identityRegistryAddress: process.env.IDENTITY_REGISTRY_ADDRESS!,
  provider,
  account,
})

await client.publishPassport({
  agentId: 42n,
  passport: {
    capabilities: [
      {
        name: "forecast",
        category: "prediction",
        version: "1.0.0",
        description: "Calibrated prediction market forecasts",
        endpoint: "https://agent.example.com/api/predict",
        mcpTool: "starknet_call_contract",
        a2aSkillId: "forecast",
      },
    ],
  },
})
```

## Why this works

- Identity stays ERC-8004, so it’s the portable passport.
- Capability discovery is deterministic via the `caps` index.
- Schema-conforming capability payloads reduce downstream parser drift.
