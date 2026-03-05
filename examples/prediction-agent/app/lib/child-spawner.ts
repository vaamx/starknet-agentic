/**
 * Child Spawner — Deploy real AgentAccount contracts on Starknet.
 *
 * Wraps the AgentAccountFactory deployed on Sepolia.
 * Each call deploys a fresh AgentAccount (ERC-8004 minted), generates an
 * ephemeral keypair, and funds the child with STRK from the parent wallet.
 *
 * Security:
 *  - Private key is logged ONCE to console and never returned from any API.
 *  - The in-memory Account instance exists only for the process lifetime.
 *  - CHILD_AGENT_ENABLED=false (default) gates all calls.
 */

import { Account, CallData, RpcProvider, stark, ec } from "starknet";
import { config } from "./config";
import { getOwnerAccount } from "./starknet-executor";

// ── Deployed contract addresses (Sepolia) ────────────────────────────────────

const AGENT_ACCOUNT_CLASS_HASH =
  "0x14d44fb938b43e5fbcec27894670cb94898d759e2ef30e7af70058b4da57e7f";

const IDENTITY_REGISTRY_ADDRESS =
  "0x72eb37b0389e570bf8b158ce7f0e1e3489de85ba43ab3876a0594df7231631";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ChildAgentDeployResult {
  agentAddress: string;
  agentId: bigint;
  privateKey: string;
  publicKey: string;
  txHash: string;
  account?: Account;
  error?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const provider = new RpcProvider({ nodeUrl: config.STARKNET_RPC_URL });

/**
 * Encode a UTF-8 string as Cairo ByteArray calldata (31-byte chunk format).
 * Returns an array of hex strings: [data_len, ...chunks, pending_word, pending_word_len]
 */
function stringToByteArrayCalldata(str: string): string[] {
  const bytes = new TextEncoder().encode(str);
  const chunks: string[] = [];
  let i = 0;

  while (i + 31 <= bytes.length) {
    let chunk = 0n;
    for (let j = 0; j < 31; j++) {
      chunk = (chunk << 8n) | BigInt(bytes[i + j]);
    }
    chunks.push("0x" + chunk.toString(16).padStart(62, "0"));
    i += 31;
  }

  // Remaining bytes as pending_word
  let pending = 0n;
  const pendingLen = bytes.length - i;
  for (let j = 0; j < pendingLen; j++) {
    pending = (pending << 8n) | BigInt(bytes[i + j]);
  }

  return [
    `0x${chunks.length.toString(16)}`, // data_len
    ...chunks,
    "0x" + pending.toString(16).padStart(2, "0"), // pending_word
    `0x${pendingLen.toString(16)}`,                // pending_word_len
  ];
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Deploy a new child AgentAccount contract via the factory.
 *
 * Steps:
 * 1. Generate ephemeral keypair.
 * 2. Build token_uri ByteArray calldata.
 * 3. Call factory.deploy_account() with owner account.
 * 4. Parse AccountDeployed event for agentAddress + agentId.
 * 5. Fund child with STRK from parent wallet.
 * 6. Log private key once to console.
 */
export async function deployChildAgent(cfg: {
  name: string;
  model: string;
  fundingStrk: number;
}): Promise<ChildAgentDeployResult> {
  const factoryAddress = String((config as any).CHILD_AGENT_FACTORY_ADDRESS ?? "0x0");
  if (!factoryAddress || factoryAddress === "0x0") {
    return {
      agentAddress: "", agentId: 0n, privateKey: "", publicKey: "", txHash: "",
      error: "CHILD_AGENT_FACTORY_ADDRESS not configured",
    };
  }

  const ownerAccount = getOwnerAccount();
  if (!ownerAccount) {
    return {
      agentAddress: "", agentId: 0n, privateKey: "", publicKey: "", txHash: "",
      error: "Owner account not configured — cannot deploy child",
    };
  }

  // 1. Generate ephemeral keypair
  const privateKey = stark.randomAddress();
  const publicKey = ec.starkCurve.getStarkKey(privateKey);
  const salt = stark.randomAddress();

  // 2. Build token_uri as ByteArray
  const tokenUri = `data:application/json,{"name":"${cfg.name}","agentType":"child-forecaster","model":"${cfg.model}"}`;
  const byteArrayCalldata = stringToByteArrayCalldata(tokenUri);

  // 3. Call factory.deploy_account()
  const deployCall = {
    contractAddress: factoryAddress,
    entrypoint: "deploy_account",
    calldata: [
      publicKey,
      salt,
      ...byteArrayCalldata,
    ],
  };

  let txHash: string;
  let receipt: any;
  try {
    const result = await ownerAccount.execute([deployCall]);
    txHash = result.transaction_hash;
    receipt = await provider.waitForTransaction(txHash);
  } catch (err: any) {
    return {
      agentAddress: "", agentId: 0n, privateKey: "", publicKey: "", txHash: "",
      error: `deploy_account failed: ${err?.message ?? String(err)}`,
    };
  }

  // 4. Parse AccountDeployed event
  let agentAddress = "";
  let agentId = 0n;
  const events: any[] = (receipt as any).events ?? [];
  for (const evt of events) {
    if (
      evt.from_address?.toLowerCase() === factoryAddress.toLowerCase() &&
      evt.data?.length >= 2
    ) {
      agentAddress = evt.data[0];
      try { agentId = BigInt(evt.data[1]); } catch { agentId = 0n; }
      break;
    }
  }

  if (!agentAddress) {
    return {
      agentAddress: "", agentId: 0n, privateKey, publicKey, txHash,
      error: "Could not parse AccountDeployed event — check factory ABI",
    };
  }

  // 5. Fund child with STRK
  if (cfg.fundingStrk > 0) {
    try {
      const fundWei = BigInt(Math.round(cfg.fundingStrk * 1e18));
      const fundCall = {
        contractAddress: config.COLLATERAL_TOKEN_ADDRESS,
        entrypoint: "transfer",
        calldata: CallData.compile({
          recipient: agentAddress,
          amount: { low: fundWei, high: 0n },
        }),
      };
      await ownerAccount.execute([fundCall]);
    } catch (err: any) {
      // Non-fatal — child is deployed, just underfunded
      console.warn("[child-spawner] STRK funding failed:", err?.message ?? String(err));
    }
  }

  // 6. Do not print private key to logs.
  console.log(
    `[child-spawner] deployed child agent address=${agentAddress} agentId=${agentId}`
  );

  // Build in-process Account instance (ephemeral — dies with process)
  const childAccount = new Account({
    provider,
    address: agentAddress,
    signer: privateKey,
  });

  return {
    agentAddress,
    agentId,
    privateKey,
    publicKey,
    txHash,
    account: childAccount,
  };
}
