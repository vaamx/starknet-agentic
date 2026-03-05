#!/usr/bin/env node

/**
 * Repro harness for adversarial Starkzap execution-surface txs.
 *
 * Usage:
 *   STARKNET_RPC_URL=https://starknet-sepolia.public.blastapi.io \
 *   node scripts/repro/check-sepolia-adversarial-txs.mjs
 */

const txs = [
  {
    name: "transfer_path",
    hash: "0x3038127239416ed2afc3f6bfa2c1c64ab7bbee4e9a525df88828ebcf942232b",
    expectedExecution: "SUCCEEDED",
  },
  {
    name: "session_key_swap_via_proxy",
    hash: "0x55953168086ab15a4f9b04244107b0f8676b6f2e2b42cf2efe328ac2eb6ab69",
    expectedExecution: "SUCCEEDED",
  },
  {
    name: "oversized_spend_revert",
    hash: "0x3900f732b2e9061350be30707ca7bcf48d16b346041c85ebbff3b90772a3609",
    expectedExecution: "REVERTED",
  },
];

const rpcUrl = process.env.STARKNET_RPC_URL;

if (!rpcUrl) {
  console.error("Missing STARKNET_RPC_URL");
  process.exit(1);
}

async function rpc(method, params) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params,
    }),
  });

  if (!res.ok) {
    throw new Error(`RPC HTTP ${res.status}`);
  }

  const payload = await res.json();
  if (payload.error) {
    throw new Error(`${payload.error.code}: ${payload.error.message}`);
  }
  return payload.result;
}

function normalizeExecutionStatus(receipt) {
  return (
    receipt?.execution_status ||
    receipt?.executionStatus ||
    "UNKNOWN"
  );
}

function normalizeFinalityStatus(receipt) {
  return (
    receipt?.finality_status ||
    receipt?.finalityStatus ||
    "UNKNOWN"
  );
}

async function main() {
  const rows = [];
  let failures = 0;

  for (const tx of txs) {
    try {
      const receipt = await rpc("starknet_getTransactionReceipt", {
        transaction_hash: tx.hash,
      });

      const execution = normalizeExecutionStatus(receipt);
      const finality = normalizeFinalityStatus(receipt);
      const pass = execution === tx.expectedExecution;
      if (!pass) failures += 1;

      rows.push({
        name: tx.name,
        hash: tx.hash,
        expected: tx.expectedExecution,
        execution,
        finality,
        pass,
      });
    } catch (err) {
      failures += 1;
      rows.push({
        name: tx.name,
        hash: tx.hash,
        expected: tx.expectedExecution,
        execution: "ERROR",
        finality: "ERROR",
        pass: false,
        error: String(err),
      });
    }
  }

  console.log(JSON.stringify({ rpcUrl, checkedAt: new Date().toISOString(), rows }, null, 2));

  if (failures > 0) {
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

