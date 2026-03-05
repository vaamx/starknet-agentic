# Starknet MCP Server

An MCP (Model Context Protocol) server that exposes Starknet blockchain operations as tools for AI agents.

## Features

- **Wallet Operations**: Check balances, transfer tokens
- **Contract Interactions**: Call read/write functions on any Starknet contract
- **DeFi Operations**: Execute swaps via avnu aggregator with best-price routing
- **Execution Surface Guardrails**: `STARKNET_EXECUTION_SURFACE` controls tool routing and blocks unsupported combinations
- **Fee Estimation**: Estimate transaction costs before execution
- **Mini-Pay Operations**: Payment links, invoices, and QR payload generation
- **Multi-token Support**: ETH, STRK, USDC, USDT, and custom ERC20 tokens

## Installation

```bash
cd packages/starknet-mcp-server
npm install
npm run build
```

## Configuration

Create a `.env` file with your Starknet credentials.

Direct signer mode (development/local only):

```bash
STARKNET_RPC_URL=https://starknet-mainnet.g.alchemy.com/v2/YOUR_KEY
STARKNET_ACCOUNT_ADDRESS=0x...
STARKNET_EXECUTION_SURFACE=direct
STARKNET_EXECUTION_PROFILE=hardened
STARKNET_SIGNER_MODE=direct
STARKNET_PRIVATE_KEY=0x...

# avnu URLs (optional -- defaults shown)
AVNU_BASE_URL=https://starknet.api.avnu.fi
AVNU_PAYMASTER_URL=https://starknet.paymaster.avnu.fi
#
# Paymaster fee mode:
# - sponsored: dApp pays gas (requires AVNU to authorize your API key for sponsored builds)
# - default: user pays gas in `gasToken` via paymaster
# Defaults to "sponsored" when AVNU_PAYMASTER_API_KEY is set; otherwise "default".
# You can force "default" to avoid failures when your key is not sponsor-authorized.
AVNU_PAYMASTER_FEE_MODE=default

# Optional ERC-8004 registry integrations
ERC8004_IDENTITY_REGISTRY_ADDRESS=0x...
ERC8004_REPUTATION_REGISTRY_ADDRESS=0x...
ERC8004_VALIDATION_REGISTRY_ADDRESS=0x...
```

Proxy signer mode (recommended for production):

```bash
STARKNET_RPC_URL=https://starknet-mainnet.g.alchemy.com/v2/YOUR_KEY
STARKNET_ACCOUNT_ADDRESS=0x...
STARKNET_EXECUTION_SURFACE=direct
STARKNET_EXECUTION_PROFILE=hardened
STARKNET_SIGNER_MODE=proxy
KEYRING_PROXY_URL=https://signer.internal:8545
KEYRING_HMAC_SECRET=replace-with-long-random-secret
KEYRING_CLIENT_ID=starknet-mcp-server
# mTLS client material (required in production for non-loopback signer URLs)
# KEYRING_TLS_CLIENT_CERT_PATH=/etc/starknet-mcp/tls/client.crt
# KEYRING_TLS_CLIENT_KEY_PATH=/etc/starknet-mcp/tls/client.key
# KEYRING_TLS_CA_PATH=/etc/starknet-mcp/tls/ca.crt
# Optional:
# KEYRING_SIGNING_KEY_ID=default
# KEYRING_REQUEST_TIMEOUT_MS=5000
# KEYRING_SESSION_VALIDITY_SECONDS=300
```

`STARKNET_EXECUTION_SURFACE` values:
- `direct` (default): direct account execution for transfers/swaps.
- `avnu`: enables AVNU quote/swap path; transfer remains direct-only and is blocked otherwise.
- `starkzap`: executes transfer/swap calls through Starkzap wallet execution path.
  Requirements: `STARKNET_SIGNER_MODE=direct`, `STARKNET_PRIVATE_KEY`, and `starkzap` dependency installed.

`STARKNET_EXECUTION_PROFILE` values:
- `hardened` (default): when `STARKNET_EXECUTION_SURFACE=starkzap`, only `starknet_transfer` and `starknet_swap` can execute through Starkzap.
- `standard`: legacy behavior; all write tools that use account execution may run through Starkzap.

