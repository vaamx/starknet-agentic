/**
 * X-402 Middleware — SNIP-12 signed payment verification for Starknet.
 *
 * Implements a payment challenge/response protocol:
 * 1. First call (no payment header) → HTTP 402 with TypedData challenge.
 * 2. Subsequent call (signed header) → verify on-chain via is_valid_signature.
 *
 * TypedData follows SNIP-12 revision 1.
 * On-chain verification ensures the signer is a real Starknet account —
 * not just a raw EC signature check (which would be weaker).
 *
 * Security properties:
 *  - Nonces are one-time; replays are rejected even with valid signatures.
 *  - Nonces expire after X402_NONCE_TTL_SECS (default 300s).
 *  - Expired payment headers are rejected.
 *  - X402_ENABLED=false (default) completely bypasses all checks.
 */

import { NextRequest } from "next/server";
import { RpcProvider, CallData, stark, typedData as starkTypedData } from "starknet";
import { config } from "./config";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface X402PaymentChallenge {
  scheme: "exact-starknet";
  typedData: {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
  };
  amount: string;
  token: string;
  recipient: string;
  endpoint: string;
}

interface X402PaymentSignature {
  callerAddress: string;
  message: {
    amount: { low: string; high: string };
    recipient: string;
    nonce: string;
    expiry: string;
    endpoint: string;
  };
  signature: string[];
}

interface VerifyResult {
  paid: boolean;
  challenge?: X402PaymentChallenge;
  callerAddress?: string;
}

// ── Module state ──────────────────────────────────────────────────────────────

const provider = new RpcProvider({ nodeUrl: config.STARKNET_RPC_URL });

/** Nonce → expiry timestamp (ms). One-time use nonces. */
const usedNonces = new Map<string, number>();

// ── Helpers ───────────────────────────────────────────────────────────────────

function pruneExpiredNonces(): void {
  const now = Date.now();
  for (const [nonce, expiry] of usedNonces) {
    if (expiry < now) usedNonces.delete(nonce);
  }
}

function encodeBase64Json(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64");
}

function decodeBase64Json<T>(encoded: string): T {
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as T;
}

function strkToWei(strkAmount: number): { low: bigint; high: bigint } {
  const wei = BigInt(Math.round(strkAmount * 1e18));
  return { low: wei & ((1n << 128n) - 1n), high: wei >> 128n };
}

// ── Core functions ────────────────────────────────────────────────────────────

const DOMAIN = {
  name: "StarknetPredictionAgent",
  version: "1",
  chainId: config.STARKNET_CHAIN_ID,
  revision: "1",
};

const PAYMENT_TYPES = {
  StarknetDomain: [
    { name: "name",     type: "shortstring" },
    { name: "version",  type: "shortstring" },
    { name: "chainId",  type: "shortstring" },
    { name: "revision", type: "shortstring" },
  ],
  ForecastPayment: [
    { name: "amount",    type: "u256" },
    { name: "recipient", type: "ContractAddress" },
    { name: "nonce",     type: "felt" },
    { name: "expiry",    type: "felt" },
    { name: "endpoint",  type: "shortstring" },
  ],
  u256: [
    { name: "low",  type: "u128" },
    { name: "high", type: "u128" },
  ],
};

/**
 * Build a one-time payment challenge for the given endpoint and price.
 */
function buildPaymentChallenge(endpoint: string, priceStrk: number): X402PaymentChallenge {
  const nonce = stark.randomAddress();
  const expiry = Math.floor(Date.now() / 1000) + 60; // valid for 60s
  const recipient = config.AGENT_ADDRESS ?? "0x0";
  const { low, high } = strkToWei(priceStrk);

  const message = {
    amount: { low: low.toString(), high: high.toString() },
    recipient,
    nonce,
    expiry: expiry.toString(),
    endpoint,
  };

  return {
    scheme: "exact-starknet",
    typedData: {
      domain: DOMAIN,
      types: PAYMENT_TYPES,
      primaryType: "ForecastPayment",
      message,
    },
    amount: `${priceStrk} STRK`,
    token: "STRK",
    recipient,
    endpoint,
  };
}

/**
 * Verify a payment signature from the X-PAYMENT-SIGNATURE header.
 * Returns { paid: true, callerAddress } on success.
 * Returns { paid: false, challenge } when payment is missing or invalid.
 */
async function verifyPayment(
  request: NextRequest,
  endpoint: string,
  priceStrk: number
): Promise<VerifyResult> {
  const header = request.headers.get("x-payment-signature");
  if (!header) {
    return { paid: false, challenge: buildPaymentChallenge(endpoint, priceStrk) };
  }

  let sig: X402PaymentSignature;
  try {
    sig = decodeBase64Json<X402PaymentSignature>(header);
  } catch {
    return { paid: false, challenge: buildPaymentChallenge(endpoint, priceStrk) };
  }

  // Check expiry
  const expiry = parseInt(sig.message?.expiry ?? "0", 10);
  if (expiry < Math.floor(Date.now() / 1000)) {
    return { paid: false, challenge: buildPaymentChallenge(endpoint, priceStrk) };
  }

  // Check nonce replay
  pruneExpiredNonces();
  const nonce = sig.message?.nonce;
  if (!nonce || usedNonces.has(nonce)) {
    return { paid: false, challenge: buildPaymentChallenge(endpoint, priceStrk) };
  }

  const callerAddress = sig.callerAddress;
  if (!callerAddress) {
    return { paid: false, challenge: buildPaymentChallenge(endpoint, priceStrk) };
  }

  // Verify on-chain via is_valid_signature
  try {
    const td = {
      domain: DOMAIN,
      types: PAYMENT_TYPES,
      primaryType: "ForecastPayment",
      message: sig.message,
    };
    const msgHash = starkTypedData.getMessageHash(td, callerAddress);
    const sigArray = sig.signature ?? [];

    await provider.callContract({
      contractAddress: callerAddress,
      entrypoint: "is_valid_signature",
      calldata: CallData.compile({
        hash: msgHash,
        signatures: sigArray,
      }),
    });

    // Mark nonce as used (TTL = expiry + 1 min buffer)
    const ttlMs = (parseInt(String((config as any).X402_NONCE_TTL_SECS ?? "300"), 10) || 300) * 1000;
    usedNonces.set(nonce, Date.now() + ttlMs);

    return { paid: true, callerAddress };
  } catch {
    return { paid: false, challenge: buildPaymentChallenge(endpoint, priceStrk) };
  }
}

/**
 * Full middleware guard.
 *
 * Returns { paid: true, callerAddress } when payment is valid or X-402 is disabled.
 * Returns a Response (HTTP 402) when payment is required but missing/invalid.
 */
export async function requireX402(
  request: NextRequest,
  endpoint: string,
  priceStrk: number
): Promise<{ paid: true; callerAddress?: string } | Response> {
  const x402Enabled = (config as any).X402_ENABLED === "true" ||
    String((config as any).X402_ENABLED) === "true";

  if (!x402Enabled) return { paid: true };

  const result = await verifyPayment(request, endpoint, priceStrk);
  if (result.paid) {
    return { paid: true, callerAddress: result.callerAddress };
  }

  const challenge = result.challenge!;
  return new Response(
    JSON.stringify({ error: "Payment required", challenge }),
    {
      status: 402,
      headers: {
        "Content-Type": "application/json",
        "X-PAYMENT-REQUIRED": encodeBase64Json(challenge),
      },
    }
  );
}
