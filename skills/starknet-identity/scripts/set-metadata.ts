#!/usr/bin/env tsx
/**
 * Set/Update Agent Metadata on ERC-8004 Identity Registry
 *
 * Usage: npx tsx scripts/set-metadata.ts <AGENT_ID> <KEY> <VALUE>
 * Requires .env with STARKNET_RPC_URL, AGENT_PRIVATE_KEY/STARKNET_PRIVATE_KEY,
 * AGENT_ADDRESS/STARKNET_ACCOUNT_ADDRESS, and IDENTITY_REGISTRY_ADDRESS
 *
 * Agent Passport examples:
 *   npx tsx scripts/set-metadata.ts 1 caps '["swap","stake","lend"]'
 *   npx tsx scripts/set-metadata.ts 1 capability:swap '{"name":"swap","category":"defi","mcpTool":"starknet_swap"}'
 */

import 'dotenv/config';
import { CallData, byteArray } from 'starknet';
import {
  formatError,
  getAccount,
  getProvider,
  parseAgentId,
  requiredEnv,
  shortAddress,
  txHashOf,
} from './_shared.js';

const RESERVED_KEYS = new Set(['agentWallet']);
const CAPABILITY_CATEGORIES = new Set(['defi', 'trading', 'identity', 'messaging', 'payments', 'prediction']);
const CAPABILITY_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

async function main() {
  const [agentIdStr, key, value] = process.argv.slice(2);
  if (!agentIdStr || !key || !value) {
    console.error('Usage: npx tsx scripts/set-metadata.ts <AGENT_ID> <KEY> <VALUE>');
    console.error('');
    console.error('Examples:');
    console.error('  npx tsx scripts/set-metadata.ts 1 agentName "MyNewName"');
    console.error('  npx tsx scripts/set-metadata.ts 1 status "paused"');
    console.error('  npx tsx scripts/set-metadata.ts 1 caps \'["swap","stake","lend"]\'');
    process.exit(1);
  }

  if (RESERVED_KEYS.has(key)) {
    throw new Error(`"${key}" is reserved and cannot be set through set_metadata.`);
  }

  // Validate caps format if key is "caps"
  if (key === 'caps') {
    try {
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
        console.error('Error: "caps" value must be a JSON array of strings');
        process.exit(1);
      }
    } catch {
      console.error('Error: "caps" value must be valid JSON');
      process.exit(1);
    }
  }

  if (key.startsWith('capability:')) {
    const nameFromKey = key.slice('capability:'.length);
    if (!CAPABILITY_NAME_PATTERN.test(nameFromKey)) {
      console.error('Error: capability key must match "capability:<name>" with ^[a-z][a-z0-9-]*$');
      process.exit(1);
    }

    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('payload must be an object');
      }
      if (parsed.name !== nameFromKey) {
        throw new Error(`payload.name must equal "${nameFromKey}"`);
      }
      if (typeof parsed.category !== 'string' || !CAPABILITY_CATEGORIES.has(parsed.category)) {
        throw new Error(`payload.category must be one of ${Array.from(CAPABILITY_CATEGORIES).join(', ')}`);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`Error: invalid capability payload: ${reason}`);
      process.exit(1);
    }
  }

  const provider = getProvider();
  const account = getAccount(provider);
  const registryAddress = requiredEnv('IDENTITY_REGISTRY_ADDRESS');
  const agentId = parseAgentId(agentIdStr);

  console.log(`\nSetting metadata for agent #${agentId}...`);
  console.log(`  Signer: ${shortAddress(account.address)}`);
  console.log(`  Registry: ${shortAddress(registryAddress)}`);
  console.log(`  Key:   ${key}`);
  console.log(`  Value: ${value}`);

  const result = await account.execute({
    contractAddress: registryAddress,
    entrypoint: 'set_metadata',
    calldata: CallData.compile({
      agent_id: agentId,
      key: byteArray.byteArrayFromString(key),
      value: byteArray.byteArrayFromString(value),
    }),
  });
  const transactionHash = txHashOf(result);

  console.log(`\n  Transaction: ${transactionHash}`);
  console.log('  Waiting for confirmation...');

  const receipt = await provider.waitForTransaction(transactionHash);
  console.log(`  Status: ${(receipt as { statusReceipt?: string }).statusReceipt ?? 'ACCEPTED'}`);
  console.log('\nMetadata updated successfully!');
}

main().catch((error) => {
  console.error(`Error: ${formatError(error)}`);
  process.exit(1);
});
