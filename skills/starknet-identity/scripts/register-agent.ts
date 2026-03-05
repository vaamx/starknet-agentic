#!/usr/bin/env tsx
/**
 * Register Agent on ERC-8004 Identity Registry
 *
 * Usage: npx tsx scripts/register-agent.ts "MyAgent" "defi" "1.0.0" [TOKEN_URI] [CAPS_JSON]
 * Requires .env with STARKNET_RPC_URL, AGENT_PRIVATE_KEY/STARKNET_PRIVATE_KEY,
 * AGENT_ADDRESS/STARKNET_ACCOUNT_ADDRESS, and IDENTITY_REGISTRY_ADDRESS
 */

import 'dotenv/config';
import { CallData, byteArray } from 'starknet';
import {
  formatError,
  getAccount,
  getProvider,
  parseRegisteredAgentIdFromReceipt,
  requiredEnv,
  txHashOf,
} from './_shared.js';

const PASSPORT_SCHEMA_ID = 'https://starknet-agentic.dev/schemas/agent-passport.schema.json';

// MetadataEntry is a struct { key: ByteArray, value: ByteArray }
const IDENTITY_REGISTRY_ABI = [
  {
    type: 'struct',
    name: 'core::byte_array::ByteArray',
    members: [
      { name: 'data', type: 'core::array::Array::<core::bytes_31::bytes31>' },
      { name: 'pending_word', type: 'core::felt252' },
      { name: 'pending_word_len', type: 'core::integer::u32' },
    ],
  },
  {
    type: 'struct',
    name: 'erc8004_cairo::interfaces::identity_registry::MetadataEntry',
    members: [
      { name: 'key', type: 'core::byte_array::ByteArray' },
      { name: 'value', type: 'core::byte_array::ByteArray' },
    ],
  },
  {
    type: 'function',
    name: 'register_with_metadata',
    inputs: [
      { name: 'token_uri', type: 'core::byte_array::ByteArray' },
      { name: 'metadata', type: 'core::array::Array::<erc8004_cairo::interfaces::identity_registry::MetadataEntry>' },
    ],
    outputs: [{ type: 'core::integer::u256' }],
    state_mutability: 'external',
  },
  {
    type: 'function',
    name: 'total_agents',
    inputs: [],
    outputs: [{ type: 'core::integer::u256' }],
    state_mutability: 'view',
  },
];

async function main() {
  const [name, agentType, version, tokenUriArg, capsJson] = process.argv.slice(2);
  if (!name) {
    console.error('Usage: npx tsx scripts/register-agent.ts <NAME> [TYPE] [VERSION] [TOKEN_URI] [CAPS_JSON]');
    console.error('Example: npx tsx scripts/register-agent.ts "MyTradingAgent" "prediction" "1.0.0" "ipfs://Qm..." \'["forecast","analyze"]\'');
    process.exit(1);
  }

  const provider = getProvider();
  const account = getAccount(provider);
  const registryAddress = requiredEnv('IDENTITY_REGISTRY_ADDRESS');
  const tokenUri = tokenUriArg || `agent://${name}`;
  let capsValue: string | undefined;

  if (capsJson) {
    try {
      const parsed = JSON.parse(capsJson);
      if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
        throw new Error('caps must be a JSON array of strings');
      }
      capsValue = JSON.stringify([...new Set(parsed.map((item: string) => item.trim()).filter(Boolean))]);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid CAPS_JSON: ${reason}`);
    }
  }

  // Build metadata as Array<MetadataEntry> — each entry is a struct { key, value }
  const metadata = [
    { key: 'agentName', value: name },
    { key: 'agentType', value: agentType || 'general' },
    { key: 'version', value: version || '1.0.0' },
    { key: 'status', value: 'active' },
    ...(capsValue
      ? [
          { key: 'caps', value: capsValue },
          { key: 'passport:schema', value: PASSPORT_SCHEMA_ID },
        ]
      : []),
  ];

  console.log(`\nRegistering agent "${name}" on ERC-8004...`);
  console.log(`  Type: ${agentType || 'general'}`);
  console.log(`  Version: ${version || '1.0.0'}`);
  console.log(`  Token URI: ${tokenUri}`);
  console.log(`  Registry: ${registryAddress}`);
  console.log(`  Owner: ${account.address}`);
  if (capsValue) {
    console.log(`  Passport caps: ${capsValue}`);
  }

  const result = await account.execute({
    contractAddress: registryAddress,
    entrypoint: 'register_with_metadata',
    calldata: CallData.compile({
      token_uri: byteArray.byteArrayFromString(tokenUri),
      metadata: metadata.map(m => ({
        key: byteArray.byteArrayFromString(m.key),
        value: byteArray.byteArrayFromString(m.value),
      })),
    }),
  });
  const transactionHash = txHashOf(result);

  console.log(`\n  Transaction: ${transactionHash}`);
  console.log('  Waiting for confirmation...');

  const receipt = await provider.waitForTransaction(transactionHash);
  const agentId = parseRegisteredAgentIdFromReceipt(receipt, registryAddress);
  console.log(`  Status: ${(receipt as { statusReceipt?: string }).statusReceipt ?? 'ACCEPTED'}`);
  if (agentId) {
    console.log(`  Agent ID: ${agentId}`);
  }
  console.log('\nAgent registration completed.');
}

main().catch((error) => {
  console.error(`Error: ${formatError(error)}`);
  process.exit(1);
});
