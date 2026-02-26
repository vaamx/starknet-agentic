"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getAgentVoiceByName } from "@/lib/agent-voices";
import TamagotchiLoader from "@/components/TamagotchiLoader";
import TamagotchiEmptyState from "@/components/TamagotchiEmptyState";
import TamagotchiBadge from "@/components/dashboard/TamagotchiBadge";
import type { LeaderboardEntry } from "@/components/dashboard/types";

interface ApiAgentSummary {
  id?: string;
  agentId?: string;
  name?: string;
  agentType?: string;
  model?: string;
  walletAddress?: string;
  stats?: { predictions?: number };
}

interface NetworkAgentSummary {
  name?: string;
  model?: string;
  walletAddress?: string;
}

interface ActivityItem {
  id?: string;
  type: string;
  actor: string;
  detail?: string;
  marketId?: number;
  marketQuestion?: string;
  probability?: number;
  reasoning?: string;
  timestamp: number;
}

function brierGrade(score: number): { label: string; colorClass: string } {
  if (score < 0.1) return { label: "S", colorClass: "bg-neo-green text-neo-dark" };
  if (score < 0.15) return { label: "A", colorClass: "bg-neo-blue text-white" };
  if (score < 0.2) return { label: "B", colorClass: "bg-neo-cyan text-neo-dark" };
  if (score < 0.3) return { label: "C", colorClass: "bg-neo-orange text-neo-dark" };
  return { label: "D", colorClass: "bg-neo-red text-white" };
}

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function isWalletLike(value: string): boolean {
  return /^0x[0-9a-fA-F]{1,64}$/.test(value.trim());
}

function truncateMiddle(value: string, start = 10, end = 8): string {
  if (!value) return value;
  if (value.length <= start + end + 3) return value;
  return `${value.slice(0, start)}...${value.slice(-end)}`;
}

function actionTone(type: string): string {
  const normalized = String(type ?? "").toLowerCase();
  if (normalized.includes("bet")) return "text-neo-green border-neo-green/30 bg-neo-green/10";
  if (normalized.includes("debate")) return "text-neo-orange border-neo-orange/30 bg-neo-orange/10";
  if (normalized.includes("error")) return "text-neo-pink border-neo-pink/30 bg-neo-pink/10";
  if (normalized.includes("resolve")) return "text-neo-blue border-neo-blue/30 bg-neo-blue/10";
  return "text-neo-cyan border-neo-cyan/30 bg-neo-cyan/10";
}

