# Starknet Identity Scripts

Operational scripts for validating ERC-8004 identity workflows.

## Setup

```bash
cd skills/starknet-identity
npm install
cp .env.example .env
```

## Scripts

### `register-agent`

Register a new agent identity with metadata.

```bash
npm run register-agent -- "MyAgent" "defi" "1.0.0" "ipfs://QmYourMetadata"
npm run register-agent -- "ForecastAgent" "prediction" "1.0.0" "ipfs://QmMeta" '["forecast","analyze"]'
```

### `set-metadata`

Set metadata for an existing agent ID.

```bash
npm run set-metadata -- 1 agentName "MyAgent V2"
npm run set-metadata -- 1 caps '["swap","forecast","validate"]'
npm run set-metadata -- 1 capability:forecast '{"name":"forecast","category":"prediction","mcpTool":"starknet_call_contract"}'
```

### `query-reputation`

Read aggregated reputation and per-client feedback count.

```bash
npm run query-reputation -- 1
```

### `query-validation`

Read validation summary and a specific request status.

```bash
npm run query-validation -- 1
npm run query-validation -- 1 0x1234
```

## Notes

- Scripts are for operational validation and examples.
- Production agent execution should prefer MCP identity tools where available.
