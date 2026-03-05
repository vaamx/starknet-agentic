/**
 * BitsagE Cloud — X-402 server-side payment verifier.
 *
 * Ported from examples/prediction-agent/app/lib/x402-middleware.ts.
 * Verifies SNIP-12 TypedData signatures from agent wallets.
 *
 * Middleware is applied to sensitive routes (POST /machines/create, POST /machines/:id/heartbeat).
 * When X402_ENABLED=false the middleware always passes.
 */

import { RpcProvider, CallData, stark, typedData as starkTypedData } from "starknet";
import { encodeBase64Json, decodeBase64Json } from "@starknet-agentic/x402-starknet";
import { config } from "./config.js";
import type { FastifyRequest, FastifyReply } from "fastify";

const provider = new RpcProvider({ nodeUrl: config.STARKNET_RPC_URL });

/**
 * One-time nonce store: nonce → expiry unix-ms.
 * Bounded to MAX_NONCES entries to prevent unbounded memory growth under nonce-flood attacks.
 * When the cap is reached, oldest entries are evicted before inserting new ones.
 */
const MAX_NONCES = 10_000;
const usedNonces = new Map<string, number>();

function pruneExpiredNonces(): void {
  const now = Date.now();
  for (const [nonce, expiry] of usedNonces) {
    if (expiry < now) usedNonces.delete(nonce);
  }
}

function recordNonce(nonce: string, expiryMs: number): void {
  pruneExpiredNonces();
  // If still over cap after pruning, evict the oldest entry (Maps preserve insertion order).
  if (usedNonces.size >= MAX_NONCES) {
    const oldest = usedNonces.keys().next().value;
    if (oldest !== undefined) usedNonces.delete(oldest);
  }
  usedNonces.set(nonce, expiryMs);
}

/**
 * Allowed clock skew between client and server (seconds).
 * A signature with expiry up to CLOCK_SKEW_SECS in the past is still accepted
 * to tolerate NTP drift and network latency.
 */
const CLOCK_SKEW_SECS = 30;

/** SNIP-12 domain for BitsagE Cloud payments — chain ID from environment config. */
const DOMAIN = {
  name: "BitsageCloud",
  version: "1",
  chainId: config.STARKNET_NETWORK, // "SN_SEPOLIA" | "SN_MAIN"
  revision: "1",
};

const PAYMENT_TYPES = {
  StarknetDomain: [
    { name: "name",     type: "shortstring" },
    { name: "version",  type: "shortstring" },
    { name: "chainId",  type: "shortstring" },
    { name: "revision", type: "shortstring" },
  ],
  ComputePayment: [
    { name: "nonce",    type: "felt252" },
    { name: "expiry",   type: "u64" },
    { name: "endpoint", type: "shortstring" },
  ],
};

function buildChallenge(endpoint: string) {
  const nonce = stark.randomAddress();
  const expiry = Math.floor(Date.now() / 1000) + 60;
  return {
    scheme: "exact-starknet",
    typedData: {
      domain: DOMAIN,
      types: PAYMENT_TYPES,
      primaryType: "ComputePayment",
      message: { nonce, expiry: expiry.toString(), endpoint },
    },
    endpoint,
    nonce,
    expiry: expiry.toString(),
  };
}

interface PaymentSig {
  callerAddress: string;
  message: { nonce: string; expiry: string; endpoint: string };
  signature: string[];
}

/**
 * Fastify preHandler that enforces X-402 payment verification.
 * Pass to any route that requires STRK payment.
 */
export async function x402Guard(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const enabled = config.X402_ENABLED === "true";
  if (!enabled) return;

  const endpoint = req.url.replace(/\?.*$/, "");
  const sigHeader = req.headers["x-payment-signature"] as string | undefined;

  if (!sigHeader) {
    const challenge = buildChallenge(endpoint);
    reply.status(402).header("X-PAYMENT-REQUIRED", encodeBase64Json(challenge)).send({
      error: "Payment required",
      challenge,
    });
    return;
  }

  let sig: PaymentSig;
  try {
    sig = decodeBase64Json<PaymentSig>(sigHeader);
  } catch {
    reply.status(402).send({ error: "Invalid payment signature encoding" });
    return;
  }

  // Expiry must be present and parseable — missing expiry is always rejected.
  const expiryRaw = sig.message?.expiry;
  if (!expiryRaw) {
    reply.status(402).send({ error: "Payment signature missing expiry" });
    return;
  }
  const expiry = parseInt(expiryRaw, 10);
  if (!Number.isFinite(expiry)) {
    reply.status(402).send({ error: "Payment signature has invalid expiry" });
    return;
  }
  // Accept signatures up to CLOCK_SKEW_SECS past expiry to tolerate NTP drift.
  if (expiry < Math.floor(Date.now() / 1000) - CLOCK_SKEW_SECS) {
    reply.status(402).send({ error: "Payment signature expired" });
    return;
  }

  const nonce = sig.message?.nonce;
  if (!nonce || usedNonces.has(nonce)) {
    reply.status(402).send({ error: "Nonce already used or missing" });
    return;
  }

  const callerAddress = sig.callerAddress;
  if (!callerAddress) {
    reply.status(402).send({ error: "Missing callerAddress in payment signature" });
    return;
  }

  try {
    const td = {
      domain: DOMAIN,
      types: PAYMENT_TYPES,
      primaryType: "ComputePayment",
      message: sig.message,
    };
    const msgHash = starkTypedData.getMessageHash(td, callerAddress);
    await provider.callContract({
      contractAddress: callerAddress,
      entrypoint: "is_valid_signature",
      calldata: CallData.compile({ hash: msgHash, signatures: sig.signature ?? [] }),
    });

    // Record nonce with TTL = 5 minutes (well beyond any reasonable expiry).
    const NONCE_TTL_MS = 300_000;
    recordNonce(nonce, Date.now() + NONCE_TTL_MS);

    // Attach caller address for downstream route handlers via Fastify request lifecycle.
    (req as FastifyRequest & { callerAddress: string }).callerAddress = callerAddress;
  } catch (err) {
    // Distinguish network errors from invalid signatures to avoid confusing clients.
    const isNetworkError = err instanceof Error &&
      (err.message.includes("ECONNREFUSED") || err.message.includes("fetch failed"));
    if (isNetworkError) {
      reply.status(503).send({ error: "Payment verification unavailable — RPC error" });
    } else {
      const challenge = buildChallenge(endpoint);
      reply.status(402).header("X-PAYMENT-REQUIRED", encodeBase64Json(challenge)).send({
        error: "Payment verification failed — invalid signature",
        challenge,
      });
    }
  }
}
