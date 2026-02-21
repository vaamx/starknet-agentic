/**
 * Huginn Executor — hardened SHA-256 provenance logging for Starknet.
 *
 * Logs AI reasoning hashes to the Huginn Registry contract, creating an
 * immutable, verifiable audit trail of agent decision-making.
 *
 * Hardening over v1:
 *  - Module-level dedup Set:    same hash never submitted twice per process
 *  - Auto-registration:         calls register_agent() if log_thought() panics
 *                               with 'Agent not registered'; retries once
 *  - Execution timeout:         15 s hard limit, timer always cleared via .finally()
 *  - Empty reasoning guard:     skips hashing empty/whitespace inputs
 *  - Typed u256 split:          parseHashToU256() asserts exact 64 hex chars
 *  - Returns txHash on success: callers can emit on-chain Huginn tx to the UI
 *  - Raw calldata for ByteArray: register_agent metadata_url encoded as [0,0,0]
 *                                not as felt252 0 — fixes silent revert bug
 */

import { CallData, shortString } from "starknet";
import { config } from "./config";
import { getActiveAccount, isAgentConfigured } from "./starknet-executor";

// ── Public interface ────────────────────────────────────────────────────────

export interface HuginnLogResult {
  /** "0x" + 64 hex chars — SHA-256 of the reasoning text. Empty on skip/hash-error. */
  thoughtHash: string;
  /** Transaction hash of the log_thought() call. Present only when status === "success". */
  txHash?: string;
  status: "success" | "skipped" | "error";
  error?: string;
}

// ── Module-level state ──────────────────────────────────────────────────────

/**
 * Thought hashes submitted in this process lifetime.
 * Prevents identical reasoning from burning gas on duplicate log_thought calls.
 * The contract allows same-owner re-logging (idempotent), but we save the gas.
 */
const submittedHashes = new Set<string>();

/**
 * Agent addresses confirmed registered (or attempted) in this process.
 * Avoids an extra RPC round-trip on every log_thought call after the first.
 */
const registeredAddresses = new Set<string>();

// ── Internal helpers ────────────────────────────────────────────────────────

/** Race a promise against a hard timeout. Throws on timeout. Always clears the timer. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  // timerId is assigned synchronously inside the Promise executor, so the
  // non-null assertion in .finally() is always safe.
  let timerId: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timerId = setTimeout(
      () => reject(new Error(`[huginn] ${label} timed out after ${ms}ms`)),
      ms
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timerId!));
}

/**
 * Split a 64-hex-char SHA-256 hash into Cairo u256 { low, high }.
 *
 * SHA-256 → 32 bytes:
 *   bytes[0..16]  → high u128  (most-significant half)
 *   bytes[16..32] → low  u128  (least-significant half)
 *
 * This matches Cairo's u256 struct layout and the Huginn Registry
 * log_thought(thought_hash: u256) calldata encoding.
 */
function parseHashToU256(thoughtHash: string): { low: bigint; high: bigint } {
  const hex = thoughtHash.replace(/^0x/, "");
  if (hex.length !== 64) {
    throw new Error(
      `[huginn] parseHashToU256: expected 64 hex chars, got ${hex.length} from "${thoughtHash.slice(0, 20)}..."`
    );
  }
  return {
    high: BigInt("0x" + hex.slice(0, 32)),
    low:  BigInt("0x" + hex.slice(32)),
  };
}

/**
 * Register the active agent with the Huginn Registry.
 *
 * - Derives a felt252 name from the last 4 hex chars of the agent address
 *   (always ≤ 31 ASCII chars, always fits in a felt252).
 * - "Agent already registered" → treated as success (idempotent).
 * - Other errors → propagated to the caller.
 *
 * @throws if the execute() call fails for a reason other than already-registered.
 */
async function ensureRegistered(huginnAddress: string): Promise<void> {
  const account = getActiveAccount();
  if (!account) throw new Error("[huginn] ensureRegistered: no active account");

  const agentAddr = account.address.toLowerCase();
  if (registeredAddresses.has(agentAddr)) return; // already confirmed this session

  // Derive a deterministic felt252-compatible name from the agent address suffix.
  // "agent-" (6) + 4 hex chars = 10 chars — well within felt252's 31-char limit.
  const suffix = agentAddr.slice(-4).replace(/[^0-9a-f]/gi, "0").toLowerCase();
  const name = shortString.encodeShortString(`agent-${suffix}`);

  // Raw calldata — bypasses CallData.compile's felt252 inference for strings.
  //
  // register_agent(name: felt252, metadata_url: ByteArray)
  //
  // Cairo ByteArray serialisation (empty string ""):
  //   [0]  data.len        = 0   (no 31-byte chunks)
  //   [0]  pending_word    = 0   (remaining bytes as felt)
  //   [0]  pending_word_len = 0  (byte count of pending_word)
  //
  // CallData.compile({ metadata_url: "" }) encodes "" as a felt252 short-string
  // (single felt = 0), producing [name, 0] instead of [name, 0, 0, 0].
  // That mis-encoded calldata makes the on-chain call revert unconditionally.
  const registerCall = {
    contractAddress: huginnAddress,
    entrypoint: "register_agent",
    calldata: [
      name,    // felt252 — already hex-encoded by shortString.encodeShortString
      "0x0",   // ByteArray::data.len        = 0
      "0x0",   // ByteArray::pending_word    = 0
      "0x0",   // ByteArray::pending_word_len = 0
    ],
  };

  try {
    await withTimeout(account.execute([registerCall]), 15_000, "register_agent");
    console.log(`[huginn] register_agent: success — agent ${agentAddr.slice(0, 12)}...`);
  } catch (err: any) {
    const msg: string = err?.message ?? String(err);
    if (msg.includes("Agent already registered")) {
      // Someone previously registered this address (prior process run).
      // Safe to proceed; flag as known-registered.
      console.log(`[huginn] register_agent: already registered — ${agentAddr.slice(0, 12)}...`);
    } else {
      throw err; // unexpected — propagate
    }
  }

  registeredAddresses.add(agentAddr);
}

