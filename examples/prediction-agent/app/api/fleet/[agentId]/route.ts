/**
 * Fleet Agent Detail + Control — GET/PATCH /api/fleet/[agentId]
 *
 * GET  — Full agent detail: persona, recent actions, market breakdown
 * PATCH — Control: pause/resume/stop/configure
 */

import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import {
  agentSpawner,
  getBuiltInAgents,
  serializeAgent,
  type SpawnedAgent,
} from "@/lib/agent-spawner";
import {
  ensureAgentSpawnerHydrated,
  persistAgentSpawner,
} from "@/lib/agent-persistence";
import {
  readStrkBalance,
  balanceToRawTier,
} from "@/lib/survival-engine";
import { agentLoop, type AgentAction } from "@/lib/agent-loop";
import { requireWalletSessionScope } from "@/lib/wallet-session";

function findAgent(agentId: string): SpawnedAgent | null {
  // Check spawned first
  const spawned = agentSpawner.getAgent(agentId);
  if (spawned) return spawned;

  // Check built-in
  const builtIn = getBuiltInAgents().find(
    (a) => a.id === agentId || a.persona.id === agentId
  );
  return builtIn ?? null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const { agentId } = await params;
    await ensureAgentSpawnerHydrated();

    const agent = findAgent(agentId);
    if (!agent) {
      return NextResponse.json(
        { ok: false, error: "Agent not found" },
        { status: 404 }
      );
    }

    // Balance + tier
    let balanceStrk: number | null = null;
    let tier: string | null = null;
    if (agent.walletAddress) {
      try {
        const balanceWei = await Promise.race([
          readStrkBalance(agent.walletAddress),
          new Promise<bigint>((_, reject) =>
            setTimeout(() => reject(new Error("timeout")), 3000)
          ),
        ]);
        balanceStrk = Number(balanceWei) / 1e18;
        tier = balanceToRawTier(balanceWei);
      } catch {
        // balance read failed — continue
      }
    }

    // Recent actions for this agent (last 50)
    const allActions = agentLoop.getActionLog(200);
    const agentActions = allActions
      .filter(
        (a: AgentAction) =>
          a.agentId === agent.id || a.agentId === agent.persona.id
      )
      .slice(-50);

    // Market breakdown: count actions per market
    const marketBreakdown = new Map<number, { question: string; predictions: number; bets: number }>();
    for (const action of agentActions) {
      if (action.marketId === undefined) continue;
      const existing = marketBreakdown.get(action.marketId) ?? {
        question: action.question ?? `Market #${action.marketId}`,
        predictions: 0,
        bets: 0,
      };
      if (action.type === "prediction") existing.predictions++;
      if (action.type === "bet") existing.bets++;
      marketBreakdown.set(action.marketId, existing);
    }

    const serialized = serializeAgent(agent);

    return NextResponse.json({
      ok: true,
      agent: {
        ...serialized,
        balanceStrk,
        tier,
        recentActions: agentActions.map((a) => ({
          id: a.id,
          timestamp: a.timestamp,
          type: a.type,
          marketId: a.marketId,
          question: a.question,
          detail: a.detail,
          probability: a.probability,
          betAmount: a.betAmount,
          betOutcome: a.betOutcome,
          txHash: a.txHash,
        })),
        marketBreakdown: Array.from(marketBreakdown.entries()).map(
          ([marketId, data]) => ({
            marketId,
            ...data,
          })
        ),
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Failed to fetch agent detail" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const auth = requireWalletSessionScope(request, "spawn");
    if (!auth.ok) return auth.response;
    const { agentId } = await params;
    await ensureAgentSpawnerHydrated();

    const agent = agentSpawner.getAgent(agentId);
    if (!agent) {
      // Check if it's a built-in agent
      const builtIn = getBuiltInAgents().find(
        (a) => a.id === agentId || a.persona.id === agentId
      );
      if (builtIn) {
        return NextResponse.json(
          { ok: false, error: "Built-in agents cannot be controlled" },
          { status: 400 }
        );
      }
      return NextResponse.json(
        { ok: false, error: "Agent not found" },
        { status: 404 }
      );
    }

    const body = await request.json();
    const { action, budget } = body;

    if (action === "pause") {
      agentSpawner.pause(agentId);
    } else if (action === "resume") {
      agentSpawner.resume(agentId);
    } else if (action === "stop") {
      agentSpawner.stop(agentId);
    } else if (action === "configure" && budget) {
      const update: { totalBudget?: bigint; maxBetSize?: bigint } = {};
      if (budget.totalBudgetStrk !== undefined) {
        update.totalBudget = BigInt(Math.floor(budget.totalBudgetStrk * 1e18));
      }
      if (budget.maxBetStrk !== undefined) {
        update.maxBetSize = BigInt(Math.floor(budget.maxBetStrk * 1e18));
      }
      agentSpawner.updateBudget(agentId, update);
    } else {
      return NextResponse.json(
        { ok: false, error: "Invalid action. Use: pause, resume, stop, configure" },
        { status: 400 }
      );
    }

    await persistAgentSpawner();

    return NextResponse.json({
      ok: true,
      agent: serializeAgent(agent),
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Failed to update agent" },
      { status: 500 }
    );
  }
}
