#!/usr/bin/env tsx
/**
 * Check Multiple Token Balances (Batch)
 *
 * Tests the batch balance fetching logic from starknet-mcp-server.
 * Uses BalanceChecker contract with fallback to batch RPC.
 *
 * Usage: tsx check-balances.ts
 * Requires .env with STARKNET_RPC_URL and STARKNET_ACCOUNT_ADDRESS
 * Optional: STARKNET_RPC_SPEC_VERSION=0.9.0|0.10.0
 */
import 'dotenv/config';