Optional fallback:
- `STARKNET_STARKZAP_FALLBACK_TO_DIRECT=true`: if Starkzap is unavailable (missing SDK or invalid Starkzap signer preconditions), transfer/swap execution falls back to direct account execution and emits structured fallback telemetry.

Signer boundary contract:
- OpenAPI: `spec/signer-api-v1.openapi.yaml`
- JSON Schema: `spec/signer-api-v1.schema.json`
- Auth vectors: `spec/signer-auth-v1.json`
- Auth vectors schema: `spec/signer-auth-v1.schema.json`
- Security notes: `docs/security/SIGNER_API_SPEC.md`
- Rotation runbook: `docs/security/SIGNER_PROXY_ROTATION_RUNBOOK.md`

Interop note:
- `spec/interop-version.json` remains at `0.1.0` until cross-repo conformance updates land.
- Proxy clients should follow the signer API v1 contract above, including `X-Keyring-Client-Id`.

SISNA server-side production key-custody guard:
- Current SISNA builds fail production startup unless
  `KEYRING_ALLOW_INSECURE_IN_PROCESS_KEYS_IN_PRODUCTION=true` is explicitly set
  while in-process key custody is still used.
- This is a temporary explicit-risk acknowledgement until external KMS/HSM
  signing mode is available in SISNA.

Production startup guard: `KEYRING_PROXY_URL` must use `https://` unless loopback is used (`http://127.0.0.1`, `http://localhost`, or `http://[::1]`).
Production startup guard (non-loopback signer URLs): `KEYRING_TLS_CLIENT_CERT_PATH`, `KEYRING_TLS_CLIENT_KEY_PATH`, and `KEYRING_TLS_CA_PATH` are required.

## Usage

