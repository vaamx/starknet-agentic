---
name: huginn-log
description: Log AI reasoning on-chain for auditability and verifiable provenance. Hash reasoning text with SHA-256, store the u256 hash in the Huginn Registry on Starknet, and optionally prove it with a ZK verifier. Creates an immutable, trustless audit trail of AI decision-making.
license: Apache-2.0
metadata: {"author":"starknet-agentic","version":"1.0.0","org":"keep-starknet-strange"}
keywords: [huginn, provenance, reasoning, on-chain, sha256, hash, zk-proof, audit, thought-log, trustless]
allowed-tools: [Bash, Read, Write]
user-invocable: true
---

# Huginn Log Skill

Create an immutable, verifiable on-chain record of AI reasoning for trustless provenance.

## Why Provenance Matters

AI agents make consequential decisions (bets, trades, votes). Without provenance:
- No way to verify what data the agent saw
- No audit trail for accountability
- No foundation for reputation systems

Huginn Registry solves this by anchoring SHA-256 hashes of reasoning on Starknet.

## Huginn Registry Interface

```cairo
#[starknet::interface]
trait IHuginnRegistry {
  // Register agent identity (must call before log_thought)
  fn register_agent(name: felt252, metadata_url: ByteArray);

  // Log a thought hash (SHA-256 of reasoning text)
  fn log_thought(thought_hash: u256);

  // Prove a thought with ZK proof (optional, requires verifier)
  fn prove_thought(thought_hash: u256, proof: Span<felt252>);

  // Read agent profile
  fn get_agent(agent_id: ContractAddress) -> (felt252, ByteArray);

  // Check proof status for a hash
  fn proof_exists(thought_hash: u256) -> bool;
}
```

## Events

| Event | Keys | Meaning |
|-------|------|---------|
| `OdinEye` | `agent_id`, `name` | Agent registered |
| `RavenFlight` | `agent_id`, `thought_hash` | Reasoning logged |
| `MimirWisdom` | `agent_id`, `thought_hash`, `proof_verified` | ZK proof submitted |

## SHA-256 → u256 Hash Format

SHA-256 produces 32 bytes. Cairo's `u256 = { low: u128, high: u128 }` splits them:

```typescript
// TypeScript: hash → u256 low/high split
const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
const bytes = new Uint8Array(hash); // 32 bytes

const highHex = Array.from(bytes.slice(0, 16)).map(b => b.toString(16).padStart(2, "0")).join("");
const lowHex  = Array.from(bytes.slice(16, 32)).map(b => b.toString(16).padStart(2, "0")).join("");

const high = BigInt("0x" + highHex); // bytes[0..16]
const low  = BigInt("0x" + lowHex);  // bytes[16..32]
```

**Important**: `high` = first 16 bytes (most significant), `low` = last 16 bytes (least significant).

## huginn-executor.ts API

```typescript
import { computeThoughtHash, logThoughtOnChain } from "@/lib/huginn-executor";

// Just hash (no on-chain write)
const hash = await computeThoughtHash("My reasoning about this market...");
// → "0xa3f8e2d1..." (64 hex chars)

// Hash + log on-chain
const result = await logThoughtOnChain("My reasoning about this market...");
// result.status: "success" | "skipped" | "error"
// result.thoughtHash: "0xa3f8e2d1..."
// result.txHash?: "0x..." (transaction hash, if logged)
```

## Environment Variable

```bash
# Set to deployed Huginn Registry address on Sepolia (skip if not using)
HUGINN_REGISTRY_ADDRESS=0x...

# Leave as "0x0" to skip silently (graceful degradation)
HUGINN_REGISTRY_ADDRESS=0x0  # default
```

## Direct On-Chain Call (starknet.js)

**You must call `register_agent` once before any `log_thought` calls.** Calling `log_thought`
on an unregistered agent panics with `'Agent not registered'`. If you use `huginn-executor.ts`,
registration is handled automatically.

```typescript
import { Account, RpcProvider, CallData, shortString } from "starknet";

const provider = new RpcProvider({ nodeUrl: process.env.STARKNET_RPC_URL });
const account = new Account({
  provider,
  address: process.env.AGENT_ADDRESS,
  signer: process.env.AGENT_PRIVATE_KEY,
});

const huginnAddress = process.env.HUGINN_REGISTRY_ADDRESS;

// Step 1: Register the agent (one-time, skip if already registered).
// metadata_url is a Cairo ByteArray — pass raw felt array: [data_len, pending_word, pending_word_len].
// DO NOT use CallData.compile({ metadata_url: "" }) — it encodes "" as felt252, not ByteArray.
await account.execute([{
  contractAddress: huginnAddress,
  entrypoint: "register_agent",
  calldata: [
    shortString.encodeShortString("MyAgent"), // name: felt252
    "0x0",  // ByteArray::data.len        = 0 (empty array)
    "0x0",  // ByteArray::pending_word    = 0
    "0x0",  // ByteArray::pending_word_len = 0
  ],
}]);

// Step 2: Hash the reasoning text.
const reasoning = "After analyzing Polymarket odds (28%) and CoinGecko price ($0.132)...";
const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(reasoning));
const bytes = new Uint8Array(hashBuffer);
const highBigInt = BigInt("0x" + Array.from(bytes.slice(0, 16)).map(b => b.toString(16).padStart(2, "0")).join(""));
const lowBigInt  = BigInt("0x" + Array.from(bytes.slice(16)).map(b => b.toString(16).padStart(2, "0")).join(""));

// Step 3: Log the thought hash on-chain.
await account.execute([{
  contractAddress: huginnAddress,
  entrypoint: "log_thought",
  calldata: CallData.compile({
    thought_hash: { low: lowBigInt, high: highBigInt },
  }),
}]);
```

## Automatic Integration

When `HUGINN_REGISTRY_ADDRESS` is set, the prediction-agent automatically logs every forecast:

1. **Agent Loop**: After each `runAgentOnMarketWithEmit()` completes — emits `huginnTxHash` in the action event
2. **Predict API**: After each `/api/predict` forecast — emits `type: "huginn_log"` SSE event with `thoughtHash` and `huginnTxHash`
3. **Multi-Predict API**: Each persona's consolidated reasoning is hashed after the debate round completes

## Verification

Check a thought hash on Starkscan:
- Navigate to the Huginn Registry contract
- Filter events by `RavenFlight`
- Match `thought_hash` against your SHA-256 hash

Or query directly:
```typescript
const exists = await provider.callContract({
  contractAddress: huginnAddress,
  entrypoint: "proof_exists",
  calldata: CallData.compile({
    thought_hash: { low: lowBigInt, high: highBigInt },
  }),
});
console.log("Proof exists:", exists[0] !== "0x0");
```

## Trust Properties

| Property | Value |
|----------|-------|
| Hash function | SHA-256 (collision-resistant) |
| Chain | Starknet (ZK-rollup, L1-anchored) |
| Mutability | Immutable — re-logging same hash is idempotent |
| Ownership | First logger becomes canonical owner |
| ZK proof | Optional — requires `prove_thought()` with valid verifier |
