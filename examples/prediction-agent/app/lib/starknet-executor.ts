import {
  Account,
  RpcProvider,
  CallData,
  shortString,
  Contract,
} from "starknet";
import { config } from "./config";
import { toScaled } from "./accuracy";
import { SessionKeySigner } from "./session-key-signer";
import { hasSessionKeyConfigured } from "./session-policy";

const provider = new RpcProvider({
  nodeUrl: config.STARKNET_RPC_URL,
});

const FACTORY_READ_ABI = [
  {
    name: "get_market_count",
    type: "function",
    inputs: [],
    outputs: [{ type: "core::integer::u256" }],
    state_mutability: "view",
  },
  {
    name: "get_market",
    type: "function",
    inputs: [{ name: "id", type: "core::integer::u256" }],
    outputs: [{ type: "core::starknet::contract_address::ContractAddress" }],
    state_mutability: "view",
  },
] as const;

const providerCache = new Map<string, RpcProvider>();
let preferredRpcUrl = config.STARKNET_RPC_URL;

function normalizeRpcUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function getRpcProvider(nodeUrl: string): RpcProvider {
  const normalized = normalizeRpcUrl(nodeUrl);
  const cached = providerCache.get(normalized);
  if (cached) return cached;
  const created = new RpcProvider({ nodeUrl: normalized });
  providerCache.set(normalized, created);
  return created;
}

function getOrderedRpcUrls(): string[] {
  const urls = Array.from(
    new Set(
      (config.rpcUrls ?? [config.STARKNET_RPC_URL]).map((url) =>
        normalizeRpcUrl(url)
      )
    )
  );

  if (!config.rpcFailoverEnabled || urls.length <= 1) {
    return urls.slice(0, 1);
  }

  const preferred = normalizeRpcUrl(preferredRpcUrl);
  const preferredIdx = urls.indexOf(preferred);
  if (preferredIdx <= 0) return urls;

  return [...urls.slice(preferredIdx), ...urls.slice(0, preferredIdx)];
}

function markRpcHealthy(nodeUrl: string): void {
  preferredRpcUrl = normalizeRpcUrl(nodeUrl);
}

const V1_FALLBACK_ERROR_REGEX =
  /Result::unwrap failed|starknet_estimateFee|resource_bounds|tip statistics|starting block number|double-quoted property name|estimate fee/i;
const RPC_FAILOVER_RETRY_REGEX =
  /starknet_estimateFee|estimate fee|resource_bounds|tip statistics|starting block number|double-quoted property name|timeout|timed out|network|gateway|upstream|ECONN|EAI_AGAIN|socket|429|502|503|504/i;

function shouldFallbackToV1(message: string): boolean {
  return V1_FALLBACK_ERROR_REGEX.test(message);
}

function shouldRetryAcrossRpcProviders(err: unknown): boolean {
  const message =
    typeof err === "string"
      ? err
      : (err as any)?.message ?? String(err ?? "unknown error");
  return RPC_FAILOVER_RETRY_REGEX.test(message);
}

function normalizeTxError(err: unknown): string {
  const raw =
    typeof err === "string"
      ? err
      : (err as any)?.message ?? String(err ?? "unknown error");
  const compact = raw.replace(/\s+/g, " ").trim();

  if (
    /tip statistics|starting block number|double-quoted property name/i.test(
      compact
    )
  ) {
    return (
      "RPC fee estimation returned malformed tip-statistics payload. " +
      "Retry or switch to a different Starknet RPC provider."
    );
  }

  if (/starknet_estimateFee|estimate fee|resource_bounds/i.test(compact)) {
    return (
      "Fee estimation failed for this transaction/account combination. " +
      "Retry on the next tick."
    );
  }

  if (/providedVersion .* is not ETransactionVersion/i.test(compact)) {
    return (
      "RPC rejected a legacy version override. " +
      "Retried using V3 static-tip execution."
    );
  }

  return compact.slice(0, 360) || "unknown error";
}

const STATIC_RESOURCE_BOUNDS = {
  l1_gas: { max_amount: 100_000n, max_price_per_unit: 1_000_000_000n },
  l2_gas: { max_amount: 100_000n, max_price_per_unit: 1_000_000_000n },
  l1_data_gas: { max_amount: 100_000n, max_price_per_unit: 1_000_000_000n },
};

/** Execute calls as a V3 transaction (starknet.js v8 handles triple gas natively). */
async function executeV3(account: Account, calls: any[]): Promise<any> {
  try {
    return await account.execute(calls);
  } catch (err: any) {
    const message = err?.message ?? String(err);
    // Some account contract versions fail fee estimation for V3 invokes.
    // Retry with explicit tip/resource bounds so we bypass tip-statistics lookup.
    if (shouldFallbackToV1(message)) {
      try {
        return await account.execute(calls, {
          tip: 0,
        });
      } catch {
        try {
          return await account.execute(calls, {
            tip: 0,
            resourceBounds: STATIC_RESOURCE_BOUNDS as any,
          });
        } catch (retryErr: any) {
          throw new Error(`V3 fallback failed: ${normalizeTxError(retryErr)}`);
        }
      }
    }
    throw err;
  }
}

