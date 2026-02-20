import { Account, RpcProvider, CallData, shortString } from "starknet";
import { config } from "./config";
import { toScaled } from "./accuracy";
import { SessionKeySigner } from "./session-key-signer";
import { hasSessionKeyConfigured } from "./session-policy";

const provider = new RpcProvider({
  nodeUrl: config.STARKNET_RPC_URL,
});

/** Execute calls as a V3 transaction (starknet.js v8 handles triple gas natively). */
async function executeV3(account: Account, calls: any[]): Promise<any> {
  return account.execute(calls);
}

type SignerMode = "owner" | "session";

function resolveSignerMode(): SignerMode {
  if (config.AGENT_SIGNER === "owner") return "owner";
  if (config.AGENT_SIGNER === "session") return "session";
  return hasSessionKeyConfigured() ? "session" : "owner";
}

function getSessionSigner(): SessionKeySigner | null {
  if (!config.AGENT_SESSION_PRIVATE_KEY || !config.AGENT_SESSION_PUBLIC_KEY) return null;
  return new SessionKeySigner(
    config.AGENT_SESSION_PRIVATE_KEY,
    config.AGENT_SESSION_PUBLIC_KEY
  );
}

/** Get an account instance for transaction signing. */
function getAccount(mode?: SignerMode): Account | null {
  if (!config.AGENT_ADDRESS) return null;
  const signerMode = mode ?? resolveSignerMode();

  if (signerMode === "session") {
    const signer = getSessionSigner();
    if (!signer) return null;
    return new Account({
      provider,
      address: config.AGENT_ADDRESS,
      signer,
    });
  }

  if (!config.AGENT_PRIVATE_KEY) return null;
  return new Account({
    provider,
    address: config.AGENT_ADDRESS,
    signer: config.AGENT_PRIVATE_KEY,
  });
}

function usingSessionSigner(): boolean {
  return resolveSignerMode() === "session";
}

function normalizeAddress(value: string): string {
  return value.toLowerCase();
}

function parseAllowlistedContracts(): string[] {
  if (!config.AGENT_ALLOWED_CONTRACTS) return [];
  return config.AGENT_ALLOWED_CONTRACTS.split(",")
    .map((addr) => addr.trim())
    .filter((addr) => addr.length > 0);
}

function ensureCallsAllowlisted(calls: { contractAddress: string }[]) {
  const allowlist = parseAllowlistedContracts();
  if (allowlist.length === 0) return;
  const allowed = new Set(allowlist.map(normalizeAddress));
  for (const call of calls) {
    const target = normalizeAddress(call.contractAddress);
    if (!allowed.has(target)) {
      throw new Error(`Call blocked by allowlist: ${call.contractAddress}`);
    }
  }
}

function buildAllowanceCall(
  tokenAddress: string,
  spender: string,
  amount: bigint,
  entrypointOverride?: string
) {
  const entrypoint = entrypointOverride
    ?? (usingSessionSigner()
      ? (config.AGENT_ALLOWANCE_SELECTOR || "increase_allowance")
      : "approve");

  const calldata =
    entrypoint === "increaseAllowance"
      ? CallData.compile({
          spender,
          addedValue: { low: amount, high: 0n },
        })
      : entrypoint === "increase_allowance"
        ? CallData.compile({
            spender,
            added_value: { low: amount, high: 0n },
          })
        : CallData.compile({
            spender,
            amount: { low: amount, high: 0n },
          });

  return {
    contractAddress: tokenAddress,
    entrypoint,
    calldata,
  };
}

export interface TxResult {
  txHash: string;
  status: "success" | "error";
  error?: string;
}

export interface CreateMarketResult extends TxResult {
  marketId?: number;
  marketAddress?: string;
  allowlistTxHash?: string;
  allowlistError?: string;
}

/** Place a bet on a prediction market. */
export async function placeBet(
  marketAddress: string,
  outcome: 0 | 1,
  amount: bigint,
  collateralToken: string
): Promise<TxResult> {
  const account = getAccount();
  if (!account) {
    return { txHash: "", status: "error", error: "No agent account configured" };
  }

  try {
    const approveTx = buildAllowanceCall(collateralToken, marketAddress, amount);

    const betTx = {
      contractAddress: marketAddress,
      entrypoint: "bet",
      calldata: CallData.compile({
        outcome,
        amount: { low: amount, high: 0n },
      }),
    };

    let result;
    ensureCallsAllowlisted([approveTx, betTx]);
    try {
      result = await executeV3(account, [approveTx, betTx]);
      await provider.waitForTransaction(result.transaction_hash);
    } catch (err) {
      // If session signer used snake_case allowance but token expects camelCase, retry once.
      if (usingSessionSigner() && approveTx.entrypoint === "increase_allowance") {
        const retryApprove = buildAllowanceCall(collateralToken, marketAddress, amount, "increaseAllowance");
        result = await executeV3(account, [retryApprove, betTx]);
        await provider.waitForTransaction(result.transaction_hash);
      } else {
        throw err;
      }
    }

    return { txHash: result.transaction_hash, status: "success" };
  } catch (err: any) {
    return { txHash: "", status: "error", error: err.message };
  }
}

