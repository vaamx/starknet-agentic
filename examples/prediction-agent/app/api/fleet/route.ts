/**
 * Fleet API — GET /api/fleet
 *
 * Returns fleet-wide stats + per-agent summaries.
 * Merges built-in agents with spawned agents, reads on-chain balances,
 * cross-references leaderboard Brier scores and action log.
 *
 * Optimized: balance reads + leaderboard run in parallel with 3s total cap.
 */

import { NextRequest, NextResponse } from "next/server";
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
import { hasAgentSigningMaterial } from "@/lib/agent-key-custody";
import { listRecentResearchArtifacts } from "@/lib/ops-store";
import { requireMembership } from "@/lib/require-auth";

// ── Cache ────────────────────────────────────────────────────────────────────

const fleetCache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL_MS = 15_000;

const HEARTBEAT_SOURCES = ["x", "espn", "rss", "onchain"] as const;
type HeartbeatSource = (typeof HEARTBEAT_SOURCES)[number];
type SourceFreshness = "fresh" | "stale" | "missing";

const SOURCE_STALE_AFTER_SECS: Record<HeartbeatSource, number> = {
  x: 20 * 60,
  espn: 30 * 60,
  rss: 45 * 60,
  onchain: 15 * 60,
};

const SOURCE_MISSING_AFTER_SECS: Record<HeartbeatSource, number> = {
  x: 3 * 60 * 60,
  espn: 4 * 60 * 60,
  rss: 6 * 60 * 60,
  onchain: 2 * 60 * 60,
};

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
    readiness: {
      walletLinkedAgents: number;
      fundedAgents: number;
      executableAgents: number;
      runtimeOnlineAgents: number;
      activeAgents1h: number;
      sourceCoverage: string[];
      sourceHeartbeat: {
        evaluatedAt: number;
        trackedSources: HeartbeatSource[];
        sourceStatus: Record<
          HeartbeatSource,
          {
            lastSeenAt: number | null;
            freshness: SourceFreshness;
            staleAfterSecs: number;
            coverageMarkets: number;
            sampleCount: number;
          }
        >;
        markets: Array<{
          marketId: number;
          lastSeenAt: number | null;
          freshness: SourceFreshness;
          sources: Record<
            HeartbeatSource,
            {
              lastSeenAt: number | null;
              freshness: SourceFreshness;
            }
          >;
        }>;
      } | null;
    };
  };
  agents: FleetAgentSummary[];
}

function emptySourceMap<T>(value: T): Record<HeartbeatSource, T> {
  return {
    x: value,
    espn: value,
    rss: value,
    onchain: value,
  };
}

function normalizeHeartbeatSource(rawSource: string): HeartbeatSource | null {
  const normalized = rawSource.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "x" || normalized === "twitter" || normalized.startsWith("x_")) {
    return "x";
  }
  if (normalized.includes("espn") || normalized === "sports") {
    return "espn";
  }
  if (
    normalized === "rss" ||
    normalized === "news" ||
    normalized === "web" ||
    normalized === "tavily"
  ) {
    return "rss";
  }
  if (normalized === "onchain" || normalized === "coingecko") {
    return "onchain";
  }
  return null;
}

function freshnessFromLastSeen(
  source: HeartbeatSource,
  lastSeenAt: number | null,
  nowSec: number
): SourceFreshness {
  if (!lastSeenAt || !Number.isFinite(lastSeenAt)) return "missing";
  const ageSec = Math.max(0, nowSec - lastSeenAt);
  if (ageSec <= SOURCE_STALE_AFTER_SECS[source]) return "fresh";
  if (ageSec <= SOURCE_MISSING_AFTER_SECS[source]) return "stale";
  return "missing";
}

function combineFreshness(
  values: SourceFreshness[]
): SourceFreshness {
  if (values.includes("fresh")) return "fresh";
  if (values.includes("stale")) return "stale";
  return "missing";
}

function parseSeedMarketIds(rawValue: string | null): number[] {
  if (!rawValue) return [];
  const next: number[] = [];
  const seen = new Set<number>();
  for (const part of rawValue.split(",")) {
    const parsed = Number(part.trim());
    if (!Number.isFinite(parsed) || parsed < 0) continue;
    const marketId = Math.trunc(parsed);
    if (seen.has(marketId)) continue;
    seen.add(marketId);
    next.push(marketId);
    if (next.length >= 120) break;
  }
  return next;
}

