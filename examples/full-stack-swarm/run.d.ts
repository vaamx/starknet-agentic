#!/usr/bin/env npx tsx
/**
 * Full Stack Swarm (Sepolia)
 *
 * - Deploy N SessionAccount contracts (owner keys generated locally).
 * - Mint ERC-8004 identities (gasless via AVNU paymaster).
 * - Register a session key + spending policy on-chain.
 * - Start SISNA as a signer boundary (holds session private keys).
 * - Run AVNU swaps via @starknet-agentic/mcp-server in signer proxy mode.
 * - Prove on-chain denial by attempting an oversized swap.
 *
 * Output:
 * - state.json (contains keys; chmod 0600 best-effort)
 * - stdout JSON report (safe-ish but avoid pasting blindly if it includes addresses/txs you don't want public)
 */
export {};
