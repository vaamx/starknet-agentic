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

// ── Economy contract addresses (Sepolia) ──────────────────────────────

export const ECONOMY = {
  TASK_ESCROW:
    process.env.NEXT_PUBLIC_TASK_ESCROW_ADDRESS ?? "0x0",
  BONDING_CURVE_FACTORY:
    process.env.NEXT_PUBLIC_BONDING_CURVE_FACTORY_ADDRESS ?? "0x0",
  GUILD_REGISTRY:
    process.env.NEXT_PUBLIC_GUILD_REGISTRY_ADDRESS ?? "0x0",
  GUILD_DAO:
    process.env.NEXT_PUBLIC_GUILD_DAO_ADDRESS ?? "0x0",
} as const;

// ── ProveWork call builders ───────────────────────────────────────────

/** Approve STRK + bid on a task. */
export function buildBidTaskCalls(
  escrowAddress: string,
  taskId: bigint,
  bidAmount: bigint
): Call[] {
  return [
    {
      contractAddress: CONTRACTS.COLLATERAL_TOKEN,
      entrypoint: "approve",
      calldata: CallData.compile({
        spender: escrowAddress,
        amount: { low: bidAmount, high: 0n },
      }),
    },
    {
      contractAddress: escrowAddress,
      entrypoint: "bid_task",
      calldata: CallData.compile({
        task_id: { low: taskId, high: 0n },
        bid_amount: { low: bidAmount, high: 0n },
      }),
    },
  ];
}

/** Submit proof hash for an assigned task. */
export function buildSubmitProofCalls(
  escrowAddress: string,
  taskId: bigint,
  proofHash: bigint
): Call[] {
  return [
    {
      contractAddress: escrowAddress,
      entrypoint: "submit_proof",
      calldata: CallData.compile({
        task_id: { low: taskId, high: 0n },
        proof_hash: proofHash,
      }),
    },
  ];
}

/** Approve a submitted task (poster only). */
export function buildApproveTaskCalls(
  escrowAddress: string,
  taskId: bigint
): Call[] {
  return [
    {
      contractAddress: escrowAddress,
      entrypoint: "approve_task",
      calldata: CallData.compile({
        task_id: { low: taskId, high: 0n },
      }),
    },
  ];
}

/** Dispute a submitted task (poster only). */
export function buildDisputeTaskCalls(
  escrowAddress: string,
  taskId: bigint,
  reasonHash: bigint
): Call[] {
  return [
    {
      contractAddress: escrowAddress,
      entrypoint: "dispute_task",
      calldata: CallData.compile({
        task_id: { low: taskId, high: 0n },
        reason_hash: reasonHash,
      }),
    },
  ];
}

// ── StarkMint call builders ───────────────────────────────────────────

/** Approve STRK + buy tokens on a bonding curve.
 *  `amount` is the number of tokens to buy.
 *  `maxCost` is the maximum STRK the buyer is willing to pay (from get_buy_price + fee).
 *  The curve charges raw_cost + fee, which differs from `amount`. */
export function buildBuyCurveCalls(
  curveAddress: string,
  amount: bigint,
  maxCost: bigint
): Call[] {
  return [
    {
      contractAddress: CONTRACTS.COLLATERAL_TOKEN,
      entrypoint: "approve",
      calldata: CallData.compile({
        spender: curveAddress,
        amount: { low: maxCost, high: 0n },
      }),
    },
    {
      contractAddress: curveAddress,
      entrypoint: "buy",
      calldata: CallData.compile({
        amount: { low: amount, high: 0n },
      }),
    },
  ];
}

/** Sell tokens back to a bonding curve. */
export function buildSellCurveCalls(
  curveAddress: string,
  tokenAddress: string,
  amount: bigint
): Call[] {
  return [
    {
      contractAddress: tokenAddress,
      entrypoint: "approve",
      calldata: CallData.compile({
        spender: curveAddress,
        amount: { low: amount, high: 0n },
      }),
    },
    {
      contractAddress: curveAddress,
      entrypoint: "sell",
      calldata: CallData.compile({
        amount: { low: amount, high: 0n },
      }),
    },
  ];
}

// ── Guild call builders ───────────────────────────────────────────────

/** Approve STRK + join a guild with stake. */
export function buildJoinGuildCalls(
  registryAddress: string,
  guildId: bigint,
  stakeAmount: bigint
): Call[] {
  return [
    {
      contractAddress: CONTRACTS.COLLATERAL_TOKEN,
      entrypoint: "approve",
      calldata: CallData.compile({
        spender: registryAddress,
        amount: { low: stakeAmount, high: 0n },
      }),
    },
    {
      contractAddress: registryAddress,
      entrypoint: "join_guild",
      calldata: CallData.compile({
        guild_id: { low: guildId, high: 0n },
        stake_amount: { low: stakeAmount, high: 0n },
      }),
    },
  ];
}

/** Leave a guild and reclaim stake. */
export function buildLeaveGuildCalls(
  registryAddress: string,
  guildId: bigint
): Call[] {
  return [
    {
      contractAddress: registryAddress,
      entrypoint: "leave_guild",
      calldata: CallData.compile({
        guild_id: { low: guildId, high: 0n },
      }),
    },
  ];
}

/** Vote on a guild proposal. */
export function buildGuildVoteCalls(
  daoAddress: string,
  proposalId: bigint,
  support: boolean
): Call[] {
  return [
    {
      contractAddress: daoAddress,
      entrypoint: "vote",
      calldata: CallData.compile({
        proposal_id: { low: proposalId, high: 0n },
        support: support ? 1 : 0,
      }),
    },
  ];
}