async function buildSourceHeartbeat(params: {
  organizationId: string;
  seedMarketIds: number[];
}): Promise<FleetResponse["fleet"]["readiness"]["sourceHeartbeat"]> {
  const nowSec = Math.floor(Date.now() / 1000);
  const artifacts = await listRecentResearchArtifacts(params.organizationId, 1_200);
  const byMarket = new Map<number, Record<HeartbeatSource, number | null>>();
  const sourceLatest = emptySourceMap<number | null>(null);
  const sourceSamples = emptySourceMap<number>(0);

  for (const marketId of params.seedMarketIds) {
    if (!Number.isFinite(marketId) || marketId < 0) continue;
    byMarket.set(Math.trunc(marketId), emptySourceMap<number | null>(null));
  }

  for (const row of artifacts) {
    if (typeof row.marketId !== "number" || !Number.isFinite(row.marketId)) continue;
    const source = normalizeHeartbeatSource(String(row.sourceType ?? ""));
    if (!source) continue;
    const createdAt = Number(row.createdAt);
    if (!Number.isFinite(createdAt) || createdAt <= 0) continue;
    const marketId = Math.max(0, Math.trunc(row.marketId));
    const marketSources = byMarket.get(marketId) ?? emptySourceMap<number | null>(null);
    const existing = marketSources[source];
    if (!existing || createdAt > existing) {
      marketSources[source] = createdAt;
      byMarket.set(marketId, marketSources);
    }
    const latest = sourceLatest[source];
    if (!latest || createdAt > latest) {
      sourceLatest[source] = createdAt;
    }
    sourceSamples[source] += 1;
  }

  const coverageMarkets = emptySourceMap<number>(0);
  for (const marketSources of byMarket.values()) {
    for (const source of HEARTBEAT_SOURCES) {
      if (typeof marketSources[source] === "number" && marketSources[source]! > 0) {
        coverageMarkets[source] += 1;
      }
    }
  }

  const sourceStatus = HEARTBEAT_SOURCES.reduce((acc, source) => {
    const lastSeenAt = sourceLatest[source];
    acc[source] = {
      lastSeenAt,
      freshness: freshnessFromLastSeen(source, lastSeenAt, nowSec),
      staleAfterSecs: SOURCE_STALE_AFTER_SECS[source],
      coverageMarkets: coverageMarkets[source],
      sampleCount: sourceSamples[source],
    };
    return acc;
  }, {} as NonNullable<FleetResponse["fleet"]["readiness"]["sourceHeartbeat"]>["sourceStatus"]);

  const markets = Array.from(byMarket.entries())
    .map(([marketId, sources]) => {
      const sourceEntries = HEARTBEAT_SOURCES.reduce((acc, source) => {
        const lastSeenAt = sources[source];
        acc[source] = {
          lastSeenAt,
          freshness: freshnessFromLastSeen(source, lastSeenAt, nowSec),
        };
        return acc;
      }, {} as NonNullable<FleetResponse["fleet"]["readiness"]["sourceHeartbeat"]>["markets"][number]["sources"]);
      const lastSeenAt = HEARTBEAT_SOURCES.reduce<number | null>((latest, source) => {
        const value = sourceEntries[source].lastSeenAt;
        if (typeof value !== "number") return latest;
        if (latest === null || value > latest) return value;
        return latest;
      }, null);
      return {
        marketId,
        lastSeenAt,
        freshness: combineFreshness(
          HEARTBEAT_SOURCES.map((source) => sourceEntries[source].freshness)
        ),
        sources: sourceEntries,
      };
    })
    .sort((a, b) => (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0));

  return {
    evaluatedAt: nowSec,
    trackedSources: [...HEARTBEAT_SOURCES],
    sourceStatus,
    markets,
  };
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const membership = requireMembership(request);
    const requestedMarketIds = parseSeedMarketIds(
      request.nextUrl.searchParams.get("marketIds")
    );
    const cacheKey = membership
      ? `org:${membership.membership.organizationId}:markets:${
          requestedMarketIds.length > 0 ? requestedMarketIds.join(",") : "default"
        }`
      : "anon";

    // Return cached if fresh
    const cached = fleetCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return NextResponse.json(cached.data);
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
    const activeMarketIds = new Set<number>();
    for (const action of recentActions) {
      const existing = lastActionMap.get(action.agentId);
      if (!existing || action.timestamp > existing) {
        lastActionMap.set(action.agentId, action.timestamp);
      }
      if (action.marketId !== undefined) {
        activeMarketIds.add(action.marketId);
        if (!activeMarketsMap.has(action.agentId)) {
          activeMarketsMap.set(action.agentId, new Set());
        }
        activeMarketsMap.get(action.agentId)!.add(action.marketId);
      }
    }

    const sourceHeartbeat = membership
      ? await buildSourceHeartbeat({
          organizationId: membership.membership.organizationId,
          seedMarketIds: Array.from(
            new Set([
              ...requestedMarketIds,
              ...Array.from(activeMarketIds),
            ])
          ).slice(0, 150),
        }).catch(() => null)
      : null;

    // 6. Build per-agent summaries
    let totalStrkWei = 0n;
    let brierSum = 0;
    let brierCount = 0;
    let fleetPnlWei = 0n;
    const tierDist: Record<string, number> = {
      thriving: 0, healthy: 0, low: 0, critical: 0, dead: 0,
    };
    let runningCount = 0;
    let walletLinkedAgents = 0;
    let fundedAgents = 0;
    let executableAgents = 0;
    let runtimeOnlineAgents = 0;
    let activeAgents1h = 0;
    const sourceCoverage = new Set<string>();
    const now = Date.now();

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
      if (agent.walletAddress) walletLinkedAgents++;
      if (balanceWei !== undefined && balanceWei > 0n) fundedAgents++;
      if (hasAgentSigningMaterial(agent)) executableAgents++;
      if (agent.runtime?.status === "running") runtimeOnlineAgents++;

      const lastActionAt =
        lastActionMap.get(agent.id) ?? lastActionMap.get(agent.persona.id) ?? null;
      if (lastActionAt && now - lastActionAt <= 60 * 60_000) activeAgents1h++;
      for (const source of agent.persona.preferredSources ?? []) {
        const normalizedSource = source.trim().toLowerCase();
        if (normalizedSource) sourceCoverage.add(normalizedSource);
      }

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
        lastActionAt,
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
        readiness: {
          walletLinkedAgents,
          fundedAgents,
          executableAgents,
          runtimeOnlineAgents,
          activeAgents1h,
          sourceCoverage: Array.from(sourceCoverage).sort(),
          sourceHeartbeat,
        },
      },
      agents,
    };

    fleetCache.set(cacheKey, { data: result, ts: Date.now() });
    if (fleetCache.size > 24) {
      const oldest = fleetCache.keys().next().value;
      if (oldest) fleetCache.delete(oldest);
    }
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Failed to fetch fleet" },
      { status: 500 }
    );
  }
}
