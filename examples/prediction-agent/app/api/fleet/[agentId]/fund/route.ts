/**
 * Fund Agent — POST /api/fleet/[agentId]/fund
 *
 * Transfers STRK from parent wallet to agent wallet.
 */

import { NextResponse } from "next/server";
import { CallData } from "starknet";
import {
  agentSpawner,
  getBuiltInAgents,
} from "@/lib/agent-spawner";
import {
  ensureAgentSpawnerHydrated,
} from "@/lib/agent-persistence";
import { config } from "@/lib/config";
import { getOwnerAccount } from "@/lib/starknet-executor";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const { agentId } = await params;
    await ensureAgentSpawnerHydrated();

    // Find agent (spawned only — built-in agents have no wallets)
    const agent = agentSpawner.getAgent(agentId);
    if (!agent) {
      const builtIn = getBuiltInAgents().find(
        (a) => a.id === agentId || a.persona.id === agentId
      );
      if (builtIn) {
        return NextResponse.json(
          { ok: false, error: "Built-in agents have no wallet to fund" },
          { status: 400 }
        );
      }
      return NextResponse.json(
        { ok: false, error: "Agent not found" },
        { status: 404 }
      );
    }

    if (!agent.walletAddress) {
      return NextResponse.json(
        { ok: false, error: "Agent has no on-chain wallet address" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const amountStrk = parseFloat(body.amountStrk);
    if (!Number.isFinite(amountStrk) || amountStrk <= 0) {
      return NextResponse.json(
        { ok: false, error: "amountStrk must be a positive number" },
        { status: 400 }
      );
    }

    const amountWei = BigInt(Math.floor(amountStrk * 1e18));
    const ownerAccount = getOwnerAccount();
    if (!ownerAccount) {
      return NextResponse.json(
        { ok: false, error: "Owner account not configured (missing AGENT_PRIVATE_KEY)" },
        { status: 500 }
      );
    }

    // Execute STRK ERC-20 transfer from parent → agent
    const result = await ownerAccount.execute({
      contractAddress: config.COLLATERAL_TOKEN_ADDRESS,
      entrypoint: "transfer",
      calldata: CallData.compile({
        recipient: agent.walletAddress,
        amount: { low: amountWei, high: 0n },
      }),
    });

    return NextResponse.json({
      ok: true,
      txHash: result.transaction_hash,
      amountStrk,
      recipient: agent.walletAddress,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Failed to fund agent" },
      { status: 500 }
    );
  }
}
