import { NextRequest } from "next/server";
import { enforceRateLimit } from "@/lib/api-guard";
import {
  getPersistedMarketSnapshots,
  listPersistedNetworkAgents,
  listPersistedNetworkContributions,
} from "@/lib/state-store";

export const runtime = "nodejs";

type RewardAccumulator = {
  actorId: string;
  actorName: string;
  actorType: "agent" | "human";
  walletAddress?: string;
  points: number;
  totalContributions: number;
  forecastCount: number;
  resolvedForecasts: number;
  brierSum: number;
  marketCreations: number;
  debates: number;
  bets: number;
  lastContributionAt: number;
};

function resolvedMarketOutcome(
  winningOutcome: number | undefined
): 0 | 1 | null {
  if (winningOutcome === 0) return 0;
  if (winningOutcome === 1) return 1;
  return null;
}

export async function GET(request: NextRequest) {
  const rateLimited = await enforceRateLimit(request, "network_rewards_get", {
    windowMs: 60_000,
    maxRequests: 120,
  });
  if (rateLimited) return rateLimited;

  const limitRaw = request.nextUrl.searchParams.get("limit");
  const limit = Number.parseInt(limitRaw ?? "100", 10);

  const [profiles, contributions, snapshots] = await Promise.all([
    listPersistedNetworkAgents(2000),
    listPersistedNetworkContributions({ limit: 20_000 }),
    getPersistedMarketSnapshots(2000),
  ]);

  const marketOutcome = new Map<number, 0 | 1 | null>();
  for (const snapshot of snapshots) {
    marketOutcome.set(snapshot.id, resolvedMarketOutcome(snapshot.winningOutcome));
  }

  const profileById = new Map(profiles.map((profile) => [profile.id, profile] as const));
  const scores = new Map<string, RewardAccumulator>();

  const ensureActor = (entry: {
    actorType: "agent" | "human";
    agentId?: string;
    actorName: string;
    walletAddress?: string;
  }): RewardAccumulator => {
    const fallbackKey = `${entry.actorType}:${entry.walletAddress ?? entry.actorName.toLowerCase()}`;
    const actorId = entry.agentId || fallbackKey;
    const existing = scores.get(actorId);
    if (existing) return existing;
    const profile = entry.agentId ? profileById.get(entry.agentId) : undefined;
    const next: RewardAccumulator = {
      actorId,
      actorName: profile?.name ?? entry.actorName,
      actorType: entry.actorType,
      walletAddress: profile?.walletAddress ?? entry.walletAddress,
      points: 0,
      totalContributions: 0,
      forecastCount: 0,
      resolvedForecasts: 0,
      brierSum: 0,
      marketCreations: 0,
      debates: 0,
      bets: 0,
      lastContributionAt: 0,
    };
    scores.set(actorId, next);
    return next;
  };

  for (const contribution of contributions) {
    const acc = ensureActor({
      actorType: contribution.actorType,
      agentId: contribution.agentId,
      actorName: contribution.actorName,
      walletAddress: contribution.walletAddress,
    });
    acc.totalContributions += 1;
    acc.lastContributionAt = Math.max(acc.lastContributionAt, contribution.createdAt);

    if (contribution.kind === "forecast" && typeof contribution.probability === "number") {
      acc.forecastCount += 1;
      const outcome = contribution.marketId !== undefined
        ? marketOutcome.get(contribution.marketId)
        : null;
      if (outcome === 0 || outcome === 1) {
        const brier = Math.pow(contribution.probability - outcome, 2);
        const quality = Math.max(0, 1 - brier);
        acc.brierSum += brier;
        acc.resolvedForecasts += 1;
        acc.points += Math.round(quality * 100);
      } else {
        acc.points += 5;
      }
      continue;
    }

    if (contribution.kind === "market") {
      acc.marketCreations += 1;
      acc.points += 25;
      continue;
    }

    if (contribution.kind === "bet") {
      acc.bets += 1;
      acc.points += contribution.txHash ? 12 : 4;
      continue;
    }

    acc.debates += 1;
    acc.points += 6;
  }

  const leaderboard = Array.from(scores.values())
    .map((acc) => ({
      actorId: acc.actorId,
      actorName: acc.actorName,
      actorType: acc.actorType,
      walletAddress: acc.walletAddress ?? null,
      points: acc.points,
      totalContributions: acc.totalContributions,
      forecastCount: acc.forecastCount,
      resolvedForecasts: acc.resolvedForecasts,
      avgBrier:
        acc.resolvedForecasts > 0 ? acc.brierSum / acc.resolvedForecasts : null,
      marketCreations: acc.marketCreations,
      debates: acc.debates,
      bets: acc.bets,
      lastContributionAt: acc.lastContributionAt || null,
    }))
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.resolvedForecasts !== a.resolvedForecasts) {
        return b.resolvedForecasts - a.resolvedForecasts;
      }
      return (b.lastContributionAt ?? 0) - (a.lastContributionAt ?? 0);
    })
    .slice(0, Number.isFinite(limit) ? Math.max(1, limit) : 100);

  return Response.json({
    ok: true,
    leaderboard,
    count: leaderboard.length,
  });
}
