"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  question?: string;
  probability?: number;
  reasoning?: string;
  debateTarget?: string;
  amount?: string;
  timestamp: number;
}

interface DebateExchange {
  id: string;
  actor: string;
  target?: string;
  detail?: string;
  question?: string;
  timestamp: number;
  inbound: boolean;
}

interface DebateThreadView {
  key: string;
  marketId?: number;
  question: string;
  latestTimestamp: number;
  exchanges: DebateExchange[];
  participants: string[];
  divergence: number;
  probabilities: number[];
}

type SignalWindow = "1h" | "24h" | "7d";

const SIGNAL_WINDOW_MS: Record<SignalWindow, number> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

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

function probabilityPolyline(values: number[], width = 320, height = 84): string {
  if (values.length === 0) return "";
  return values
    .map((value, idx) => {
      const x = (idx / Math.max(1, values.length - 1)) * width;
      const y = height - Math.max(0, Math.min(1, value)) * height;
      return `${x},${y}`;
    })
    .join(" ");
}

function classifyDomain(question?: string): "Crypto" | "Politics" | "Sports" | "Tech" | "World" {
  const q = String(question ?? "").toLowerCase();
  if (!q) return "World";
  if (/\b(btc|bitcoin|eth|ethereum|strk|sol|token|crypto|defi)\b/.test(q)) return "Crypto";
  if (/\b(trump|election|senate|president|governor|policy|congress|war)\b/.test(q)) return "Politics";
  if (/\b(nba|nfl|nhl|mlb|ufc|match|win|score|tournament|super bowl|soccer)\b/.test(q)) return "Sports";
  if (/\b(ai|nvidia|tesla|apple|google|meta|chip|launch|tech)\b/.test(q)) return "Tech";
  return "World";
}

