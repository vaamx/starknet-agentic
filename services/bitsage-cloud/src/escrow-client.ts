/**
 * BitsagE Cloud — On-chain escrow contract client.
 *
 * Reads agent balances and charges compute costs via the BitsageCreditEscrow
 * contract deployed on Starknet. Calls charge() instead of deduct() to take
 * advantage of on-chain tick-ID replay protection.
 */

import { Account, RpcProvider, CallData, uint256 } from "starknet";
import { config } from "./config.js";

const provider = new RpcProvider({ nodeUrl: config.STARKNET_RPC_URL });

const operatorAccount = new Account({
  provider,
  address: config.BITSAGE_OPERATOR_ADDRESS,
  signer: config.BITSAGE_OPERATOR_PRIVATE_KEY,
});

/**
 * Encode a Fly.io machine ID (hex string like "2865549f7d5487") as a felt252.
 * Fly machine IDs are short hex strings that fit safely in a felt252.
 */
function machineIdToFelt252(flyMachineId: string): string {
  return "0x" + flyMachineId;
}

export const escrowClient = {
  /**
   * Read the current escrow balance for an agent address (on-chain call, no gas).
   *
   * The contract returns u256 as [low, high] pair. We combine them into a bigint.
   */
  async balanceOf(agentAddress: string): Promise<bigint> {
    const result = await provider.callContract({
      contractAddress: config.BITSAGE_ESCROW_ADDRESS,
      entrypoint: "balance_of",
      calldata: [agentAddress],
    });

    const arr = Array.isArray(result) ? result : (result as { result?: string[] }).result ?? [];
    if (arr.length < 2) {
      throw new Error(
        `balanceOf: expected 2-element u256 [low, high] from contract, got ${arr.length} element(s). ` +
        "Check that BITSAGE_ESCROW_ADDRESS is correct and the ABI matches."
      );
    }
    const low = BigInt(arr[0]);
    const high = BigInt(arr[1]);
    return low + (high << 128n);
  },

  /**
   * Charge compute cost from an agent's escrow balance (idempotent).
   *
   * Uses the contract's charge() entrypoint which enforces:
   *   - tick_id > last recorded tick for (agent, machine_id) — replay-safe
   *   - billing not paused by agent — circuit breaker respected
   *   - daily cap not exceeded — on-chain spend limit
   *
   * @param agentAddress  - The agent whose balance to charge.
   * @param flyMachineId  - Fly.io machine ID (hex string, used as felt252 identifier).
   * @param tickId        - Monotonic u64 tick counter (e.g. Math.floor(Date.now() / 60000)).
   * @param amountWei     - Amount in collateral-token wei (18 decimals).
   * @returns Transaction hash.
   */
  async charge(
    agentAddress: string,
    flyMachineId: string,
    tickId: bigint,
    amountWei: bigint
  ): Promise<string> {
    const amountU256 = uint256.bnToUint256(amountWei);
    const result = await operatorAccount.execute({
      contractAddress: config.BITSAGE_ESCROW_ADDRESS,
      entrypoint: "charge",
      calldata: CallData.compile({
        agent: agentAddress,
        machine_id: machineIdToFelt252(flyMachineId),
        tick_id: tickId,     // u64 → single felt252 element
        amount: amountU256,  // u256 → [low, high]
      }),
    });
    return result.transaction_hash;
  },
};
