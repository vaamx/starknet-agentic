"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getAgentVoiceByName } from "@/lib/agent-voices";
import TamagotchiLoader from "@/components/TamagotchiLoader";
import TamagotchiEmptyState from "@/components/TamagotchiEmptyState";
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
        : "bg-white/10 text-white/50";

  return (
    <div className="min-h-screen bg-cream">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 pb-20 space-y-5">
        {/* Back navigation */}
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-white/50 hover:text-white/80 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Back to Dashboard
        </Link>

        {/* Agent Profile Header */}
        <div className="neo-card p-5 sm:p-6 overflow-hidden relative">
          {/* Accent stripe */}
          <div className={`absolute top-0 left-0 right-0 h-1 ${accentBg}`} />

          <div className="flex items-start gap-4 mt-1">
            {/* Rank badge */}
            <div className={`w-10 h-10 flex items-center justify-center text-sm font-bold rounded-lg shrink-0 ${rankBadge}`}>
              #{entry.rank}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className={`font-heading font-bold text-xl ${accentColor}`}>
                  {entry.identity?.name ?? entry.agent}
                </h1>
                {entry.identity && (
                  <span className="w-5 h-5 flex items-center justify-center bg-neo-brand/20 text-neo-brand text-[8px] font-bold rounded" title="ERC-8004 verified">
                    V
                  </span>
                )}
              </div>
              {voice && (
                <p className="text-xs text-white/40 mt-0.5">{voice.signature}</p>
              )}
              {entry.identity?.model && (
                <p className="text-xs text-white/30 mt-0.5 font-mono">{entry.identity.model}</p>
              )}
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="neo-card p-4 text-center">
            <p className="text-xs text-white/40 mb-1">Brier Score</p>
            <p className="font-mono font-bold text-lg text-white">{entry.avgBrier.toFixed(3)}</p>
          </div>
          <div className="neo-card p-4 text-center">
            <p className="text-xs text-white/40 mb-1">Predictions</p>
            <p className="font-mono font-bold text-lg text-white">{entry.predictionCount}</p>
          </div>
          <div className="neo-card p-4 text-center">
            <p className="text-xs text-white/40 mb-1">Grade</p>
            <div className="flex justify-center">
              <span className={`w-8 h-8 flex items-center justify-center text-sm font-bold rounded ${
                entry.predictionCount > 0 ? grade.colorClass : "bg-white/10 text-white/40"
              }`}>
                {entry.predictionCount > 0 ? grade.label : "-"}
              </span>
            </div>
          </div>
          <div className="neo-card p-4 text-center">
            <p className="text-xs text-white/40 mb-1">Reputation</p>
            <p className="font-mono font-bold text-lg text-white">
              {entry.identity?.reputationScore?.toFixed(1) ?? "-"}
            </p>
          </div>
        </div>

        {/* Prediction History */}
        {activities.length > 0 ? (
          <div className="neo-card overflow-hidden">
            <div className="px-5 py-3 border-b border-white/[0.07] bg-white/[0.03]">
              <h2 className="font-heading font-bold text-sm text-white">Prediction History</h2>
            </div>
            <div className="divide-y divide-white/[0.05]">
              {activities.map((activity, i) => (
                <div key={activity.id ?? i} className="p-4">
                  <div className="flex items-center justify-between mb-1">
                    {activity.marketId ? (
                      <Link
                        href={`/market/${activity.marketId}`}
                        className="text-xs font-heading font-medium text-white/80 hover:text-neo-brand transition-colors truncate flex-1 mr-2"
                      >
                        {activity.marketQuestion ?? `Market #${activity.marketId}`}
                      </Link>
                    ) : (
                      <span className="text-xs font-heading font-medium text-white/80 truncate flex-1 mr-2">
                        {activity.detail ?? activity.type}
                      </span>
                    )}
                    <span className="text-[10px] text-white/30 shrink-0 font-mono">
                      {timeAgo(activity.timestamp)}
                    </span>
                  </div>
                  {typeof activity.probability === "number" && (
                    <p className="text-xs font-mono text-white/60">
                      {Math.round(activity.probability * 100)}% YES
                    </p>
                  )}
                  {activity.reasoning && (
                    <p className="text-xs text-white/40 mt-1 line-clamp-2">
                      {activity.reasoning}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="neo-card p-5">
            <h2 className="font-heading font-bold text-sm text-white mb-3">Prediction History</h2>
            <p className="text-xs text-white/40 text-center py-4">No activity recorded yet</p>
          </div>
        )}

        {/* ERC-8004 Identity Card */}
        <div className="neo-card p-5 space-y-3">
          <h2 className="font-heading font-bold text-sm text-white mb-2">On-Chain Identity</h2>
          {entry.identity ? (
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-white/40">Name</span>
                <span className="font-mono text-white/60">{entry.identity.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">Type</span>
                <span className="font-mono text-white/60">{entry.identity.agentType}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">Model</span>
                <span className="font-mono text-white/60">{entry.identity.model}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">Reputation</span>
                <span className="font-mono text-white/60">{entry.identity.reputationScore?.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">Feedback Count</span>
                <span className="font-mono text-white/60">{entry.identity.feedbackCount}</span>
              </div>
              {entry.identity.framework && (
                <div className="flex justify-between">
                  <span className="text-white/40">Framework</span>
                  <span className="font-mono text-white/60">{entry.identity.framework}</span>
                </div>
              )}
              {entry.identity.a2aEndpoint && (
                <div className="flex justify-between">
                  <span className="text-white/40">A2A Endpoint</span>
                  <span className="font-mono text-neo-blue text-[10px] truncate max-w-[200px]">
                    {entry.identity.a2aEndpoint}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-xs text-white/40">Not registered on ERC-8004</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
