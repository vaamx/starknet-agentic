#!/usr/bin/env tsx
/**
 * Set/Update Agent Metadata on ERC-8004 Identity Registry
 *
 * Usage: npx tsx scripts/set-metadata.ts <AGENT_ID> <KEY> <VALUE>
 * Requires .env with STARKNET_RPC_URL, AGENT_PRIVATE_KEY, AGENT_ADDRESS, IDENTITY_REGISTRY_ADDRESS
 *
 * Special: Use key "caps" with a JSON array value to set Agent Passport capabilities.
 * Example: npx tsx scripts/set-metadata.ts 1 caps '["swap","stake","lend"]'
 */
import 'dotenv/config';
