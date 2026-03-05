import { CallData, shortString, type Call } from "starknet";

// ── Public contract addresses (Sepolia) ──────────────────────────────

export const CONTRACTS = {
  MARKET_FACTORY:
    process.env.NEXT_PUBLIC_MARKET_FACTORY_ADDRESS ??
    "0x0",
  ACCURACY_TRACKER:
    process.env.NEXT_PUBLIC_ACCURACY_TRACKER_ADDRESS ??
    "0x0",
  COLLATERAL_TOKEN:
    process.env.NEXT_PUBLIC_COLLATERAL_TOKEN_ADDRESS ??
    "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d", // STRK
} as const;

// ── Call builders ────────────────────────────────────────────────────

/** Build approve + bet multicall for a prediction market. */
export function buildBetCalls(
  marketAddress: string,
  outcome: 0 | 1,
  amount: bigint
): Call[] {
  return [
    {
      contractAddress: CONTRACTS.COLLATERAL_TOKEN,
      entrypoint: "approve",
      calldata: CallData.compile({
        spender: marketAddress,
        amount: { low: amount, high: 0n },
      }),
    },
    {
      contractAddress: marketAddress,
      entrypoint: "bet",
      calldata: CallData.compile({
        outcome,
        amount: { low: amount, high: 0n },
      }),
    },
  ];
}

/** Build create_market call for the factory. */
export function buildCreateMarketCalls(
  question: string,
  durationDays: number,
  feeBps: number,
  oracleAddress: string
): Call[] {
  const trimmed = question.slice(0, 31).replace(/[^\x20-\x7E]/g, "");
  const questionHash = shortString.encodeShortString(trimmed || "market");
  const resolutionTime = Math.floor(Date.now() / 1000) + durationDays * 86400;

  return [
    {
      contractAddress: CONTRACTS.MARKET_FACTORY,
      entrypoint: "create_market",
      calldata: CallData.compile([
        BigInt(questionHash),
        BigInt(resolutionTime),
        BigInt(oracleAddress),
        BigInt(CONTRACTS.COLLATERAL_TOKEN),
        BigInt(feeBps),
      ]),
    },
  ];
}

/** Build resolve call for a market. */
export function buildResolveCalls(
  marketAddress: string,
  outcome: 0 | 1
): Call[] {
  return [
    {
      contractAddress: marketAddress,
      entrypoint: "resolve",
      calldata: CallData.compile({ winning_outcome: outcome }),
    },
  ];
}

/** Build finalize_market call on the accuracy tracker. */
export function buildFinalizeCalls(
  marketId: number,
  outcome: 0 | 1
): Call[] {
  return [
    {
      contractAddress: CONTRACTS.ACCURACY_TRACKER,
      entrypoint: "finalize_market",
      calldata: CallData.compile({
        market_id: { low: BigInt(marketId), high: 0n },
        actual_outcome: { low: BigInt(outcome), high: 0n },
      }),
    },
  ];
}

/** Build claim call for a resolved market. */
export function buildClaimCalls(marketAddress: string): Call[] {
  return [
    {
      contractAddress: marketAddress,
      entrypoint: "claim",
      calldata: [],
    },
  ];
}
