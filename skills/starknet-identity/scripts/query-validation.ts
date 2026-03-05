#!/usr/bin/env tsx
/**
 * Query ERC-8004 validation status for an agent.
 *
 * Usage:
 *   npx tsx scripts/query-validation.ts <AGENT_ID>
 *   npx tsx scripts/query-validation.ts <AGENT_ID> <REQUEST_HASH>
 *
 * Requires .env with STARKNET_RPC_URL and VALIDATION_REGISTRY_ADDRESS.
 */

import 'dotenv/config';
import {
  formatError,
  getContract,
  getProvider,
  parseAgentId,
  requiredEnv,
  shortAddress,
  toBigIntSafe,
} from './_shared.js';

const VALIDATION_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'get_summary',
    inputs: [
      { name: 'agent_id', type: 'core::integer::u256' },
      { name: 'validator_addresses', type: 'core::array::Span::<core::starknet::contract_address::ContractAddress>' },
      { name: 'tag', type: 'core::byte_array::ByteArray' },
    ],
    outputs: [
      { type: 'core::integer::u64' },
      { type: 'core::integer::u8' },
    ],
    state_mutability: 'view',
  },
  {
    type: 'function',
    name: 'get_agent_validations',
    inputs: [{ name: 'agent_id', type: 'core::integer::u256' }],
    outputs: [{ type: 'core::array::Array::<core::integer::u256>' }],
    state_mutability: 'view',
  },
  {
    type: 'function',
    name: 'get_validation_status',
    inputs: [{ name: 'request_hash', type: 'core::integer::u256' }],
    outputs: [
      { type: 'core::starknet::contract_address::ContractAddress' },
      { type: 'core::integer::u256' },
      { type: 'core::integer::u8' },
      { type: 'core::integer::u256' },
      { type: 'core::byte_array::ByteArray' },
      { type: 'core::integer::u64' },
    ],
    state_mutability: 'view',
  },
];

function normalizeU256Input(value: string): bigint {
  if (!/^(0x[0-9a-fA-F]+|\d+)$/.test(value)) {
    throw new Error(`Invalid request hash "${value}". Use decimal or hex.`);
  }
  return BigInt(value);
}

async function main() {
  const agentIdArg = process.argv[2];
  const requestHashArg = process.argv[3];

  if (!agentIdArg) {
    console.error('Usage: npx tsx scripts/query-validation.ts <AGENT_ID> [REQUEST_HASH]');
    process.exit(1);
  }

  const provider = getProvider();
  const validationRegistryAddress = requiredEnv('VALIDATION_REGISTRY_ADDRESS');
  const contract = getContract(VALIDATION_REGISTRY_ABI, validationRegistryAddress, provider);

  const agentId = parseAgentId(agentIdArg);
  console.log(`\nQuerying validation data for agent #${agentId}`);
  console.log(`Registry: ${shortAddress(validationRegistryAddress)}`);

  const [count, avgScore] = await contract.get_summary(agentId, [], '');
  console.log(`\nSummary`);
  console.log(`  Validation count: ${toBigIntSafe(count)}`);
  console.log(`  Avg score:        ${toBigIntSafe(avgScore)}`);

  const requestHashesResult = await contract.get_agent_validations(agentId);
  const requestHashes = Array.isArray(requestHashesResult)
    ? requestHashesResult.map((value) => toBigIntSafe(value))
    : [];
  console.log(`  Request hashes:   ${requestHashes.length}`);

  const selectedHash = requestHashArg
    ? normalizeU256Input(requestHashArg)
    : requestHashes[0];

  if (!selectedHash) {
    console.log('\nNo validation requests found for this agent.');
    return;
  }

  const [validator, statusAgentId, response, responseHash, tag, lastUpdate] =
    await contract.get_validation_status(selectedHash);

  console.log(`\nRequest Status`);
  console.log(`  Request hash: ${selectedHash}`);
  console.log(`  Validator:    ${shortAddress(String(validator), 8)}`);
  console.log(`  Agent ID:     ${toBigIntSafe(statusAgentId)}`);
  console.log(`  Response:     ${toBigIntSafe(response)} / 100`);
  console.log(`  Response hash:${toBigIntSafe(responseHash)}`);
  console.log(`  Tag:          ${String(tag)}`);
  console.log(`  Last update:  ${toBigIntSafe(lastUpdate)}`);
}

main().catch((error) => {
  console.error(`Error: ${formatError(error)}`);
  process.exit(1);
});