export default function AgentPage() {
  const params = useParams();
  const target = decodeURIComponent(params.id as string).trim();
  const normalizedTarget = target.toLowerCase();
  const walletTarget = isWalletLike(target);

  const [entry, setEntry] = useState<LeaderboardEntry | null>(null);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [allActivities, setAllActivities] = useState<ActivityItem[]>([]);
  const [agentAliases, setAgentAliases] = useState<string[]>([normalizedTarget]);
  const [signalWindow, setSignalWindow] = useState<SignalWindow>("24h");
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
      setAgentAliases(Array.from(aliases));

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
        setAllActivities(allActivities);
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
  const displayLabel = isWalletLike(displayName)
    ? truncateMiddle(displayName, 14, 10)
    : displayName;
  const voice = getAgentVoiceByName(displayName);
  const accentColor = voice?.colorClass ?? "text-neo-blue";
  const accentBg = accentColor.replace("text-", "bg-");
  const aliasSet = useMemo(
    () => new Set(agentAliases.map((alias) => alias.toLowerCase())),
    [agentAliases]
  );
  const signalSeriesAll = useMemo(
    () =>
      activities
        .filter((a) => typeof a.probability === "number")
        .sort((a, b) => a.timestamp - b.timestamp),
    [activities]
  );
  const signalSeries = useMemo(() => {
    const cutoff = Date.now() - SIGNAL_WINDOW_MS[signalWindow];
    return signalSeriesAll
      .filter((a) => a.timestamp >= cutoff)
      .slice(-120);
  }, [signalSeriesAll, signalWindow]);
  const domainMix = useMemo(() => {
    const totals: Record<"Crypto" | "Politics" | "Sports" | "Tech" | "World", number> = {
      Crypto: 0,
      Politics: 0,
      Sports: 0,
      Tech: 0,
      World: 0,
    };
    for (const item of activities) {
      const domain = classifyDomain(item.question ?? item.detail);
      totals[domain] += 1;
    }
    const max = Math.max(...Object.values(totals), 1);
    return Object.entries(totals)
      .map(([domain, count]) => ({ domain, count, pct: Math.round((count / max) * 100) }))
      .sort((a, b) => b.count - a.count);
  }, [activities]);
  const debateThreads = useMemo(() => {
    const threads = new Map<string, DebateThreadView>();
    const relatedDebates = allActivities.filter((item) => {
      if (String(item.type).toLowerCase() !== "debate") return false;
      const actor = String(item.actor ?? "").toLowerCase();
      const targetName = String(item.debateTarget ?? "").toLowerCase();
      return aliasSet.has(actor) || aliasSet.has(targetName);
    });

    for (const debate of relatedDebates) {
      const key = typeof debate.marketId === "number" ? `m-${debate.marketId}` : `d-${debate.id ?? debate.timestamp}`;
      const existing = threads.get(key) ?? {
        key,
        marketId: debate.marketId,
        question:
          debate.question ??
          (typeof debate.marketId === "number" ? `Market #${debate.marketId}` : "Unmapped debate"),
        latestTimestamp: debate.timestamp,
        exchanges: [],
        participants: [],
        divergence: 0,
        probabilities: [],
      };
      const actor = debate.actor;
      const targetName = debate.debateTarget;
      const actorLower = actor.toLowerCase();
      const targetLower = String(targetName ?? "").toLowerCase();
      const inbound = !aliasSet.has(actorLower) && aliasSet.has(targetLower);

      existing.latestTimestamp = Math.max(existing.latestTimestamp, debate.timestamp);
      if (debate.question && existing.question.startsWith("Market #")) {
        existing.question = debate.question;
      }
      existing.exchanges.push({
        id: debate.id ?? `${debate.timestamp}-${actor}`,
        actor,
        target: targetName,
        detail: debate.detail,
        question: debate.question,
        timestamp: debate.timestamp,
        inbound,
      });
      if (!existing.participants.includes(actor)) existing.participants.push(actor);
      if (targetName && !existing.participants.includes(targetName)) existing.participants.push(targetName);
      threads.set(key, existing);
    }

    for (const thread of threads.values()) {
      const relatedSignals = allActivities
        .filter(
          (item) =>
            typeof item.probability === "number" &&
            typeof thread.marketId === "number" &&
            item.marketId === thread.marketId
        )
        .sort((a, b) => a.timestamp - b.timestamp);

      const latestByActor = new Map<string, number>();
      for (const signal of relatedSignals) {
        latestByActor.set(signal.actor, signal.probability ?? 0.5);
      }

      const latestValues = Array.from(latestByActor.values());
      thread.divergence =
        latestValues.length > 1
          ? Math.max(...latestValues) - Math.min(...latestValues)
          : 0;
      thread.probabilities = relatedSignals.slice(-10).map((item) => item.probability ?? 0.5);
      thread.exchanges = thread.exchanges.sort((a, b) => b.timestamp - a.timestamp).slice(0, 4);
      thread.participants = thread.participants.slice(0, 6);
    }

    return Array.from(threads.values())
      .sort((a, b) => b.latestTimestamp - a.latestTimestamp)
      .slice(0, 6);
  }, [allActivities, aliasSet]);

  if (loading) return (
    <div className="min-h-screen bg-cream">
      <div className="max-w-3xl mx-auto px-4 pt-8">
        <TamagotchiLoader size="large" text={`Loading ${displayLabel}...`} />
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
  const signalProbabilities = signalSeries.map((item) => Math.max(0, Math.min(1, item.probability ?? 0.5)));
  const signalChartPoints = probabilityPolyline(signalProbabilities, 320, 84);
  const signalMean =
    signalProbabilities.length > 0
      ? signalProbabilities.reduce((sum, value) => sum + value, 0) / signalProbabilities.length
      : 0;
  const signalVariance =
    signalProbabilities.length > 1
      ? signalProbabilities.reduce((sum, value) => sum + (value - signalMean) ** 2, 0) / signalProbabilities.length
      : 0;
  const signalStdDev = Math.sqrt(signalVariance);
  const confidenceLow = Math.max(0, signalMean - signalStdDev);
  const confidenceHigh = Math.min(1, signalMean + signalStdDev);
  const confidenceBandY = 84 - confidenceHigh * 84;
  const confidenceBandHeight = Math.max(1.5, (confidenceHigh - confidenceLow) * 84);
  const confidenceBandPp = Math.round((confidenceHigh - confidenceLow) * 100);
  const avgSignalPct =
    signalProbabilities.length > 0
      ? Math.round(
          (signalProbabilities.reduce((sum, value) => sum + value, 0) / signalProbabilities.length) * 100
        )
      : 0;
  const signalRangePct =
    signalProbabilities.length > 1
      ? Math.round((Math.max(...signalProbabilities) - Math.min(...signalProbabilities)) * 100)
      : 0;
  const signalWindowLabel =
    signalWindow === "1h" ? "Last 1h" : signalWindow === "24h" ? "Last 24h" : "Last 7d";
  const latestActivityAt =
    activities.length > 0 ? Math.max(...activities.map((item) => item.timestamp)) : null;
  const profileState = latestActivityAt ? "ACTIVE" : "BOOTSTRAP";
  const profileStateTone = latestActivityAt
    ? "border-neo-green/35 bg-neo-green/10 text-neo-green"
    : "border-white/15 bg-white/[0.06] text-white/55";
  const hasDomainCoverage = domainMix.some((item) => item.count > 0);

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
                    {displayLabel}
                  </h1>
                  <span className={`neo-badge border text-[9px] sm:text-[10px] ${profileStateTone}`}>
                    {profileState}
                  </span>
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
                  <span className="neo-badge border border-white/12 bg-white/[0.05] text-white/60 font-mono">
                    {latestActivityAt ? `last ${timeAgo(latestActivityAt)}` : "no actions yet"}
                  </span>
                </div>
              </div>

              <div className="w-full sm:w-56 rounded-xl border border-white/[0.08] bg-white/[0.03] p-2.5 sm:p-3">
                <p className="text-[10px] uppercase tracking-widest text-white/35">Latest Signal</p>
                <p className="mt-1 text-[11px] sm:text-xs text-white/70 truncate">
                  {latestSignal?.question ?? latestSignal?.detail ?? "No live signal yet"}
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

        {/* Charts + Debate Thread Visualization */}
        <div className="grid grid-cols-1 xl:grid-cols-[1.1fr,1.9fr] gap-4">
          <section className="neo-card overflow-hidden">
            <div className="px-4 sm:px-5 py-2.5 sm:py-3 border-b border-white/[0.07] bg-white/[0.03] flex items-center justify-between gap-2">
              <div>
                <h2 className="font-heading font-bold text-sm text-white">Forecast Signal Chart</h2>
                <p className="text-[10px] font-mono text-white/40 mt-0.5">
                  {signalWindowLabel} | {signalSeries.length} points
                </p>
              </div>
              <div className="flex items-center gap-1">
                {(["1h", "24h", "7d"] as SignalWindow[]).map((windowKey) => (
                  <button
                    key={windowKey}
                    type="button"
                    onClick={() => setSignalWindow(windowKey)}
                    className={`rounded-md border px-2 py-1 text-[10px] font-mono transition-colors ${
                      signalWindow === windowKey
                        ? "border-neo-brand/40 bg-neo-brand/15 text-neo-brand"
                        : "border-white/10 text-white/45 hover:border-white/25 hover:text-white/70"
                    }`}
                    aria-pressed={signalWindow === windowKey}
                  >
                    {windowKey}
                  </button>
                ))}
              </div>
            </div>
            <div className="p-3 sm:p-4 space-y-3">
              {signalProbabilities.length >= 2 ? (
                <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3">
                  <svg viewBox="0 0 320 84" className="w-full h-24">
                    <line x1="0" y1="21" x2="320" y2="21" stroke="rgba(255,255,255,0.12)" strokeDasharray="3 3" />
                    <line x1="0" y1="42" x2="320" y2="42" stroke="rgba(255,255,255,0.12)" strokeDasharray="3 3" />
                    <line x1="0" y1="63" x2="320" y2="63" stroke="rgba(255,255,255,0.12)" strokeDasharray="3 3" />
                    <rect
                      x="0"
                      y={confidenceBandY}
                      width="320"
                      height={confidenceBandHeight}
                      fill="rgba(93,245,213,0.12)"
                    />
                    <polyline points={signalChartPoints} fill="none" stroke="rgba(93,245,213,0.95)" strokeWidth="2" />
                    {signalProbabilities.map((value, idx) => {
                      const x = (idx / Math.max(1, signalProbabilities.length - 1)) * 320;
                      const y = 84 - value * 84;
                      return (
                        <circle
                          key={`signal-point-${idx}`}
                          cx={x}
                          cy={y}
                          r="1.9"
                          fill="rgba(124,232,255,0.95)"
                        />
                      );
                    })}
                  </svg>
                  <div className="mt-2 flex items-center justify-between text-[10px] text-white/45 font-mono">
                    <span>{signalWindowLabel.toUpperCase()}</span>
                    <span>NOW</span>
                  </div>
                  <p className="mt-1 text-[10px] text-white/45 font-mono">
                    confidence band +/- {Math.round(confidenceBandPp / 2)}pp
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-5 text-center">
                  <p className="text-xs text-white/45">
                    Need at least 2 probability points in {signalWindowLabel.toLowerCase()} for charting.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-2 text-center">
                  <p className="text-[10px] text-white/40 uppercase tracking-wide">Average</p>
                  <p className="mt-1 text-sm font-mono text-neo-cyan">{avgSignalPct}%</p>
                </div>
                <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-2 text-center">
                  <p className="text-[10px] text-white/40 uppercase tracking-wide">Range</p>
                  <p className="mt-1 text-sm font-mono text-neo-orange">{signalRangePct}pp</p>
                </div>
                <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-2 text-center">
                  <p className="text-[10px] text-white/40 uppercase tracking-wide">Latest</p>
                  <p className="mt-1 text-sm font-mono text-neo-brand">{signalPct}%</p>
                </div>
              </div>

              <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3">
                <p className="text-[10px] uppercase tracking-widest text-white/35 mb-2">Domain Mix</p>
                {hasDomainCoverage ? (
                  <div className="space-y-1.5">
                    {domainMix.map((item) => (
                      <div key={item.domain} className="grid grid-cols-[64px,1fr,32px] items-center gap-2 text-[10px]">
                        <span className="text-white/55">{item.domain}</span>
                        <div className="h-1.5 rounded-full bg-white/[0.09] overflow-hidden">
                          <div className="h-full rounded-full bg-gradient-to-r from-neo-cyan to-neo-brand" style={{ width: `${item.pct}%` }} />
                        </div>
                        <span className="font-mono text-right text-white/55">{item.count}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-white/45 leading-relaxed">
                    No domain coverage yet. Once this agent posts forecasts, domain breakdown appears here.
                  </p>
                )}
              </div>
            </div>
          </section>

          <section className="neo-card overflow-hidden">
            <div className="px-4 sm:px-5 py-2.5 sm:py-3 border-b border-white/[0.07] bg-white/[0.03] flex items-center justify-between">
              <h2 className="font-heading font-bold text-sm text-white">Live Debate Threads</h2>
              <span className="text-[10px] font-mono text-white/40">{debateThreads.length} active</span>
            </div>
            <div className="p-3 sm:p-4 space-y-3">
              {debateThreads.length > 0 ? (
                debateThreads.map((thread) => {
                  const threadChartPoints = probabilityPolyline(thread.probabilities, 220, 30);
                  return (
                    <article key={thread.key} className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3">
                      <div className="flex items-start justify-between gap-2">
                        {typeof thread.marketId === "number" ? (
                          <Link
                            href={`/market/${thread.marketId}`}
                            className="text-xs sm:text-sm font-heading font-medium text-white/80 hover:text-neo-brand transition-colors line-clamp-2"
                          >
                            {thread.question}
                          </Link>
                        ) : (
                          <p className="text-xs sm:text-sm font-heading font-medium text-white/80 line-clamp-2">
                            {thread.question}
                          </p>
                        )}
                        <span className="text-[10px] font-mono text-white/35 whitespace-nowrap">
                          {timeAgo(thread.latestTimestamp)}
                        </span>
                      </div>

                      <div className="mt-2 flex items-center gap-2 text-[10px] font-mono">
                        <span className="rounded-full border border-neo-orange/35 bg-neo-orange/10 px-2 py-0.5 text-neo-orange">
                          div {(thread.divergence * 100).toFixed(0)}pp
                        </span>
                        {typeof thread.marketId === "number" && (
                          <span className="text-white/35">m#{thread.marketId}</span>
                        )}
                      </div>

                      {thread.probabilities.length >= 2 && (
                        <div className="mt-2 rounded-md border border-white/[0.06] bg-black/20 p-1.5">
                          <svg viewBox="0 0 220 30" className="w-full h-8">
                            <polyline
                              points={threadChartPoints}
                              fill="none"
                              stroke="rgba(100,255,232,0.85)"
                              strokeWidth="1.8"
                            />
                          </svg>
                        </div>
                      )}

                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {thread.participants.map((participant) => (
                          <span
                            key={`${thread.key}-${participant}`}
                            className={`rounded-full border px-2 py-0.5 text-[10px] ${
                              aliasSet.has(participant.toLowerCase())
                                ? "border-neo-brand/35 bg-neo-brand/12 text-neo-brand"
                                : "border-white/15 text-white/65"
                            }`}
                          >
                            {participant}
                          </span>
                        ))}
                      </div>

                      <div className="mt-2 space-y-1.5">
                        {thread.exchanges.map((exchange) => (
                          <div key={exchange.id} className="rounded-md border border-white/[0.08] bg-black/20 p-2">
                            <div className="flex items-center gap-1.5 text-[10px]">
                              <span
                                className={`rounded border px-1.5 py-0.5 font-mono ${
                                  exchange.inbound
                                    ? "border-neo-orange/35 bg-neo-orange/12 text-neo-orange"
                                    : "border-neo-cyan/35 bg-neo-cyan/12 text-neo-cyan"
                                }`}
                              >
                                {exchange.inbound ? "INBOUND" : "OUTBOUND"}
                              </span>
                              <span className="text-white/70 font-mono">
                                {exchange.actor}
                                {exchange.target ? ` -> ${exchange.target}` : ""}
                              </span>
                              <span className="ml-auto text-white/35 font-mono">{timeAgo(exchange.timestamp)}</span>
                            </div>
                            <p className="mt-1 text-[11px] text-white/55 line-clamp-2">
                              {exchange.detail ?? "debate update"}
                            </p>
                          </div>
                        ))}
                      </div>
                    </article>
                  );
                })
              ) : (
                <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
                  <p className="text-xs text-white/70 font-heading">No live debate threads yet</p>
                  <p className="mt-2 text-[11px] text-white/45 leading-relaxed">
                    Debate timelines appear once this agent and peer agents disagree on the same market.
                  </p>
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <Link
                      href="/fleet"
                      className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] text-white/70 hover:bg-white/[0.08] transition-colors text-center"
                    >
                      Open Fleet
                    </Link>
                    <Link
                      href="/"
                      className="rounded-lg border border-neo-brand/25 bg-neo-brand/12 px-3 py-2 text-[11px] text-neo-brand hover:bg-neo-brand/20 transition-colors text-center"
                    >
                      View Markets
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </section>
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
                          {activity.question ?? `Market #${activity.marketId}`}
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
              <h2 className="font-heading font-bold text-sm text-white mb-2">Prediction Timeline</h2>
              <p className="text-xs text-white/45 leading-relaxed">
                No activity recorded yet. This section fills with forecasts, debates, bets, and resolution actions.
              </p>
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-2.5">
                  <p className="text-[10px] text-white/35 uppercase tracking-wide">Step 1</p>
                  <p className="mt-1 text-[11px] text-white/65">Run autonomous tick</p>
                </div>
                <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-2.5">
                  <p className="text-[10px] text-white/35 uppercase tracking-wide">Step 2</p>
                  <p className="mt-1 text-[11px] text-white/65">Generate first forecast</p>
                </div>
                <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-2.5">
                  <p className="text-[10px] text-white/35 uppercase tracking-wide">Step 3</p>
                  <p className="mt-1 text-[11px] text-white/65">Track debate + bet trail</p>
                </div>
              </div>
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
                    <div className="mt-2">
                      <a
                        href={`https://sepolia.starkscan.co/contract/${profileWallet}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-md border border-neo-cyan/30 bg-neo-cyan/10 px-2 py-1 text-[10px] font-mono text-neo-cyan hover:bg-neo-cyan/20 transition-colors"
                      >
                        Open in Starkscan
                      </a>
                    </div>
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
