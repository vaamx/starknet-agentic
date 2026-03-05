#!/usr/bin/env node
/**
 * Starknet MCP Server
 *
 * Exposes Starknet operations as MCP tools for AI agents.
 * Works with any MCP-compatible client: Claude, ChatGPT, Cursor, OpenClaw.
 *
 * Tools:
 * - starknet_get_balance: Check single token balance
 * - starknet_get_balances: Check multiple token balances (batch, single RPC call)
 * - starknet_transfer: Send tokens
 * - starknet_call_contract: Read contract state
 * - starknet_invoke_contract: Write to contracts
 * - starknet_swap: Execute swaps via avnu
 * - starknet_get_quote: Get swap quotes
 * - starknet_build_calls: Build unsigned calls for external signing (Controller, multisig)
 * - starknet_register_session_key: Register session key on SessionAccount
 * - starknet_revoke_session_key: Revoke a session key
 * - starknet_get_session_data: Read session key data (remaining calls, expiry, etc.)
 * - starknet_build_transfer_calls: Build unsigned ERC-20 transfer calls
 * - starknet_build_swap_calls: Build unsigned AVNU swap calls (approval + route)
 * - starknet_register_agent: Register agent identity (ERC-8004)
 * - starknet_set_agent_metadata: Set on-chain metadata for an ERC-8004 agent
 * - starknet_get_agent_metadata: Read on-chain metadata for an ERC-8004 agent
 *
 * Usage:
 *   STARKNET_RPC_URL=... STARKNET_ACCOUNT_ADDRESS=... STARKNET_PRIVATE_KEY=... node dist/index.js
 *   STARKNET_RPC_URL=... STARKNET_ACCOUNT_ADDRESS=... STARKNET_SIGNER_MODE=proxy KEYRING_PROXY_URL=... KEYRING_HMAC_SECRET=... node dist/index.js
 */
export {};
