/**
 * Fleet API — GET /api/fleet
 *
 * Returns fleet-wide stats + per-agent summaries.
 * Merges built-in agents with spawned agents, reads on-chain balances,
 * cross-references leaderboard Brier scores and action log.
 *
 * Optimized: balance reads + leaderboard run in parallel with 3s total cap.
 */

import { NextResponse } from "next/server";
import {
  agentSpawner,
  getBuiltInAgents,
  type SpawnedAgent,
} from "@/lib/agent-spawner";
import {
  ensureAgentSpawnerHydrated,
} from "@/lib/agent-persistence";
import {
  readStrkBalance,
  balanceToRawTier,
  type SurvivalTier,
} from "@/lib/survival-engine";
import { getOnChainLeaderboard, type LeaderboardEntry } from "@/lib/market-reader";
import { agentLoop, type AgentAction } from "@/lib/agent-loop";

// ── Cache ────────────────────────────────────────────────────────────────────

let fleetCache: { data: unknown; ts: number } | null = null;
const CACHE_TTL_MS = 15_000;

// ── Types ────────────────────────────────────────────────────────────────────

interface FleetAgentSummary {
  id: string;
  name: string;
  isBuiltIn: boolean;
  status: string;
  agentType: string;
  model: string;
  walletAddress: string | null;
  balanceStrk: number | null;
  tier: SurvivalTier | null;
  brierScore: number | null;
  brierRank: number | null;
  stats: { predictions: number; bets: number; pnl: string };
  lastActionAt: number | null;
  activeMarkets: number;
  agentId: string | null;
  preferredSources: string[];
  biasFactor: number;
  confidence: number;
  runtime: unknown;
  createdAt: number;
}

interface FleetResponse {
  fleet: {
    totalAgents: number;
    runningAgents: number;
    totalStrkHuman: number;
    avgBrierScore: number | null;
    tierDistribution: Record<string, number>;
    fleetPnl: string;
  };
  agents: FleetAgentSummary[];
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function GET() {
  try {
    // Return cached if fresh
    if (fleetCache && Date.now() - fleetCache.ts < CACHE_TTL_MS) {
      return NextResponse.json(fleetCache.data);
    }

    await ensureAgentSpawnerHydrated();

    // 1. Merge built-in + spawned
    const builtIn = getBuiltInAgents();
    const spawned = agentSpawner.list();
    const allAgents: SpawnedAgent[] = [...builtIn, ...spawned];

    // 2. Kick off balance reads + leaderboard in PARALLEL with 3s total cap
    const walleted = allAgents
      .map((a, i) => ({ agent: a, idx: i }))
      .filter((x) => !!x.agent.walletAddress);

    const balancePromise = walleted.length > 0
      ? Promise.allSettled(
          walleted.map(async (item) => {
            try {
              return await Promise.race([
                readStrkBalance(item.agent.walletAddress!),
                new Promise<bigint>((_, rej) => setTimeout(() => rej("timeout"), 2000)),
              ]);
            } catch {
              return null;
            }
          })
        )
      : Promise.resolve([]);

    const leaderboardPromise: Promise<LeaderboardEntry[]> = Promise.race([
      getOnChainLeaderboard(),
      new Promise<LeaderboardEntry[]>((resolve) =>
        setTimeout(() => resolve([]), 3_000)
      ),
    ]).catch(() => []);

    // Wait for both in parallel — max 3s
    const [balanceResults, leaderboard] = await Promise.all([
      balancePromise,
      leaderboardPromise,
    ]);

    // 3. Process balance results
    const balanceMap = new Map<number, bigint>();
    walleted.forEach((item, bi) => {
      const result = balanceResults[bi];
      if (result && "status" in result && result.status === "fulfilled" && result.value !== null) {
        balanceMap.set(item.idx, result.value as bigint);
      }
    });

    // 4. Leaderboard lookup
    const brierMap = new Map<string, LeaderboardEntry>();
    for (const entry of leaderboard) {
      brierMap.set(entry.agent, entry);
    }

    // 5. Action log (in-memory, instant)
    const recentActions: AgentAction[] = agentLoop.getActionLog(200);
    const lastActionMap = new Map<string, number>();
    const activeMarketsMap = new Map<string, Set<number>>();
    for (const action of recentActions) {
      const existing = lastActionMap.get(action.agentId);
      if (!existing || action.timestamp > existing) {
        lastActionMap.set(action.agentId, action.timestamp);
      }
      if (action.marketId !== undefined) {
        if (!activeMarketsMap.has(action.agentId)) {
          activeMarketsMap.set(action.agentId, new Set());
        }
        activeMarketsMap.get(action.agentId)!.add(action.marketId);
      }
    }

    // 6. Build per-agent summaries
    let totalStrkWei = 0n;
    let brierSum = 0;
    let brierCount = 0;
    let fleetPnlWei = 0n;
    const tierDist: Record<string, number> = {
      thriving: 0, healthy: 0, low: 0, critical: 0, dead: 0,
    };
    let runningCount = 0;

    const agents: FleetAgentSummary[] = allAgents.map((agent, i) => {
      const balanceWei = balanceMap.get(i);
      const balanceStrk = balanceWei !== undefined ? Number(balanceWei) / 1e18 : null;
      const tier = balanceWei !== undefined ? balanceToRawTier(balanceWei) : null;
      const brierEntry = brierMap.get(agent.persona.id) ?? brierMap.get(agent.id);
      const brierScore = brierEntry?.avgBrier ?? null;
      const brierRank = brierEntry?.rank ?? null;

      if (balanceWei !== undefined) {
        totalStrkWei += balanceWei;
        if (tier) tierDist[tier] = (tierDist[tier] ?? 0) + 1;
      }
      if (brierScore !== null) { brierSum += brierScore; brierCount++; }
      if (agent.status === "running") runningCount++;
      fleetPnlWei += agent.stats.pnl;

      return {
        id: agent.id,
        name: agent.name,
        isBuiltIn: agent.isBuiltIn ?? false,
        status: agent.status,
        agentType: agent.persona.agentType,
        model: agent.persona.model,
        walletAddress: agent.walletAddress ?? null,
        balanceStrk,
        tier,
        brierScore,
        brierRank,
        stats: {
          predictions: agent.stats.predictions,
          bets: agent.stats.bets,
          pnl: agent.stats.pnl.toString(),
        },
        lastActionAt: lastActionMap.get(agent.id) ?? lastActionMap.get(agent.persona.id) ?? null,
        activeMarkets: activeMarketsMap.get(agent.id)?.size ?? activeMarketsMap.get(agent.persona.id)?.size ?? 0,
        agentId: agent.agentId?.toString() ?? null,
        preferredSources: agent.persona.preferredSources ?? [],
        biasFactor: agent.persona.biasFactor,
        confidence: agent.persona.confidence,
        runtime: agent.runtime
          ? { provider: agent.runtime.provider, status: agent.runtime.status, region: agent.runtime.region, tier: agent.runtime.tier }
          : null,
        createdAt: agent.createdAt,
      };
    });

    const result: FleetResponse = {
      fleet: {
        totalAgents: allAgents.length,
        runningAgents: runningCount,
        totalStrkHuman: Number(totalStrkWei) / 1e18,
        avgBrierScore: brierCount > 0 ? brierSum / brierCount : null,
        tierDistribution: tierDist,
        fleetPnl: fleetPnlWei.toString(),
      },
      agents,
    };

    fleetCache = { data: result, ts: Date.now() };
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Failed to fetch fleet" },
      { status: 500 }
    );
  }
}