/** Record an agent prediction on the accuracy tracker. */
export async function recordPrediction(
  marketId: number,
  probability: number
): Promise<TxResult> {
  const account = getAccount();
  if (!account) {
    return { txHash: "", status: "error", error: "No agent account configured" };
  }

  const trackerAddress = config.ACCURACY_TRACKER_ADDRESS;
  if (trackerAddress === "0x0") {
    return { txHash: "", status: "error", error: "Accuracy tracker not deployed" };
  }

  try {
    const scaledProb = toScaled(probability);

    const tx = {
      contractAddress: trackerAddress,
      entrypoint: "record_prediction",
      calldata: CallData.compile({
        market_id: { low: BigInt(marketId), high: 0n },
        predicted_prob: { low: scaledProb, high: 0n },
      }),
    };

    ensureCallsAllowlisted([tx]);
    const result = await executeV3(account, [tx]);
    await provider.waitForTransaction(result.transaction_hash);

    return { txHash: result.transaction_hash, status: "success" };
  } catch (err: any) {
    return { txHash: "", status: "error", error: err.message };
  }
}

/** Create a new prediction market via the factory (agent-only). */
export async function createMarket(
  question: string,
  durationDays = 30,
  feeBps = 200,
  oracleAddress?: string
): Promise<CreateMarketResult> {
  const account = getAccount();
  if (!account) {
    return { txHash: "", status: "error", error: "No agent account configured" };
  }

  if (config.MARKET_FACTORY_ADDRESS === "0x0") {
    return { txHash: "", status: "error", error: "Market factory not deployed" };
  }

  const oracle = oracleAddress ?? config.AGENT_ADDRESS;
  if (!oracle) {
    return { txHash: "", status: "error", error: "Oracle address missing" };
  }

  const trimmed = question.slice(0, 31).replace(/[^\x20-\x7E]/g, "");
  const questionHash = shortString.encodeShortString(trimmed || "market");
  const resolutionTime =
    Math.floor(Date.now() / 1000) + Math.max(1, durationDays) * 86_400;

  try {
    const tx = {
      contractAddress: config.MARKET_FACTORY_ADDRESS,
      entrypoint: "create_market",
      calldata: CallData.compile([
        BigInt(questionHash),
        BigInt(resolutionTime),
        BigInt(oracle),
        BigInt(config.COLLATERAL_TOKEN_ADDRESS),
        BigInt(feeBps),
      ]),
    };

    ensureCallsAllowlisted([tx]);
    const result = await executeV3(account, [tx]);
    const receipt = await provider.waitForTransaction(result.transaction_hash);

    let marketId: number | undefined;
    let marketAddress: string | undefined;
    const events = (receipt as any).events ?? [];
    for (const evt of events) {
      if (
        evt.from_address === config.MARKET_FACTORY_ADDRESS &&
        evt.keys?.length >= 2 &&
        evt.data?.length >= 1
      ) {
        marketId = Number(BigInt(evt.keys[1]));
        marketAddress = evt.data?.[0];
        break;
      }
    }

    let allowlistTxHash: string | undefined;
    let allowlistError: string | undefined;
    if (
      config.AGENT_ALLOWLIST_AUTO_ADD === "true" &&
      marketAddress &&
      marketAddress !== "0x0"
    ) {
      const allowResult = await addAllowedContract(marketAddress);
      if (allowResult.status === "success") {
        allowlistTxHash = allowResult.txHash;
      } else {
        allowlistError = allowResult.error;
      }
    }

    return {
      txHash: result.transaction_hash,
      status: "success",
      marketId,
      marketAddress,
      allowlistTxHash,
      allowlistError,
    };
  } catch (err: any) {
    return { txHash: "", status: "error", error: err.message };
  }
}

/** Check if the agent has an account configured. */
export function isAgentConfigured(): boolean {
  if (!config.AGENT_ADDRESS) return false;
  if (resolveSignerMode() === "session") {
    return hasSessionKeyConfigured();
  }
  return !!config.AGENT_PRIVATE_KEY;
}

/** Get the agent's address. */
export function getAgentAddress(): string | null {
  return config.AGENT_ADDRESS ?? null;
}

/** Get the active signer mode. */
export function getSignerMode(): SignerMode {
  return resolveSignerMode();
}

/** Get an owner-signer account (for session key management). */
export function getOwnerAccount(): Account | null {
  return getAccount("owner");
}

/** Get an account using the active signer (owner or session). */
export function getActiveAccount(): Account | null {
  return getAccount();
}

/** Owner-only: add a contract to the on-chain session allowlist. */
export async function addAllowedContract(contract: string): Promise<TxResult> {
  const account = getOwnerAccount();
  if (!account) {
    return { txHash: "", status: "error", error: "Owner signer not configured" };
  }
  if (!config.AGENT_ADDRESS) {
    return { txHash: "", status: "error", error: "Agent address missing" };
  }

  try {
    const tx = {
      contractAddress: config.AGENT_ADDRESS,
      entrypoint: "add_allowed_contract",
      calldata: CallData.compile({ contract }),
    };
    const result = await executeV3(account, [tx]);
    await provider.waitForTransaction(result.transaction_hash);
    return { txHash: result.transaction_hash, status: "success" };
  } catch (err: any) {
    return { txHash: "", status: "error", error: err.message };
  }
}

/** Get the off-chain allowlisted contract addresses (if configured). */
export function getAllowlistedContracts(): string[] {
  return parseAllowlistedContracts();
}

/** Enforce off-chain allowlist for a batch of calls. */
export function enforceAllowlist(calls: { contractAddress: string }[]) {
  ensureCallsAllowlisted(calls);
}