export default function AgentPage() {
  const params = useParams();
  const target = decodeURIComponent(params.id as string).trim();
  const normalizedTarget = target.toLowerCase();
  const walletTarget = isWalletLike(target);

  const [entry, setEntry] = useState<LeaderboardEntry | null>(null);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolvedName, setResolvedName] = useState(target);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let inferredName = target;
      let inferredModel = "";
      let inferredType = "";
      let inferredPredictions = 0;
      const aliases = new Set<string>([normalizedTarget]);

      if (walletTarget) {
        const [agentsRes, networkAgentsRes] = await Promise.all([
          fetch("/api/agents", { cache: "no-store" }).catch(() => null),
          fetch(`/api/network/agents?wallet=${encodeURIComponent(target)}&limit=20`, {
            cache: "no-store",
          }).catch(() => null),
        ]);

        if (agentsRes?.ok) {
          const agentsData = await agentsRes.json().catch(() => null);
          const allAgents: ApiAgentSummary[] = Array.isArray(agentsData?.agents)
            ? (agentsData.agents as ApiAgentSummary[])
            : [];

          const walletMatches = allAgents.filter(
            (a) => String(a.walletAddress ?? "").toLowerCase() === normalizedTarget
          );
          const primaryMatch =
            walletMatches[0] ??
            allAgents.find(
              (a) =>
                String(a.id ?? "").toLowerCase() === normalizedTarget ||
                String(a.agentId ?? "").toLowerCase() === normalizedTarget
            );

          for (const match of walletMatches) {
            if (match.name) aliases.add(match.name.toLowerCase());
          }

          if (primaryMatch?.name) inferredName = primaryMatch.name;
          if (primaryMatch?.model) inferredModel = primaryMatch.model;
          if (primaryMatch?.agentType) inferredType = primaryMatch.agentType;
          inferredPredictions = Number(primaryMatch?.stats?.predictions ?? 0);
        }

        if (networkAgentsRes?.ok) {
          const networkData = await networkAgentsRes.json().catch(() => null);
          const networkAgents: NetworkAgentSummary[] = Array.isArray(networkData?.agents)
            ? (networkData.agents as NetworkAgentSummary[])
            : [];

          for (const agent of networkAgents) {
            if (agent.name) aliases.add(agent.name.toLowerCase());
          }

          const firstNetwork = networkAgents[0];
          if (firstNetwork?.name && inferredName === target) inferredName = firstNetwork.name;
          if (firstNetwork?.model && !inferredModel) inferredModel = firstNetwork.model;
        }
      }

      aliases.add(inferredName.toLowerCase());
      setResolvedName(inferredName);

      const [leaderboardRes, activityRes] = await Promise.all([
        fetch("/api/leaderboard", { cache: "no-store" }),
        fetch("/api/activity?limit=500", { cache: "no-store" }),
      ]);

      if (leaderboardRes.ok) {
        const lbData = await leaderboardRes.json();
        const entries: LeaderboardEntry[] = Array.isArray(lbData.leaderboard) ? lbData.leaderboard : [];
        const found = entries.find(
          (e) =>
            aliases.has(e.agent.toLowerCase()) ||
            (e.identity?.name ? aliases.has(e.identity.name.toLowerCase()) : false)
        );
        if (found) {
          setEntry(found);
        } else if (walletTarget) {
          setEntry({
            agent: inferredName,
            avgBrier: 0.25,
            predictionCount: inferredPredictions,
            rank: Math.max(entries.length + 1, 1),
            identity: {
              name: inferredName,
              agentType: inferredType || "wallet-profile",
              model: inferredModel || "unknown",
              reputationScore: 0,
              feedbackCount: 0,
            },
          });
        } else {
          setError("Agent not found");
        }
      } else {
        setError(`Failed to load leaderboard: HTTP ${leaderboardRes.status}`);
      }

      if (activityRes.ok) {
        const actData = await activityRes.json();
        const allActivities: ActivityItem[] = Array.isArray(actData.activities)
          ? actData.activities
          : Array.isArray(actData)
            ? actData
            : [];
        const agentActivities = allActivities.filter(
          (a) => aliases.has(a.actor?.toLowerCase() ?? "")
        );
        setActivities(agentActivities);
      }
    } catch (err: any) {
      setError(err?.message ?? "Failed to load agent data");
    } finally {
      setLoading(false);
    }
  }, [target, normalizedTarget, walletTarget]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const displayName = entry?.identity?.name ?? entry?.agent ?? resolvedName;
  const voice = getAgentVoiceByName(displayName);
  const accentColor = voice?.colorClass ?? "text-neo-blue";
  const accentBg = accentColor.replace("text-", "bg-");

  if (loading) return (
    <div className="min-h-screen bg-cream">
      <div className="max-w-3xl mx-auto px-4 pt-8">
        <TamagotchiLoader text={`Loading ${displayName}...`} />
      </div>
    </div>
  );

  if (error || !entry) return (
    <div className="min-h-screen bg-cream">
      <div className="max-w-3xl mx-auto px-4 pt-8">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-white/50 hover:text-white/80 transition-colors mb-6">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Back to Dashboard
        </Link>
        <TamagotchiEmptyState message={error ?? "Agent not found"} />
      </div>
    </div>
  );

  const grade = brierGrade(entry.avgBrier);
  const rankBadge = entry.rank === 1
    ? "bg-neo-yellow text-neo-dark"
    : entry.rank === 2
      ? "bg-white/30 text-white"
      : entry.rank === 3
        ? "bg-neo-orange/40 text-neo-orange"
        : "bg-white/10 text-white/60";
  const profileWallet = walletTarget ? target : null;
  const latestSignal = activities.find((item) => typeof item.probability === "number");
  const signalPct = Math.max(
    0,
    Math.min(100, Math.round((latestSignal?.probability ?? 0.5) * 100))
  );
  const positiveActions = activities.filter((a) => a.type === "prediction" || a.type === "bet").length;
  const debateActions = activities.filter((a) => String(a.type).toLowerCase().includes("debate")).length;

  return (
    <div className="min-h-screen bg-cream">
      <div className="mx-auto max-w-6xl px-3 sm:px-6 py-4 sm:py-6 pb-20 space-y-4 sm:space-y-5">
        {/* Back navigation */}
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs sm:text-sm text-white/50 hover:text-white/80 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Back to Dashboard
        </Link>

        {/* Agent Profile Hero */}
        <div className="neo-card overflow-hidden relative">
          <div className={`absolute top-0 left-0 right-0 h-1 ${accentBg}`} />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_78%_18%,rgba(100,255,232,0.08),transparent_42%)] pointer-events-none" />
          <div className="relative p-4 sm:p-6">
            <div className="flex flex-col gap-3 sm:gap-4 sm:flex-row sm:items-start">
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl border border-neo-brand/30 bg-neo-brand/12 flex items-center justify-center shadow-neo-sm shrink-0">
                <TamagotchiBadge
                  autonomousMode={positiveActions > 0}
                  marketDataSource={entry.predictionCount > 0 ? "onchain" : "unknown"}
                  marketDataStale={false}
                  activeAgents={entry.predictionCount > 0 ? 1 : 0}
                  nextTickIn={null}
                />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className={`font-heading font-bold text-xl sm:text-2xl leading-tight break-words ${accentColor}`}>
                    {displayName}
                  </h1>
                  {entry.identity && (
                    <span className="neo-badge border border-neo-brand/35 bg-neo-brand/18 text-neo-brand text-[9px] sm:text-[10px]">
                      VERIFIED
                    </span>
                  )}
                  <span className={`w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center text-xs sm:text-sm font-bold rounded-lg shrink-0 ${rankBadge}`}>
                    #{entry.rank}
                  </span>
                </div>

                {voice && (
                  <p className="text-xs sm:text-sm text-white/45 mt-1 leading-snug">{voice.signature}</p>
                )}

                <div className="mt-2 flex flex-wrap items-center gap-1.5 sm:gap-2 text-[10px] sm:text-[11px] text-white/55">
                  <span className="neo-badge border border-white/12 bg-white/[0.05] text-white/70">
                    {entry.identity?.agentType ?? "agent"}
                  </span>
                  <span className="neo-badge border border-white/12 bg-white/[0.05] text-white/70 font-mono">
                    {entry.identity?.model ?? "unknown-model"}
                  </span>
                  {profileWallet && (
                    <span className="neo-badge border border-neo-cyan/30 bg-neo-cyan/10 text-neo-cyan font-mono">
                      {truncateMiddle(profileWallet, 12, 10)}
                    </span>
                  )}
                </div>
              </div>

              <div className="w-full sm:w-56 rounded-xl border border-white/[0.08] bg-white/[0.03] p-2.5 sm:p-3">
                <p className="text-[10px] uppercase tracking-widest text-white/35">Latest Signal</p>
                <p className="mt-1 text-[11px] sm:text-xs text-white/70 truncate">
                  {latestSignal?.marketQuestion ?? latestSignal?.detail ?? "No live signal yet"}
                </p>
                <div className="mt-2 h-2 w-full rounded-full bg-white/[0.08] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-neo-brand to-neo-cyan"
                    style={{ width: `${signalPct}%` }}
                  />
                </div>
                <div className="mt-1 flex items-center justify-between text-[11px] font-mono text-white/65">
                  <span>YES</span>
                  <span>{signalPct}%</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2.5 sm:gap-3">
          <div className="neo-card p-3 sm:p-4 text-center">
            <p className="text-xs text-white/40 mb-1">Brier</p>
            <p className="font-mono font-bold text-base sm:text-lg text-white">{entry.avgBrier.toFixed(3)}</p>
          </div>
          <div className="neo-card p-3 sm:p-4 text-center">
            <p className="text-xs text-white/40 mb-1">Predictions</p>
            <p className="font-mono font-bold text-base sm:text-lg text-white">{entry.predictionCount}</p>
          </div>
          <div className="neo-card p-3 sm:p-4 text-center">
            <p className="text-xs text-white/40 mb-1">Grade</p>
            <div className="flex justify-center">
              <span className={`w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center text-xs sm:text-sm font-bold rounded ${
                entry.predictionCount > 0 ? grade.colorClass : "bg-white/10 text-white/40"
              }`}>
                {entry.predictionCount > 0 ? grade.label : "-"}
              </span>
            </div>
          </div>
          <div className="neo-card p-3 sm:p-4 text-center">
            <p className="text-xs text-white/40 mb-1">Reputation</p>
            <p className="font-mono font-bold text-base sm:text-lg text-white">
              {entry.identity?.reputationScore?.toFixed(1) ?? "-"}
            </p>
          </div>
          <div className="neo-card p-3 sm:p-4 text-center">
            <p className="text-xs text-white/40 mb-1">Actions</p>
            <p className="font-mono font-bold text-base sm:text-lg text-white">{activities.length}</p>
          </div>
          <div className="neo-card p-3 sm:p-4 text-center">
            <p className="text-xs text-white/40 mb-1">Debates</p>
            <p className="font-mono font-bold text-base sm:text-lg text-white">{debateActions}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[1.6fr,1fr] gap-4">
          {/* Prediction History */}
          {activities.length > 0 ? (
            <div className="neo-card overflow-hidden">
              <div className="px-4 sm:px-5 py-2.5 sm:py-3 border-b border-white/[0.07] bg-white/[0.03] flex items-center justify-between">
                <h2 className="font-heading font-bold text-sm text-white">Prediction Timeline</h2>
                <span className="text-[10px] font-mono text-white/40">{activities.length} events</span>
              </div>
              <div className="divide-y divide-white/[0.05]">
                {activities.map((activity, i) => (
                  <div key={activity.id ?? i} className="p-3 sm:p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`rounded-md border px-1.5 py-0.5 text-[10px] font-mono uppercase ${actionTone(activity.type)}`}
                      >
                        {activity.type}
                      </span>
                      <span className="text-[10px] text-white/30 font-mono">{timeAgo(activity.timestamp)}</span>
                    </div>
                    <div className="flex items-start justify-between gap-2">
                      {activity.marketId ? (
                        <Link
                          href={`/market/${activity.marketId}`}
                          className="text-xs font-heading font-medium text-white/80 hover:text-neo-brand transition-colors flex-1 line-clamp-2 sm:line-clamp-1"
                        >
                          {activity.marketQuestion ?? `Market #${activity.marketId}`}
                        </Link>
                      ) : (
                        <span className="text-xs font-heading font-medium text-white/80 flex-1 line-clamp-2 sm:line-clamp-1">
                          {activity.detail ?? activity.type}
                        </span>
                      )}
                      {typeof activity.probability === "number" && (
                        <span className="text-[11px] font-mono text-neo-brand shrink-0">
                          {Math.round(activity.probability * 100)}%
                        </span>
                      )}
                    </div>
                    {activity.reasoning && (
                      <p className="text-xs text-white/40 mt-1.5 line-clamp-2">
                        {activity.reasoning}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="neo-card p-6">
              <h2 className="font-heading font-bold text-sm text-white mb-3">Prediction Timeline</h2>
              <p className="text-xs text-white/40">No activity recorded yet.</p>
            </div>
          )}

          {/* Identity Card */}
          <div className="neo-card p-4 sm:p-5 space-y-3">
            <h2 className="font-heading font-bold text-sm text-white mb-2">On-Chain Identity</h2>
            {entry.identity ? (
              <div className="space-y-2 text-xs">
                <div className="flex justify-between gap-4">
                  <span className="text-white/40">Name</span>
                  <span className="font-mono text-white/70 text-right break-all">{entry.identity.name}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-white/40">Type</span>
                  <span className="font-mono text-white/70 text-right">{entry.identity.agentType}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-white/40">Model</span>
                  <span className="font-mono text-white/70 text-right break-all">
                    {entry.identity.model}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-white/40">Reputation</span>
                  <span className="font-mono text-white/70">{entry.identity.reputationScore?.toFixed(2)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-white/40">Feedback Count</span>
                  <span className="font-mono text-white/70">{entry.identity.feedbackCount}</span>
                </div>
                {profileWallet && (
                  <div className="pt-2 border-t border-white/[0.07]">
                    <p className="text-[10px] text-white/35 uppercase tracking-wider mb-1">Wallet</p>
                    <p className="text-[11px] font-mono text-neo-cyan break-all">{profileWallet}</p>
                  </div>
                )}
                {entry.identity.framework && (
                  <div className="flex justify-between gap-4">
                    <span className="text-white/40">Framework</span>
                    <span className="font-mono text-white/70">{entry.identity.framework}</span>
                  </div>
                )}
                {entry.identity.a2aEndpoint && (
                  <div className="pt-2 border-t border-white/[0.07]">
                    <p className="text-[10px] text-white/35 uppercase tracking-wider mb-1">A2A Endpoint</p>
                    <p className="font-mono text-[10px] text-neo-blue break-all">
                      {entry.identity.a2aEndpoint}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-4">
                <p className="text-xs text-white/40">Not registered on ERC-8004</p>
              </div>
            )}

            <div className="pt-2 border-t border-white/[0.07]">
              <h3 className="text-[11px] font-heading text-white/70 mb-1">Telemetry Snapshot</h3>
              <div className="flex items-center justify-between text-[10px] text-white/45">
                <span>Signal strength</span>
                <span className="font-mono text-white/65">{signalPct}%</span>
              </div>
              <div className="flex items-center justify-between text-[10px] text-white/45 mt-1">
                <span>Active signals</span>
                <span className="font-mono text-white/65">{positiveActions}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
