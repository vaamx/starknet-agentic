# Agent Passport Migration Guide (ERC-8004)

Last updated: 2026-02-24  
Scope: migrate existing ERC-8004 agent metadata to the Agent Passport convention used in v1.

## Why migrate

Agent Passport standardizes capability metadata so MCP clients, A2A adapters, and app UIs read one canonical format.

Canonical keys:

- `caps` (JSON array of capability names)
- `capability:<name>` (JSON object per capability)
- `passport:schema` (schema id)

Schema id:

`https://starknet-agentic.dev/schemas/agent-passport.schema.json`

## Legacy to Passport Mapping

| Legacy pattern | Passport mapping |
|---|---|
| `capabilities` as freeform text/JSON | `caps` + `capability:<name>` entries |
| Per-feature custom keys (`canSwap`, `supportsForecast`, etc.) | normalized capability objects under `capability:<name>` |
| Missing schema identifier | write `passport:schema` |

## Migration Steps

1. Read and back up current metadata:
- `agentName`, `agentType`, `version`, `model`, `status`, `framework`, `capabilities`, `a2aEndpoint`, `moltbookId`

2. Build normalized capabilities:
- pick stable lowercase names (`swap`, `forecast`, `identity-read`, etc.)
- set `category` from: `defi|trading|identity|messaging|payments|prediction`
- optional: `version`, `description`, `endpoint`, `mcpTool`, `a2aSkillId`

3. Publish passport keys:
- write each `capability:<name>` JSON payload
- write `caps` array
- write `passport:schema`

4. Verify:
- run `starknet_get_agent_passport` MCP tool, or
- use `IdentityRegistryPassportClient.getPassport(agentId)`

5. Compatibility window (recommended):
- keep legacy `capabilities` metadata for one release cycle while consumers migrate

## Example Script

```ts
import {
  IdentityRegistryPassportClient,
  PASSPORT_SCHEMA_ID,
} from "@starknet-agentic/agent-passport";
import { RpcProvider, Account, ec } from "starknet";

const provider = new RpcProvider({ nodeUrl: process.env.STARKNET_RPC_URL! });
const account = new Account({
  provider,
  address: process.env.STARKNET_ACCOUNT_ADDRESS!,
  signer: ec.starkCurve.getStarkKey(process.env.STARKNET_PRIVATE_KEY!),
});

const client = new IdentityRegistryPassportClient({
  identityRegistryAddress: process.env.ERC8004_IDENTITY_REGISTRY_ADDRESS!,
  provider,
  account,
});

const agentId = 42n;

await client.publishPassport({
  agentId,
  passport: {
    capabilities: [
      {
        name: "forecast",
        category: "prediction",
        version: "1.0.0",
        description: "Generate calibrated probabilities",
        mcpTool: "prediction_get_market",
        a2aSkillId: "forecast",
      },
      {
        name: "payments",
        category: "payments",
        version: "1.0.0",
        description: "Create invoices and payment links",
        mcpTool: "starknet_create_invoice",
        a2aSkillId: "payments",
      },
    ],
  },
});

const passport = await client.getPassport(agentId);
console.log(PASSPORT_SCHEMA_ID, passport.capabilities.map((c) => c.name));
```

## Rollback

If migration payloads are invalid for your consumers:

1. Restore prior values for `capabilities` and custom keys from backup.
2. Overwrite `caps` with previous stable set (or empty `[]` if reverting fully).
3. Overwrite/remove affected `capability:<name>` keys.
4. Re-run verification before re-enabling dependent clients.

