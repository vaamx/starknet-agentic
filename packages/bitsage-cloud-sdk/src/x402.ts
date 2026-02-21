/**
 * withX402 — X-402 payment retry wrapper for BitsagE Cloud API calls.
 *
 * Flow:
 *  1. Call fn({}) with no payment headers.
 *  2. If response.status === 402: parse X-PAYMENT-REQUIRED header, sign TypedData.
 *  3. Retry fn({ "X-Payment-Signature": signedHeader }) exactly once.
 *  4. If still 402: throw BitsageInsufficientBalanceError.
 */

import { createStarknetPaymentSignatureHeader, decodeBase64Json } from "@starknet-agentic/x402-starknet";
import { BitsageInsufficientBalanceError } from "./types.js";

interface WithX402Options {
  rpcUrl: string;
  accountAddress: string;
  privateKey: string;
}

/**
 * Wrap an HTTP call with automatic X-402 payment handling.
 *
 * @param fn - Function that takes headers and returns a Response promise.
 * @param opts - Starknet account credentials for signing the TypedData challenge.
 */
export async function withX402<T>(
  fn: (headers: Record<string, string>) => Promise<Response>,
  opts: WithX402Options
): Promise<T> {
  // First attempt — no payment header
  const firstResponse = await fn({});

  if (firstResponse.status !== 402) {
    if (!firstResponse.ok) {
      const text = await firstResponse.text().catch(() => "");
      throw new Error(`BitsagE API error ${firstResponse.status}: ${text}`);
    }
    return firstResponse.json() as T;
  }

  // 402 received — need to pay
  const paymentRequiredHeader = firstResponse.headers.get("x-payment-required");
  if (!paymentRequiredHeader) {
    throw new Error("BitsagE API returned 402 but no X-PAYMENT-REQUIRED header");
  }

  let paymentRequired: unknown;
  try {
    paymentRequired = decodeBase64Json(paymentRequiredHeader);
  } catch {
    throw new Error("BitsagE API returned unparseable X-PAYMENT-REQUIRED header");
  }

  // Sign the TypedData challenge
  const { headerValue } = await createStarknetPaymentSignatureHeader({
    paymentRequired: paymentRequired as Parameters<typeof createStarknetPaymentSignatureHeader>[0]["paymentRequired"],
    rpcUrl: opts.rpcUrl,
    accountAddress: opts.accountAddress,
    privateKey: opts.privateKey,
  });

  // Retry with payment signature
  const secondResponse = await fn({ "X-Payment-Signature": headerValue });

  if (secondResponse.status === 402) {
    // Still 402 after paying — insufficient balance
    throw new BitsageInsufficientBalanceError();
  }

  if (!secondResponse.ok) {
    const text = await secondResponse.text().catch(() => "");
    throw new Error(`BitsagE API error ${secondResponse.status}: ${text}`);
  }

  return secondResponse.json() as T;
}
