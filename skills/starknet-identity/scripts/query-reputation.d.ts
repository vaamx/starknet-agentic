#!/usr/bin/env tsx
/**
 * Query Agent Reputation from ERC-8004 Reputation Registry
 *
 * Usage: npx tsx scripts/query-reputation.ts <AGENT_ID>
 * Requires .env with STARKNET_RPC_URL and REPUTATION_REGISTRY_ADDRESS
 */
import 'dotenv/config';