const TX_WAIT_TIMEOUT_MS = 12_000;

async function waitForTransactionWithTimeout(
  txHash: string,
  timeoutMs = TX_WAIT_TIMEOUT_MS,
  providerOverride?: RpcProvider
): Promise<any | null> {
  const waitProvider = providerOverride ?? provider;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      waitProvider.waitForTransaction(txHash),
      new Promise<null>((resolve) => {
        timeoutId = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
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
function getAccount(mode?: SignerMode, nodeUrl = config.STARKNET_RPC_URL): Account | null {
  if (!config.AGENT_ADDRESS) return null;
  const signerMode = mode ?? resolveSignerMode();
  const accountProvider = getRpcProvider(nodeUrl);

  if (signerMode === "session") {
    const signer = getSessionSigner();
    if (!signer) return null;
    return new Account({
      provider: accountProvider,
      address: config.AGENT_ADDRESS,
      signer,
    });
  }

  if (!config.AGENT_PRIVATE_KEY) return null;
  return new Account({
    provider: accountProvider,
    address: config.AGENT_ADDRESS,
    signer: config.AGENT_PRIVATE_KEY,
  });
}

interface ExecuteWithFailoverResult {
  result: any;
  provider: RpcProvider;
  rpcUrl: string;
}

async function executeWithRpcFailover(
  calls: any[],
  options?: { accountOverride?: Account; signerMode?: SignerMode }
): Promise<ExecuteWithFailoverResult> {
  const accountOverride = options?.accountOverride;
  if (accountOverride) {
    const result = await executeV3(accountOverride, calls);
    const overrideProvider =
      ((accountOverride as any)?.provider as RpcProvider | undefined) ?? provider;
    return {
      result,
      provider: overrideProvider,
      rpcUrl: normalizeRpcUrl(config.STARKNET_RPC_URL),
    };
  }

  const signerMode = options?.signerMode ?? resolveSignerMode();
  const rpcUrls = getOrderedRpcUrls();
  let lastError: unknown = null;

  for (let idx = 0; idx < rpcUrls.length; idx++) {
    const rpcUrl = rpcUrls[idx];
    const account = getAccount(signerMode, rpcUrl);
    if (!account) {
      throw new Error("No agent account configured");
    }

    try {
      const result = await executeV3(account, calls);
      markRpcHealthy(rpcUrl);
      return {
        result,
        provider: getRpcProvider(rpcUrl),
        rpcUrl,
      };
    } catch (err) {
      lastError = err;
      const hasNext = idx < rpcUrls.length - 1;
      if (!hasNext || !shouldRetryAcrossRpcProviders(err)) {
        break;
      }
    }
  }

  throw lastError ?? new Error("All RPC providers failed");
}

function usingSessionSigner(): boolean {
  return resolveSignerMode() === "session";
}

function normalizeAddress(value: string): string {
  return value.toLowerCase();
}

function parseBigNumberish(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return 0n;
    return BigInt(Math.trunc(value));
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return 0n;
    try {
      return BigInt(trimmed);
    } catch {
      return 0n;
    }
  }
  if (Array.isArray(value) && value.length > 0) {
    return parseBigNumberish(value[0]);
  }
  if (value && typeof value === "object") {
    const low =
      (value as any).low ??
      (value as any).lo ??
      (value as any).l ??
      (value as any).value?.low;
    const high =
      (value as any).high ??
      (value as any).hi ??
      (value as any).h ??
      (value as any).value?.high;
    if (low !== undefined || high !== undefined) {
      const lo = parseBigNumberish(low ?? 0);
      const hi = parseBigNumberish(high ?? 0);
      return lo + (hi << 128n);
    }
    const nested =
      (value as any).value ??
      (value as any).result ??
      (value as any).res;
    if (nested !== undefined && nested !== value) {
      return parseBigNumberish(nested);
    }
  }
  if (value && typeof (value as any).toString === "function") {
    const raw = String((value as any).toString());
    if (raw && raw !== "[object Object]") {
      try {
        return BigInt(raw);
      } catch {
        return 0n;
      }
    }
  }
  return 0n;
}

function toSafeNumber(value: unknown): number {
  const parsed = parseBigNumberish(value);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) return Number.MAX_SAFE_INTEGER;
  if (parsed < BigInt(Number.MIN_SAFE_INTEGER)) return Number.MIN_SAFE_INTEGER;
  return Number(parsed);
}

function toAddressHex(value: unknown): string {
  return `0x${parseBigNumberish(value).toString(16)}`;
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

/**
 * Get the STRK wallet balance for the given address (or AGENT_ADDRESS if omitted).
 * Returns 0n on any RPC error.
 */
export async function getWalletBalance(address?: string): Promise<bigint> {
  const target = address ?? config.AGENT_ADDRESS;
  if (!target) return 0n;
  const rpcUrls = getOrderedRpcUrls();
  for (const rpcUrl of rpcUrls) {
    try {
      const result = await getRpcProvider(rpcUrl).callContract({
        contractAddress: config.COLLATERAL_TOKEN_ADDRESS,
        entrypoint: "balanceOf",
        calldata: CallData.compile({ account: target }),
      });
      const low  = BigInt(result[0] ?? "0x0");
      const high = BigInt(result[1] ?? "0x0");
      markRpcHealthy(rpcUrl);
      return low + high * (2n ** 128n);
    } catch {
      // Try next RPC provider.
    }
  }
  return 0n;
}

/** Place a bet on a prediction market. */
export async function placeBet(
  marketAddress: string,
  outcome: 0 | 1,
  amount: bigint,
  collateralToken: string,
  accountOverride?: Account
): Promise<TxResult> {
  if (!accountOverride && !getAccount()) {
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
    let txProvider: RpcProvider | undefined;
    ensureCallsAllowlisted([approveTx, betTx]);
    try {
      const executed = await executeWithRpcFailover([approveTx, betTx], {
        accountOverride,
      });
      result = executed.result;
      txProvider = executed.provider;
      await waitForTransactionWithTimeout(result.transaction_hash, TX_WAIT_TIMEOUT_MS, txProvider);
    } catch (err) {
      // If session signer used snake_case allowance but token expects camelCase, retry once.
      if (usingSessionSigner() && approveTx.entrypoint === "increase_allowance") {
        const retryApprove = buildAllowanceCall(collateralToken, marketAddress, amount, "increaseAllowance");
        const executed = await executeWithRpcFailover([retryApprove, betTx], {
          accountOverride,
        });
        result = executed.result;
        txProvider = executed.provider;
        await waitForTransactionWithTimeout(result.transaction_hash, TX_WAIT_TIMEOUT_MS, txProvider);
      } else {
        throw err;
      }
    }

    return { txHash: result.transaction_hash, status: "success" };
  } catch (err: any) {
    return { txHash: "", status: "error", error: normalizeTxError(err) };
  }
}

/** Record an agent prediction on the accuracy tracker. */
export async function recordPrediction(
  marketId: number,
  probability: number,
  accountOverride?: Account
): Promise<TxResult> {
  if (!accountOverride && !getAccount()) {
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
    const executed = await executeWithRpcFailover([tx], { accountOverride });
    const result = executed.result;
    await waitForTransactionWithTimeout(
      result.transaction_hash,
      TX_WAIT_TIMEOUT_MS,
      executed.provider
    );

    return { txHash: result.transaction_hash, status: "success" };
  } catch (err: any) {
    return { txHash: "", status: "error", error: normalizeTxError(err) };
  }
}

/** Create a new prediction market via the factory (agent-only). */
export async function createMarket(
  question: string,
  durationDays = 30,
  feeBps = 200,
  oracleAddress?: string
): Promise<CreateMarketResult> {
  if (!getAccount()) {
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
    const executed = await executeWithRpcFailover([tx]);
    const result = executed.result;
    const receipt = await waitForTransactionWithTimeout(
      result.transaction_hash,
      TX_WAIT_TIMEOUT_MS,
      executed.provider
    );

    let marketId: number | undefined;
    let marketAddress: string | undefined;
    const events = (receipt as any)?.events ?? [];
    for (const evt of events) {
      if (
        evt.from_address === config.MARKET_FACTORY_ADDRESS &&
        evt.keys?.length >= 2 &&
        evt.data?.length >= 1
      ) {
        try {
          marketId = toSafeNumber(evt.keys[1]);
          marketAddress = toAddressHex(evt.data?.[0]);
          break;
        } catch {
          // Continue scanning for a parsable market-created event.
        }
      }
    }

    if (marketId === undefined || !marketAddress || marketAddress === "0x0") {
      try {
        const factory = new Contract({
          abi: FACTORY_READ_ABI as any,
          address: config.MARKET_FACTORY_ADDRESS,
          providerOrAccount: executed.provider,
        });
        const countRaw = await factory.get_market_count();
        const count = toSafeNumber(countRaw);
        if (Number.isFinite(count) && count > 0) {
          const latestId = count - 1;
          const latestAddressRaw = await factory.get_market(BigInt(latestId));
          marketId = latestId;
          marketAddress = toAddressHex(latestAddressRaw);
        }
      } catch {
        // Keep undefined market metadata when fallback lookup fails.
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
    return { txHash: "", status: "error", error: normalizeTxError(err) };
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
  if (!getOwnerAccount()) {
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
    const executed = await executeWithRpcFailover([tx], {
      signerMode: "owner",
    });
    const result = executed.result;
    await waitForTransactionWithTimeout(
      result.transaction_hash,
      TX_WAIT_TIMEOUT_MS,
      executed.provider
    );
    return { txHash: result.transaction_hash, status: "success" };
  } catch (err: any) {
    return { txHash: "", status: "error", error: normalizeTxError(err) };
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
