#!/usr/bin/env tsx
/**
 * Query Agent Reputation from ERC-8004 Reputation Registry
 *
 * Usage: npx tsx scripts/query-reputation.ts <AGENT_ID>
 * Requires .env with STARKNET_RPC_URL and REPUTATION_REGISTRY_ADDRESS
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

const REPUTATION_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'get_clients',
    inputs: [{ name: 'agent_id', type: 'core::integer::u256' }],
    outputs: [{ type: 'core::array::Array::<core::starknet::contract_address::ContractAddress>' }],
    state_mutability: 'view',
  },
  {
    type: 'function',
    name: 'get_summary',
    inputs: [
      { name: 'agent_id', type: 'core::integer::u256' },
      { name: 'client_addresses', type: 'core::array::Span::<core::starknet::contract_address::ContractAddress>' },
      { name: 'tag1', type: 'core::byte_array::ByteArray' },
      { name: 'tag2', type: 'core::byte_array::ByteArray' },
    ],
    outputs: [
      { type: 'core::integer::u64' },
      { type: 'core::integer::i128' },
      { type: 'core::integer::u8' },
    ],
    state_mutability: 'view',
  },
  {
    type: 'function',
    name: 'get_last_index',
    inputs: [
      { name: 'agent_id', type: 'core::integer::u256' },
      { name: 'client_address', type: 'core::starknet::contract_address::ContractAddress' },
    ],
    outputs: [{ type: 'core::integer::u64' }],
    state_mutability: 'view',
  },
];

async function main() {
  const agentIdStr = process.argv[2];
  if (!agentIdStr) {
    console.error('Usage: npx tsx scripts/query-reputation.ts <AGENT_ID>');
    console.error('Example: npx tsx scripts/query-reputation.ts 1');
    process.exit(1);
  }

  const provider = getProvider();
  const reputationAddress = requiredEnv('REPUTATION_REGISTRY_ADDRESS');
  const contract = getContract(REPUTATION_REGISTRY_ABI, reputationAddress, provider);
  const agentId = parseAgentId(agentIdStr);

  console.log(`\nQuerying reputation for agent #${agentId}...`);
  console.log(`Registry: ${shortAddress(reputationAddress)}`);

  try {
    // Get all clients who have given feedback
    const clientsResult = await contract.get_clients(agentId);
    const clients = Array.isArray(clientsResult) ? clientsResult.map((v) => String(v)) : [];
    const clientCount = Array.isArray(clients) ? clients.length : 0;
    console.log(`\n  Unique clients: ${clientCount}`);

    if (clientCount > 0) {
      // Get aggregated summary across all clients (empty tags = no filter)
      const [count, summaryValue, valueDecimals] = await contract.get_summary(
        agentId,
        clients,
        '',
        '',
      );
      const summaryBig = toBigIntSafe(summaryValue);
      const decimals = Number(toBigIntSafe(valueDecimals));
      const divisor = decimals > 0 ? 10 ** decimals : 1;
      const avgScore = Number(summaryBig) / divisor;

      console.log(`  Total feedback entries: ${toBigIntSafe(count)}`);
      console.log(`  Aggregate score: ${avgScore} (raw: ${summaryBig}, decimals: ${decimals})`);

      // Show per-client breakdown
      console.log(`\n  Per-client breakdown:`);
      for (const client of clients) {
        const lastIdx = await contract.get_last_index(agentId, client);
        console.log(`    ${shortAddress(String(client), 8)}: ${toBigIntSafe(lastIdx)} feedback entries`);
      }
    } else {
      console.log('  No feedback received yet.');
    }
  } catch (error) {
    console.error(`\n  Error querying reputation: ${formatError(error)}`);
  }
}

main().catch((error) => {
  console.error(`Error: ${formatError(error)}`);
  process.exit(1);
});