### With Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "starknet": {
      "command": "node",
      "args": [
        "/path/to/starknet-agentic/packages/starknet-mcp-server/dist/index.js"
      ],
      "env": {
        "STARKNET_RPC_URL": "https://starknet-mainnet.g.alchemy.com/v2/YOUR_KEY",
        "STARKNET_ACCOUNT_ADDRESS": "0x...",
        "STARKNET_SIGNER_MODE": "proxy",
        "KEYRING_PROXY_URL": "http://127.0.0.1:8545",
        "KEYRING_HMAC_SECRET": "replace-with-long-random-secret"
      }
    }
  }
}
```

If you run direct mode locally instead:

```json
{
  "mcpServers": {
    "starknet": {
      "command": "node",
      "args": [
        "/path/to/starknet-agentic/packages/starknet-mcp-server/dist/index.js"
      ],
      "env": {
        "STARKNET_RPC_URL": "https://starknet-mainnet.g.alchemy.com/v2/YOUR_KEY",
        "STARKNET_ACCOUNT_ADDRESS": "0x...",
        "STARKNET_SIGNER_MODE": "direct",
        "STARKNET_PRIVATE_KEY": "0x..."
      }
    }
  }
}
```

### With Other MCP Clients

Any MCP-compatible client can use this server via stdio transport.

## Available Tools

### `starknet_get_balance`

Get token balance for an address.

```typescript
{
  "token": "ETH",  // or "STRK", "USDC", "USDT", or contract address
  "address": "0x..."  // optional, defaults to agent's address
}
```

### `starknet_transfer`

Transfer tokens to another address.

```typescript
{
  "recipient": "0x...",
  "token": "STRK",
  "amount": "10.5"  // human-readable format
}
```

### `starknet_call_contract`

Call a read-only contract function.

```typescript
{
  "contractAddress": "0x...",
  "entrypoint": "balanceOf",
  "calldata": ["0x..."]  // optional
}
```

### `starknet_invoke_contract`

Invoke a state-changing contract function.

```typescript
{
  "contractAddress": "0x...",
  "entrypoint": "approve",
  "calldata": ["0x...", "1000000"]
}
```

### `starknet_swap`

Execute a token swap using avnu aggregator.

```typescript
{
  "sellToken": "ETH",
  "buyToken": "STRK",
  "amount": "0.1",
  "slippage": 0.01  // optional, defaults to 1%
}
```

### `starknet_get_quote`

Get swap quote without executing.

```typescript
{
  "sellToken": "ETH",
  "buyToken": "USDC",
  "amount": "1.0"
}
```

### `starknet_execution_surface_status`

Report execution readiness and effective surface selection, including Starkzap probe status and fallback posture.

### `starknet_estimate_fee`

Estimate transaction fee.

```typescript
{
  "contractAddress": "0x...",
  "entrypoint": "transfer",
  "calldata": ["0x...", "1000"]
}
```

### `starknet_get_agent_info`

Read consolidated ERC-8004 identity state (exists/owner/wallet/token URI + selected metadata keys).

```typescript
{
  "agent_id": "1",
  "metadata_keys": ["agentName", "status"] // optional
}
```

### `starknet_update_agent_metadata`

Alias for `starknet_set_agent_metadata`.

```typescript
{
  "agent_id": "1",
  "key": "status",
  "value": "active",
  "gasfree": false
}
```

### `starknet_give_feedback`

Write ERC-8004 feedback entry to ReputationRegistry.

```typescript
{
  "agent_id": "1",
  "value": "85",
  "value_decimals": 2,
  "tag1": "accuracy",
  "tag2": "weekly",
  "feedback_uri": "ipfs://feedback-1"
}
```

### `starknet_get_reputation`

Read aggregated reputation summary for an agent.

```typescript
{
  "agent_id": "1",
  "tag1": "accuracy", // optional
  "tag2": "" // optional
}
```

### `starknet_request_validation`

Create an ERC-8004 validation request for a designated validator.

```typescript
{
  "validator_address": "0x...",
  "agent_id": "1",
  "request_uri": "ipfs://validation-req",
  "request_hash": "0" // optional
}
```

### `starknet_create_payment_link`

Create a Starknet payment link.

```typescript
{
  "address": "0x...",
  "amount": "1.5", // optional
  "token": "USDC", // optional
  "memo": "coffee" // optional
}
```

### `starknet_parse_payment_link`

Parse a Starknet payment link into normalized fields.

```typescript
{
  "paymentLink": "starknet:0x...?amount=1.5&token=USDC&memo=coffee"
}
```

### `starknet_create_invoice`

Create a stateless invoice payload + payment link.

```typescript
{
  "recipient": "0x...",
  "amount": "10",
  "token": "USDC",         // optional
  "memo": "consulting",    // optional
  "expiresInSeconds": 3600 // optional
}
```

### `starknet_get_invoice_status`

Check invoice status and optional transaction fulfillment.

```typescript
{
  "invoiceId": "eyJ2IjoxLC4uLg",
  "transactionHash": "0x..." // optional
}
```

### `starknet_generate_qr`

Generate QR-style SVG payloads from raw content or payment fields.

```typescript
{
  "content": "starknet:0x...?amount=1&token=USDC", // optional if address is provided
  "address": "0x...", // optional
  "format": "data_url" // "data_url" | "svg"
}
```

## Development

```bash
# Watch mode for development
npm run dev

# Run tests
npm test

# Build
npm run build
```

## Architecture

The server uses:
- `@modelcontextprotocol/sdk` for MCP protocol implementation
- `starknet.js` v6 for Starknet interactions
- `@avnu/avnu-sdk` for DeFi operations
- `zod` for input validation

## Security

- Production startup guard: `NODE_ENV=production` requires `STARKNET_SIGNER_MODE=proxy`
- Production startup guard: rejects `STARKNET_PRIVATE_KEY` when `STARKNET_SIGNER_MODE=proxy`
- Production startup guard: non-loopback proxy URLs require mTLS client cert/key/CA paths
- Proxy mode keeps signing outside MCP process (`starknet-keyring-proxy`)
- Signer boundary API is versioned at `/v1/sign/session-transaction`
- SISNA currently requires explicit production acknowledgement for in-process
  key custody: `KEYRING_ALLOW_INSECURE_IN_PROCESS_KEYS_IN_PRODUCTION=true`
- Direct private key mode is intended for local development only
- All inputs are validated before execution
- Transactions wait for confirmation before returning
- Comprehensive error handling for all operations

## License

MIT
