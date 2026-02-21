/**
 * Credits routes — on-chain balance endpoint.
 */

import type { FastifyInstance } from "fastify";
import { escrowClient } from "../escrow-client.js";
import { heartbeatCostWei, hourlyRateWei, type MachineTier } from "@starknet-agentic/bitsage-cloud-sdk";

/**
 * Format a wei balance as a human-readable STRK string with 6 decimal places.
 * Uses pure BigInt arithmetic to avoid Number precision loss for balances > 2^53 wei.
 *
 * Example: 1_500_000_000_000_000_000n → "1.500000"
 */
function weiToStrkString(wei: bigint): string {
  const WEI = 1_000_000_000_000_000_000n; // 1e18
  const DECIMALS = 6n;
  const SCALE = 10n ** DECIMALS; // 1e6 for 6 decimal places

  const whole = wei / WEI;
  const fractionalWei = wei % WEI;
  // Compute 6 fractional digits using integer arithmetic only.
  const fractional = (fractionalWei * SCALE) / WEI;
  return `${whole}.${fractional.toString().padStart(Number(DECIMALS), "0")}`;
}

export async function creditsRoutes(app: FastifyInstance) {
  /**
   * GET /credits/:address
   *
   * Returns the escrow balance for an agent address plus estimated compute hours.
   */
  app.get<{ Params: { address: string } }>("/credits/:address", async (req, reply) => {
    const { address } = req.params;

    if (!address.startsWith("0x")) {
      return reply.status(400).send({ error: "Invalid agent address" });
    }

    let balanceWei: bigint;
    try {
      balanceWei = await escrowClient.balanceOf(address);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(502).send({ error: `Failed to read on-chain balance: ${message}` });
    }

    // Use pure BigInt arithmetic — no Number conversion to avoid precision loss on large balances.
    const balanceStrk = weiToStrkString(balanceWei);

    const estimatedHoursRemaining: Record<MachineTier, number> = {
      nano:  0,
      micro: 0,
      small: 0,
    };

    for (const tier of ["nano", "micro", "small"] as MachineTier[]) {
      const costPerHour = hourlyRateWei(tier);
      if (costPerHour > 0n) {
        // Express as hours with 2 decimal places using integer arithmetic.
        estimatedHoursRemaining[tier] = Number((balanceWei * 100n) / costPerHour) / 100;
      }
    }

    return reply.send({
      agentAddress: address,
      balanceStrk,
      balanceWei: balanceWei.toString(),
      estimatedHoursRemaining,
    });
  });
}
