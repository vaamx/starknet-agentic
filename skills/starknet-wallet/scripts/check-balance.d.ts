#!/usr/bin/env tsx
/**
 * Check Token Balance
 *
 * Usage: tsx check-balance.ts
 * Requires .env with STARKNET_RPC_URL and STARKNET_ACCOUNT_ADDRESS
 * Optional: STARKNET_RPC_SPEC_VERSION=0.9.0|0.10.0
 * Optional: TOKEN=ETH|STRK|USDC|USDT or TOKEN_ADDRESS=0x...
 */
import 'dotenv/config';