/**
 * Execute log_thought() with exactly-once auto-registration recovery.
 *
 * If log_thought() panics with "Agent not registered":
 *   1. Call register_agent() (idempotent).
 *   2. Retry log_thought() exactly once (allowRetry=false prevents infinite loop).
 *
 * @returns transaction_hash string on success.
 * @throws on any unrecoverable error.
 */
async function executeLogThought(
  huginnAddress: string,
  thoughtHash: string,
  allowRetry = true
): Promise<string> {
  const account = getActiveAccount();
  if (!account) throw new Error("[huginn] executeLogThought: no active account");

  const { low, high } = parseHashToU256(thoughtHash);

  const call = {
    contractAddress: huginnAddress,
    entrypoint: "log_thought",
    calldata: CallData.compile({ thought_hash: { low, high } }),
  };

  try {
    const result = await withTimeout(account.execute([call]), 15_000, "log_thought");
    return result.transaction_hash;
  } catch (err: any) {
    const msg: string = err?.message ?? String(err);

    // Auto-registration recovery — exactly one retry.
    if (allowRetry && msg.includes("Agent not registered")) {
      console.log("[huginn] log_thought: 'Agent not registered' — attempting auto-registration…");
      await ensureRegistered(huginnAddress);
      return executeLogThought(huginnAddress, thoughtHash, false); // retry without further recovery
    }

    // "Thought already claimed" — a different agent owns this hash; not an error we can fix.
    if (msg.includes("Thought already claimed")) {
      throw new Error(
        `[huginn] thought hash ${thoughtHash.slice(0, 18)}... is owned by a different agent`
      );
    }

    throw err;
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Compute a SHA-256 hash of any text.
 *
 * @returns "0x" + 64 lowercase hex characters (32 bytes).
 */
export async function computeThoughtHash(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return "0x" + hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Hash reasoning text and log the hash on-chain in the Huginn Registry.
 *
 * Skips silently (status: "skipped") when:
 *   - reasoning is empty or whitespace-only
 *   - HUGINN_REGISTRY_ADDRESS is "0x0" (config.huginnEnabled === false)
 *   - Agent account (AGENT_ADDRESS + signer) is not configured
 *   - Same thoughtHash was already submitted in this process (dedup)
 *
 * Auto-recovers from "Agent not registered" by calling register_agent() first.
 * All errors are caught and returned — never throws, never blocks the pipeline.
 *
 * @param reasoning - The full reasoning text to hash and log.
 * @returns HuginnLogResult with thoughtHash always set on non-empty input.
 */
export async function logThoughtOnChain(reasoning: string): Promise<HuginnLogResult> {
  // ── Guard: empty reasoning ──────────────────────────────────────────────
  const trimmed = reasoning?.trim() ?? "";
  if (!trimmed) {
    return {
      thoughtHash: "",
      status: "skipped",
      error: "Empty reasoning — nothing to log",
    };
  }

  // ── Guard: Huginn not configured ────────────────────────────────────────
  if (!config.huginnEnabled) {
    return {
      thoughtHash: "",
      status: "skipped",
      error: "HUGINN_REGISTRY_ADDRESS not configured (set to 0x0)",
    };
  }
  const huginnAddress = config.HUGINN_REGISTRY_ADDRESS;

  // ── Guard: agent account not configured ────────────────────────────────
  if (!isAgentConfigured()) {
    return {
      thoughtHash: "",
      status: "skipped",
      error: "Agent account not configured (AGENT_ADDRESS or signer missing)",
    };
  }

  // ── Compute hash ────────────────────────────────────────────────────────
  let thoughtHash: string;
  try {
    thoughtHash = await computeThoughtHash(trimmed);
  } catch (err: any) {
    return {
      thoughtHash: "",
      status: "error",
      error: `SHA-256 computation failed: ${err?.message ?? String(err)}`,
    };
  }

  // ── Guard: deduplication ────────────────────────────────────────────────
  if (submittedHashes.has(thoughtHash)) {
    console.log(
      `[huginn] dedup hit — ${thoughtHash.slice(0, 18)}... already submitted this session`
    );
    return {
      thoughtHash,
      status: "skipped",
      error: "Identical reasoning already logged this session",
    };
  }

  // ── Execute on-chain ────────────────────────────────────────────────────
  try {
    const txHash = await executeLogThought(huginnAddress, thoughtHash);
    submittedHashes.add(thoughtHash);
    console.log(
      `[huginn] log_thought: success — hash=${thoughtHash.slice(0, 18)}... tx=${txHash.slice(0, 18)}...`
    );
    return { thoughtHash, txHash, status: "success" };
  } catch (err: any) {
    const error = err?.message ?? String(err);
    console.warn(`[huginn] log_thought: failed (non-blocking) — ${error}`);
    return { thoughtHash, status: "error", error };
  }
}
