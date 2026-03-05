#!/usr/bin/env tsx
/**
 * Register Agent on ERC-8004 Identity Registry
 *
 * Usage: npx tsx scripts/register-agent.ts "MyAgent" "defi" "1.0"
 * Requires .env with STARKNET_RPC_URL, AGENT_PRIVATE_KEY, AGENT_ADDRESS, IDENTITY_REGISTRY_ADDRESS
 */
import 'dotenv/config';
