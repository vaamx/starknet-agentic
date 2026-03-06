"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useAccount, useSendTransaction } from "@starknet-react/core";
import { buildBetCalls } from "@/lib/contracts";
import { computePayout } from "@/lib/accuracy";
import { categorizeMarket } from "@/lib/categories";
import { getAgentVoiceByName } from "@/lib/agent-voices";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";
import LiveChatFeed from "@/components/LiveChatFeed";
import LiveNewsFeed from "@/components/LiveNewsFeed";
import TamagotchiLoader from "@/components/TamagotchiLoader";
import TamagotchiEmptyState from "@/components/TamagotchiEmptyState";
import type { AgentPrediction, Market } from "@/components/dashboard/types";
import { computeDisagreement, safeBigInt } from "@/components/dashboard/utils";

interface MarketDetail {
  market: Market;
  predictions: AgentPrediction[];
  weightedProbability: number | null;
  latestAgentTake: {
    agentName: string;
    probability: number;
    reasoning: string;
    timestamp: number;
  } | null;
}

interface MarketActivityEntry {
  id: string;
  type: string;
  actor: string;
  marketId?: number;
  probability?: number;
  detail?: string;
  debateTarget?: string;
  timestamp: number;
}

interface MarketCommentEntry {
  id: string;
  marketId: number;
  parentId: string | null;
  actorName: string;
  content: string;
  sourceType: string;
  reliabilityScore: number | null;
  backtestConfidence: number | null;
  createdAt: number;
}

type HeartbeatSource = "x" | "espn" | "rss" | "onchain";
type HeartbeatFreshness = "fresh" | "stale" | "missing";

interface MarketHeartbeatEntry {
  marketId: number;
  lastSeenAt: number | null;
  freshness: HeartbeatFreshness;
  sources: Record<
    HeartbeatSource,
    {
      lastSeenAt: number | null;
      freshness: HeartbeatFreshness;
    }
  >;
}

interface SessionAuthProbe {
  userAuthenticated?: boolean;
}

const HEARTBEAT_SOURCES: HeartbeatSource[] = ["x", "espn", "rss", "onchain"];

const HEARTBEAT_SOURCE_META: Record<HeartbeatSource, { label: string; icon: string }> = {
  x: { label: "X", icon: "𝕏" },
  espn: { label: "ESPN", icon: "🏈" },
  rss: { label: "RSS", icon: "📰" },
  onchain: { label: "Onchain", icon: "⛓" },
};

function brierGrade(score: number): { label: string; colorClass: string } {
  if (score < 0.1) return { label: "S", colorClass: "bg-neo-green text-neo-dark" };
  if (score < 0.15) return { label: "A", colorClass: "bg-neo-blue text-white" };
  if (score < 0.2) return { label: "B", colorClass: "bg-neo-cyan text-neo-dark" };
  if (score < 0.3) return { label: "C", colorClass: "bg-neo-orange text-neo-dark" };
  return { label: "D", colorClass: "bg-neo-red text-white" };
}

function timeAgoFromSec(timestampSec: number): string {
  const delta = Math.max(0, Math.floor(Date.now() / 1000 - timestampSec));
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

function formatHeartbeatAge(timestampSec: number | null): string {
  return timestampSec ? timeAgoFromSec(timestampSec) : "no signal";
}

function normalizeHeartbeatFreshness(value: unknown): HeartbeatFreshness {
  return value === "fresh" || value === "stale" || value === "missing"
    ? value
    : "missing";
}

function normalizeHeartbeatEntry(value: unknown): MarketHeartbeatEntry | null {
  if (!value || typeof value !== "object") return null;
  const row = value as {
    marketId?: unknown;
    lastSeenAt?: unknown;
    freshness?: unknown;
    sources?: unknown;
  };
  if (typeof row.marketId !== "number" || !Number.isFinite(row.marketId)) {
    return null;
  }
  const rawSources =
    row.sources && typeof row.sources === "object"
      ? (row.sources as Record<string, { lastSeenAt?: unknown; freshness?: unknown }>)
      : {};
  const sources = HEARTBEAT_SOURCES.reduce((acc, source) => {
    const sourceRow = rawSources[source];
    acc[source] = {
      lastSeenAt:
        typeof sourceRow?.lastSeenAt === "number" &&
        Number.isFinite(sourceRow.lastSeenAt)
          ? sourceRow.lastSeenAt
          : null,
      freshness: normalizeHeartbeatFreshness(sourceRow?.freshness),
    };
    return acc;
  }, {} as MarketHeartbeatEntry["sources"]);

  return {
    marketId: Math.trunc(row.marketId),
    lastSeenAt:
      typeof row.lastSeenAt === "number" && Number.isFinite(row.lastSeenAt)
        ? row.lastSeenAt
        : null,
    freshness: normalizeHeartbeatFreshness(row.freshness),
    sources,
  };
}

function heartbeatTone(freshness: HeartbeatFreshness): string {
  if (freshness === "fresh") {
    return "border-neo-green/35 bg-neo-green/15 text-neo-green";
  }
  if (freshness === "stale") {
    return "border-neo-yellow/35 bg-neo-yellow/15 text-neo-yellow";
  }
  return "border-white/20 bg-white/[0.06] text-white/70";
}

export default function MarketPage() {
  const params = useParams();
  const id = params.id as string;

  const [data, setData] = useState<MarketDetail | null>(null);
  const [activityTrail, setActivityTrail] = useState<MarketActivityEntry[]>([]);
  const [commentThread, setCommentThread] = useState<MarketCommentEntry[]>([]);
  const [marketHeartbeat, setMarketHeartbeat] = useState<MarketHeartbeatEntry | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Bet form state
  const { address: connectedAddress, isConnected } = useAccount();
  const { sendAsync, isPending: betPending } = useSendTransaction({});
  const [outcome, setOutcome] = useState<0 | 1>(1);
  const [amount, setAmount] = useState("");
  const [betResult, setBetResult] = useState<{ status: string; txHash?: string; error?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchMarket = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let canFetchOrgData = false;
      try {
        const sessionRes = await fetch("/api/auth/session", {
          cache: "no-store",
          credentials: "include",
        });
        if (sessionRes.ok) {
          const session = (await sessionRes.json().catch(() => null)) as
            | (SessionAuthProbe & { role?: string | null })
            | null;
          canFetchOrgData =
            session?.userAuthenticated === true &&
            typeof session?.role === "string" &&
            session.role.length > 0;
        }
      } catch {
        canFetchOrgData = false;
      }

      const [res, activityRes, commentRes, heartbeatRes] = await Promise.all([
        fetch(`/api/markets/${id}`, { cache: "no-store" }),
        fetch("/api/activity?limit=200", { cache: "no-store" }).catch(() => null),
        canFetchOrgData
          ? fetch(`/api/agent-comments?marketId=${id}&limit=120&order=asc`, {
              cache: "no-store",
              credentials: "include",
            }).catch(() => null)
          : Promise.resolve(null),
        canFetchOrgData
          ? fetch(`/api/fleet?marketIds=${encodeURIComponent(id)}`, {
              cache: "no-store",
              credentials: "include",
            }).catch(() => null)
          : Promise.resolve(null),
      ]);

      if (!res.ok) {
        setMarketHeartbeat(null);
        setError(res.status === 404 ? "Market not found" : `HTTP ${res.status}`);
        return;
      }
      const json = await res.json();
      setData({
        market: json.market,
        predictions: Array.isArray(json.predictions) ? json.predictions : [],
        weightedProbability: typeof json.weightedProbability === "number" ? json.weightedProbability : null,
        latestAgentTake: json.latestAgentTake ?? null,
      });

      if (activityRes && activityRes.ok) {
        const payload = await activityRes.json();
        const entries = Array.isArray(payload.activities)
          ? (payload.activities as MarketActivityEntry[])
          : [];
        const numericId = Number(id);
        const filtered = entries
          .filter((entry) => entry.marketId === numericId)
          .filter(
            (entry) =>
              entry.type === "prediction" ||
              entry.type === "debate" ||
              entry.type === "bet"
          )
          .sort((a, b) => a.timestamp - b.timestamp)
          .slice(-60);
        setActivityTrail(filtered);
      } else {
        setActivityTrail([]);
      }

      if (commentRes && commentRes.ok) {
        const payload = (await commentRes.json().catch(() => null)) as
          | { comments?: unknown[] }
          | null;
        const comments = Array.isArray(payload?.comments)
          ? payload.comments
              .map((entry) => {
                const row = entry as Partial<MarketCommentEntry>;
                if (
                  typeof row.id !== "string" ||
                  typeof row.marketId !== "number" ||
                  typeof row.actorName !== "string" ||
                  typeof row.content !== "string" ||
                  typeof row.createdAt !== "number"
                ) {
                  return null;
                }
                return {
                  id: row.id,
                  marketId: row.marketId,
                  parentId: typeof row.parentId === "string" ? row.parentId : null,
                  actorName: row.actorName,
                  content: row.content,
                  sourceType:
                    typeof row.sourceType === "string" ? row.sourceType : "agent",
                  reliabilityScore:
                    typeof row.reliabilityScore === "number"
                      ? Math.max(0, Math.min(1, row.reliabilityScore))
                      : null,
                  backtestConfidence:
                    typeof row.backtestConfidence === "number"
                      ? Math.max(0, Math.min(1, row.backtestConfidence))
                      : null,
                  createdAt: row.createdAt,
                } satisfies MarketCommentEntry;
              })
              .filter((entry): entry is MarketCommentEntry => Boolean(entry))
          : [];
        setCommentThread(comments);
      } else {
        setCommentThread([]);
      }
      if (heartbeatRes && heartbeatRes.ok) {
        const payload = (await heartbeatRes.json().catch(() => null)) as
          | {
              fleet?: {
                readiness?: {
                  sourceHeartbeat?: {
                    markets?: unknown[];
                  } | null;
                };
              };
            }
          | null;
        const rows = Array.isArray(payload?.fleet?.readiness?.sourceHeartbeat?.markets)
          ? payload.fleet?.readiness?.sourceHeartbeat?.markets ?? []
          : [];
        const numericId = Number(id);
        const matched =
          rows
            .map((entry) => normalizeHeartbeatEntry(entry))
            .find(
              (entry): entry is MarketHeartbeatEntry =>
                entry !== null && entry.marketId === numericId
            ) ??
          null;
        setMarketHeartbeat(matched);
      } else {
        setMarketHeartbeat(null);
      }
    } catch (err: any) {
      setMarketHeartbeat(null);
      setError(err?.message ?? "Failed to load market");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchMarket(); }, [fetchMarket]);

  const market = data?.market;
  const predictions = data?.predictions ?? [];

  const yesPercent = market ? Math.round(market.impliedProbYes * 100) : 50;
  const noPercent = 100 - yesPercent;
  const category = market ? categorizeMarket(market.question) : "other";

  const now = Date.now() / 1000;
  const daysLeft = market ? Math.max(0, Math.floor((market.resolutionTime - now) / 86400)) : 0;
  const hoursLeft = market ? Math.max(0, Math.floor((market.resolutionTime - now) / 3600)) : 0;
  const isExpired = market ? market.resolutionTime <= now : false;

  const poolWei = market ? safeBigInt(market.totalPool) : 0n;
  const poolDisplay = (poolWei / 10n ** 18n).toString();

  const disagreement = computeDisagreement(predictions);
  const isHot = (market?.tradeCount ?? 0) > 3;
  const isContested = disagreement > 0.15;
  const predictionTrail = activityTrail.filter(
    (entry) => entry.type === "prediction" && typeof entry.probability === "number"
  );
  const debateTrail = activityTrail
    .filter((entry) => entry.type === "debate")
    .slice(-4)
    .reverse();
  const commentReplyMap = useMemo(() => {
    const map = new Map<string, MarketCommentEntry[]>();
    for (const comment of commentThread) {
      if (!comment.parentId) continue;
      const bucket = map.get(comment.parentId) ?? [];
      bucket.push(comment);
      map.set(comment.parentId, bucket);
    }
    for (const replies of map.values()) {
      replies.sort((a, b) => a.createdAt - b.createdAt);
    }
    return map;
  }, [commentThread]);
  const topLevelComments = useMemo(
    () => commentThread.filter((comment) => !comment.parentId),
    [commentThread]
  );

  const statusLabel = market
    ? market.status === 0
      ? isExpired ? "PENDING" : "LIVE"
      : ["LIVE", "CLOSED", "RESOLVED"][market.status] ?? "???"
    : "";
  const statusColor =
    market?.status === 0
      ? isExpired
        ? "bg-neo-orange/15 text-neo-orange border-neo-orange/30"
        : "bg-neo-green/15 text-neo-green border-neo-green/30"
      : market?.status === 2
        ? "bg-neo-purple/15 text-neo-purple border-neo-purple/30"
        : "bg-neo-yellow/15 text-neo-yellow border-neo-yellow/30";

  // Bet calculations
  const amountBigInt = useMemo(() => {
    try { return BigInt(Math.floor(parseFloat(amount || "0") * 1e18)); }
    catch { return 0n; }
  }, [amount]);

  const estPayout = useMemo(() => {
    if (!market || amountBigInt <= 0n) return 0n;
    const winningPool = outcome === 1 ? BigInt(market.yesPool) : BigInt(market.noPool);
    const newWinningPool = winningPool + amountBigInt;
    const newTotalPool = BigInt(market.totalPool) + amountBigInt;
    return newWinningPool > 0n ? computePayout(amountBigInt, newTotalPool, newWinningPool, market.feeBps) : 0n;
  }, [market, amountBigInt, outcome]);

  const estMultiple = amountBigInt > 0n ? Number(estPayout) / Number(amountBigInt) : 0;

  async function handleBet() {
    if (!market || amountBigInt <= 0n || !isConnected) return;
    setBetResult(null);
    try {
      const calls = buildBetCalls(market.address, outcome, amountBigInt);
      const response = await sendAsync(calls);
      setBetResult({ status: "success", txHash: response.transaction_hash });
    } catch (err: any) {
      setBetResult({ status: "error", error: err.message });
    }
  }

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try { await navigator.share({ title: market?.question, url }); }
      catch {}
    } else {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-cream flex flex-col">
      <SiteHeader />
      <div className="max-w-5xl mx-auto w-full px-4 sm:px-6 py-6 flex-1 space-y-5">
        {/* Breadcrumb skeleton */}
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-14 rounded bg-white/[0.06] animate-pulse" />
          <div className="h-3 w-3 rounded bg-white/[0.04]" />
          <div className="h-3 w-40 rounded bg-white/[0.06] animate-pulse" />
        </div>
        {/* Header skeleton */}
        <div className="neo-card p-5 sm:p-6 relative overflow-hidden">
          <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/[0.03] to-transparent" />
          <div className="flex items-center gap-2 mb-3">
            <div className="h-5 w-12 rounded bg-white/[0.07] animate-pulse" />
            <div className="h-4 w-16 rounded bg-white/[0.05] animate-pulse" />
            <div className="ml-auto h-3 w-10 rounded bg-white/[0.04] animate-pulse" />
          </div>
          <div className="h-6 w-3/4 rounded bg-white/[0.07] animate-pulse mb-2" />
          <div className="h-5 w-1/2 rounded bg-white/[0.05] animate-pulse mb-4" />
          <div className="flex items-center gap-0">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center flex-1">
                <div className="flex flex-col items-center flex-1">
                  <div className="w-2.5 h-2.5 rounded-full bg-white/[0.08] animate-pulse" />
                  <div className="mt-1 h-2 w-8 rounded bg-white/[0.04] animate-pulse" />
                </div>
                {i < 4 && <div className="h-[2px] flex-1 -mt-3 bg-white/[0.04]" />}
              </div>
            ))}
          </div>
        </div>
        {/* Probability skeleton */}
        <div className="neo-card p-5 relative overflow-hidden">
          <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/[0.03] to-transparent" style={{ animationDelay: "0.3s" }} />
          <div className="flex items-center justify-between mb-2">
            <div className="h-4 w-20 rounded bg-neo-green/10 animate-pulse" />
            <div className="h-4 w-16 rounded bg-neo-red/10 animate-pulse" />
          </div>
          <div className="h-6 w-full rounded-full bg-white/[0.05] animate-pulse" />
        </div>
        {/* Bet + predictions skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="neo-card p-5 relative overflow-hidden">
              <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/[0.03] to-transparent" style={{ animationDelay: `${0.2 * i}s` }} />
              <div className="h-4 w-24 rounded bg-white/[0.07] animate-pulse mb-3" />
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, j) => (
                  <div key={j} className="h-12 rounded-lg bg-white/[0.04] animate-pulse" style={{ animationDelay: `${j * 0.1}s` }} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <Footer />
    </div>
  );

  if (error || !market) return (
    <div className="min-h-screen bg-cream flex flex-col">
      <SiteHeader />
      <div className="max-w-3xl mx-auto px-4 pt-8 flex-1">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-white/50 hover:text-white/80 transition-colors mb-6">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Back to Dashboard
        </Link>
        <TamagotchiEmptyState message={error ?? "Market not found"} />
      </div>
      <Footer />
    </div>
  );

  const presets = ["10", "50", "100", "500"];

  return (
    <div className="min-h-screen bg-cream flex flex-col">
      <SiteHeader />
      <div className="max-w-5xl mx-auto w-full flex-1 px-4 sm:px-6 py-6 pb-12 space-y-5">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-xs text-white/40">
          <Link href="/" className="hover:text-white/70 transition-colors no-underline">Markets</Link>
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
          <span className="text-white/60 font-medium truncate max-w-[280px]">{market.question}</span>
        </nav>

        {/* Market Header */}
        <div className="neo-card p-5 sm:p-6">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <span className={`neo-badge text-xs py-0.5 px-2 ${statusColor}`}>
              {statusLabel}
            </span>
            <span className="text-xs font-medium text-neo-brand/80 uppercase tracking-wider">
              {category}
            </span>
            <span className="text-xs text-white/30 ml-auto">
              {isExpired ? "Expired" : daysLeft > 0 ? `${daysLeft}d left` : `${hoursLeft}h left`}
            </span>
          </div>

          {(isHot || isContested) && (
            <div className="flex items-center gap-1.5 mb-3">
              {isHot && (
                <span className="text-xs px-1.5 py-0.5 bg-neo-yellow/10 border border-neo-yellow/20 rounded text-neo-yellow font-medium">
                  Hot
                </span>
              )}
              {isContested && (
                <span className="text-xs px-1.5 py-0.5 bg-neo-orange/10 border border-neo-orange/20 rounded text-neo-orange font-medium">
                  Contested
                </span>
              )}
            </div>
          )}

          <h1 className="font-heading font-bold text-xl sm:text-2xl text-white leading-snug text-balance mb-4">
            {market.question}
          </h1>

          {/* Market Lifecycle Timeline */}
          <div className="mb-4 flex items-center gap-0">
            {([
              { key: "seeding", label: "Seeding" },
              { key: "active", label: "Active" },
              { key: "closing", label: "Closing" },
              { key: "resolving", label: "Resolving" },
              { key: "resolved", label: "Resolved" },
            ] as const).map((step, i) => {
              const currentPhase =
                market.status === 2 ? "resolved" :
                market.status === 1 ? "resolving" :
                isExpired ? "resolving" :
                daysLeft <= 1 ? "closing" :
                daysLeft > 25 ? "seeding" : "active";
              const phases = ["seeding", "active", "closing", "resolving", "resolved"];
              const currentIdx = phases.indexOf(currentPhase);
              const stepIdx = phases.indexOf(step.key);
              const isPast = stepIdx < currentIdx;
              const isCurrent = stepIdx === currentIdx;
              return (
                <div key={step.key} className="flex items-center flex-1">
                  <div className="flex flex-col items-center flex-1">
                    <div className={`w-2.5 h-2.5 rounded-full border-2 transition-all ${
                      isCurrent ? "border-neo-brand bg-neo-brand scale-125" :
                      isPast ? "border-neo-brand/50 bg-neo-brand/30" :
                      "border-white/15 bg-white/[0.05]"
                    }`} />
                    <span className={`mt-1 text-[9px] font-semibold uppercase tracking-wider ${
                      isCurrent ? "text-neo-brand" : isPast ? "text-white/40" : "text-white/20"
                    }`}>{step.label}</span>
                  </div>
                  {i < 4 && (
                    <div className={`h-[2px] flex-1 -mt-3 ${
                      isPast ? "bg-neo-brand/30" : "bg-white/[0.06]"
                    }`} />
                  )}
                </div>
              );
            })}
          </div>

          {marketHeartbeat && (
            <div className="mb-4 rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/40">
                  Source Freshness
                </p>
                <span
                  className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${heartbeatTone(
                    marketHeartbeat.freshness
                  )}`}
                >
                  {marketHeartbeat.freshness}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {HEARTBEAT_SOURCES.map((source) => {
                  const status = marketHeartbeat.sources[source];
                  const meta = HEARTBEAT_SOURCE_META[source];
                  return (
                    <span
                      key={`${market.id}-${source}`}
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${heartbeatTone(
                        status.freshness
                      )}`}
                    >
                      <span>{meta.icon}</span>
                      <span>{meta.label}</span>
                      <span className="font-mono opacity-80">
                        {formatHeartbeatAge(status.lastSeenAt)}
                      </span>
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Share + Pool Info Strip */}
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={handleShare}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-xs text-white/50 hover:bg-white/[0.06] hover:text-white/70 transition-colors"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
              </svg>
              {copied ? "Copied!" : "Share"}
            </button>
            <span className="text-[10px] font-mono text-white/25">
              {poolDisplay} STRK pooled
            </span>
            <span className="text-[10px] font-mono text-white/25">
              {market.tradeCount ?? 0} trades
            </span>
          </div>
        </div>

        {/* Probability Visualization */}
        <div className="neo-card p-5">
          <div className="flex items-end justify-between mb-3">
            <div>
              <span className="text-[10px] uppercase tracking-wider text-white/30 block mb-0.5">Market Probability</span>
              <span className={`font-heading font-extrabold text-2xl tabular-nums ${yesPercent >= 50 ? "text-neo-green" : "text-neo-red"}`}>
                {yesPercent}%
              </span>
              <span className="text-xs text-white/30 ml-1.5">YES</span>
            </div>
            {data?.weightedProbability !== null && data?.weightedProbability !== undefined && (
              <div className="text-right">
                <span className="text-[10px] uppercase tracking-wider text-white/30 block mb-0.5">AI Consensus</span>
                <span className="font-heading font-bold text-lg tabular-nums text-white/70">
                  {Math.round(data.weightedProbability * 100)}%
                </span>
                {(() => {
                  const diff = Math.round(data.weightedProbability! * 100) - yesPercent;
                  if (diff === 0) return null;
                  return (
                    <span className={`text-[10px] font-mono ml-1 ${diff > 0 ? "text-neo-green" : "text-neo-red"}`}>
                      {diff > 0 ? "\u25B2" : "\u25BC"}{Math.abs(diff)}
                    </span>
                  );
                })()}
              </div>
            )}
          </div>

          {/* Split bar */}
          <div className="relative w-full h-8 bg-white/[0.04] rounded-lg overflow-hidden">
            <div
              className="absolute left-0 top-0 bottom-0 bg-gradient-to-r from-neo-green/35 to-neo-green/20 transition-all duration-500"
              style={{ width: `${yesPercent}%` }}
            />
            <div
              className="absolute right-0 top-0 bottom-0 bg-gradient-to-l from-neo-red/35 to-neo-red/20 transition-all duration-500"
              style={{ width: `${noPercent}%` }}
            />
            {/* Center divider */}
            <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/10" />
            {/* Agent prediction dots */}
            {predictions.map((pred) => {
              const voice = getAgentVoiceByName(pred.agent);
              const dotColor = voice?.colorClass?.replace("text-", "bg-") ?? "bg-neo-blue";
              const left = Math.max(3, Math.min(97, pred.predictedProb * 100));
              return (
                <div
                  key={pred.agent}
                  className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-[#0a0f1b] ${dotColor} shadow-sm`}
                  style={{ left: `${left}%`, marginLeft: -6 }}
                  title={`${pred.agent}: ${Math.round(pred.predictedProb * 100)}%`}
                />
              );
            })}
            {/* Labels inside bar */}
            <div className="absolute inset-0 flex items-center justify-between px-3 pointer-events-none">
              <span className="text-[11px] font-heading font-bold text-neo-green/80">YES {yesPercent}%</span>
              <span className="text-[11px] font-heading font-bold text-neo-red/80">NO {noPercent}%</span>
            </div>
          </div>

          {/* Agent legend */}
          <div className="flex items-center gap-3 mt-2.5 flex-wrap">
            {predictions.map((pred) => {
              const voice = getAgentVoiceByName(pred.agent);
              return (
                <span key={pred.agent} className="flex items-center gap-1.5 text-[10px] text-white/40">
                  <span className={`w-2 h-2 rounded-full ${voice?.colorClass?.replace("text-", "bg-") ?? "bg-neo-blue"}`} />
                  <span className="font-medium">{pred.agent}</span>
                  <span className="font-mono text-white/25">{Math.round(pred.predictedProb * 100)}%</span>
                </span>
              );
            })}
          </div>
        </div>

        {/* Market Analytics */}
        <div className="neo-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-heading font-bold text-sm text-white">Forecast Trail</h2>
            <span className="text-[10px] font-mono text-white/35">
              {predictionTrail.length} points
            </span>
          </div>
          {predictionTrail.length >= 2 ? (
            <div className="space-y-2">
              <div className="h-24 rounded-lg border border-white/[0.08] bg-white/[0.02] p-2">
                <svg viewBox="0 0 320 80" className="w-full h-full" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="forecast-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="rgb(93,245,213)" stopOpacity="0.15" />
                      <stop offset="100%" stopColor="rgb(93,245,213)" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  {/* Grid lines */}
                  {[0.25, 0.5, 0.75].map(f => (
                    <line key={f} x1="0" y1={80 * f} x2="320" y2={80 * f} stroke="rgba(255,255,255,0.04)" strokeDasharray="3,5" />
                  ))}
                  {/* 50% reference line */}
                  <line x1="0" y1="40" x2="320" y2="40" stroke="rgba(255,255,255,0.08)" strokeDasharray="2,4" />
                  {/* Area fill */}
                  <polygon
                    points={[
                      ...predictionTrail.map((point, idx) => {
                        const probability = typeof point.probability === "number" ? point.probability : 0.5;
                        const x = (idx / Math.max(1, predictionTrail.length - 1)) * 320;
                        const y = 80 - Math.max(0, Math.min(1, probability)) * 80;
                        return `${x},${y}`;
                      }),
                      `320,80`,
                      `0,80`,
                    ].join(" ")}
                    fill="url(#forecast-fill)"
                  />
                  {/* Line */}
                  <polyline
                    points={predictionTrail
                      .map((point, idx) => {
                        const probability = typeof point.probability === "number" ? point.probability : 0.5;
                        const x = (idx / Math.max(1, predictionTrail.length - 1)) * 320;
                        const y = 80 - Math.max(0, Math.min(1, probability)) * 80;
                        return `${x},${y}`;
                      })
                      .join(" ")}
                    fill="none"
                    stroke="rgba(93,245,213,0.85)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {/* Data points */}
                  {predictionTrail.map((point, idx) => {
                    if (typeof point.probability !== "number") return null;
                    const x = (idx / Math.max(1, predictionTrail.length - 1)) * 320;
                    const y = 80 - Math.max(0, Math.min(1, point.probability)) * 80;
                    const isLast = idx === predictionTrail.length - 1;
                    return (
                      <g key={`${point.id}-${idx}`}>
                        <circle cx={x} cy={y} r={isLast ? "3.5" : "2"} fill="rgba(93,245,213,0.9)" />
                        {isLast && (
                          <circle cx={x} cy={y} r="6" fill="rgba(93,245,213,0.15)">
                            <animate attributeName="r" values="6;9;6" dur="2s" repeatCount="indefinite" />
                            <animate attributeName="opacity" values="1;0.4;1" dur="2s" repeatCount="indefinite" />
                          </circle>
                        )}
                      </g>
                    );
                  })}
                </svg>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {predictionTrail
                  .slice(-5)
                  .reverse()
                  .map((point) => (
                    <span
                      key={`pred-${point.id}`}
                      className="inline-flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-[10px]"
                    >
                      <span className="font-medium text-white/60">{point.actor}</span>
                      <span className="font-mono text-neo-green/80">{Math.round((point.probability ?? 0.5) * 100)}%</span>
                    </span>
                  ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-white/45">Need more live predictions for charting.</p>
          )}

          <div className="mt-4 pt-3 border-t border-white/10">
            <h3 className="font-heading font-bold text-xs text-white/70 mb-2">
              Debate Thread
            </h3>
            {debateTrail.length > 0 ? (
              <div className="space-y-2">
                {debateTrail.map((entry) => (
                  <div
                    key={`debate-${entry.id}`}
                    className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-2.5"
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="font-mono text-[10px] font-semibold text-white/70">{entry.actor}</span>
                      {entry.debateTarget && (
                        <>
                          <svg className="w-3 h-3 text-white/25" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                          </svg>
                          <span className="font-mono text-[10px] font-semibold text-white/60">{entry.debateTarget}</span>
                        </>
                      )}
                      <span className="text-[9px] text-white/20 ml-auto">{timeAgoFromSec(entry.timestamp)}</span>
                    </div>
                    <p className="text-[11px] text-white/50 leading-relaxed line-clamp-2">
                      {entry.detail ?? "debate update"}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-white/45">
                No live rebuttal yet for this market.
              </p>
            )}
          </div>

          <div className="mt-4 pt-3 border-t border-white/10">
            <h3 className="font-heading font-bold text-xs text-white/70 mb-2">
              Agent Comment Thread
            </h3>
            {topLevelComments.length > 0 ? (
              <div className="space-y-2.5">
                {topLevelComments.slice(-12).map((comment) => {
                  const replies = commentReplyMap.get(comment.id) ?? [];
                  return (
                    <div
                      key={`comment-${comment.id}`}
                      className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5"
                    >
                      <div className="flex items-center gap-1.5 text-[10px] font-mono text-white/60">
                        <span>{comment.actorName}</span>
                        <span className="text-white/25">•</span>
                        <span>{timeAgoFromSec(comment.createdAt)}</span>
                        {typeof comment.backtestConfidence === "number" ? (
                          <>
                            <span className="text-white/25">•</span>
                            <span className="text-cyan-200/75">
                              BT {Math.round(comment.backtestConfidence * 100)}%
                            </span>
                          </>
                        ) : null}
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed text-white/65">
                        {comment.content}
                      </p>

                      {replies.length > 0 && (
                        <div className="mt-2 space-y-1.5 border-l border-white/10 pl-2.5">
                          {replies.slice(-3).map((reply) => (
                            <div key={`reply-${reply.id}`} className="rounded bg-white/[0.025] p-1.5">
                              <p className="text-[10px] font-mono text-white/55">
                                {reply.actorName} • {timeAgoFromSec(reply.createdAt)}
                              </p>
                              <p className="mt-0.5 text-[10px] text-white/55">
                                {reply.content}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-white/45">
                No persisted agent comments yet for this market.
              </p>
            )}
          </div>
        </div>

        {/* Inline Bet Form */}
        {market.status === 0 && !isExpired && (
          <div className="neo-card p-5">
            <h2 className="font-heading font-bold text-sm text-white mb-3">Place Bet</h2>

            {/* Agent consensus hint */}
            {predictions.length > 0 && (
              <div className="flex items-center gap-2 mb-3 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2">
                <div className="flex -space-x-1">
                  {predictions.slice(0, 3).map((pred, i) => {
                    const colors = ["#10b981", "#3b82f6", "#f59e0b", "#8b5cf6", "#ec4899"];
                    return (
                      <div key={pred.agent} className="w-4 h-4 rounded-full border border-white/20 flex items-center justify-center text-[7px] font-bold text-white/80" style={{ backgroundColor: colors[i % colors.length] }}>
                        {pred.agent.charAt(0).toUpperCase()}
                      </div>
                    );
                  })}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-white/35">Agent consensus</span>
                    <span className="font-mono text-[11px] font-bold text-neo-brand">
                      {Math.round(market.impliedProbYes * 100)}% Yes
                    </span>
                  </div>
                  <div className="h-1 w-full rounded-full bg-white/[0.06] overflow-hidden mt-0.5">
                    <div className="h-full rounded-full bg-neo-brand/50 transition-all" style={{ width: `${Math.round(market.impliedProbYes * 100)}%` }} />
                  </div>
                </div>
              </div>
            )}

            {/* Outcome Toggle */}
            <div className="flex border border-white/10 mb-3 rounded-lg overflow-hidden">
              <button
                onClick={() => setOutcome(1)}
                className={`flex-1 py-2.5 font-heading font-bold text-sm transition-all ${
                  outcome === 1
                    ? "bg-neo-green/15 text-neo-green"
                    : "bg-white/[0.03] text-white/40 hover:text-white/60"
                }`}
              >
                YES
              </button>
              <div className="w-px bg-white/10" />
              <button
                onClick={() => setOutcome(0)}
                className={`flex-1 py-2.5 font-heading font-bold text-sm transition-all ${
                  outcome === 0
                    ? "bg-neo-red/15 text-neo-red"
                    : "bg-white/[0.03] text-white/40 hover:text-white/60"
                }`}
              >
                NO
              </button>
            </div>

            {/* Amount */}
            <label className="block text-xs font-medium text-white/40 mb-1.5">Amount (STRK)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="neo-input w-full mb-2"
            />
            <div className="flex gap-1.5 mb-3">
              {presets.map((p) => (
                <button
                  key={p}
                  onClick={() => setAmount(p)}
                  className={`flex-1 py-1.5 border text-xs font-medium transition-all rounded-lg ${
                    amount === p
                      ? "bg-neo-blue/15 text-neo-blue border-neo-blue/30"
                      : "bg-white/[0.04] text-white/60 border-white/10 hover:bg-white/[0.08]"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>

            {/* Payout Preview */}
            {amountBigInt > 0n && (
              <div className="border border-white/[0.07] p-3 mb-3 bg-white/[0.03] rounded-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[10px] text-white/40 block">If {outcome === 1 ? "YES" : "NO"} wins</span>
                    <span className="font-mono text-lg font-black text-white">
                      {(Number(estPayout) / 1e18).toFixed(2)} STRK
                    </span>
                  </div>
                  <div className={`rounded-xl px-3 py-1.5 border ${
                    estMultiple >= 2 ? "border-neo-green/30 bg-neo-green/10" : "border-white/[0.1] bg-white/[0.04]"
                  }`}>
                    <span className={`font-mono text-sm font-black ${
                      estMultiple >= 2 ? "text-neo-green" : "text-white/70"
                    }`}>
                      {estMultiple.toFixed(2)}x
                    </span>
                  </div>
                </div>
              </div>
            )}

            {isConnected ? (
              <button
                onClick={handleBet}
                disabled={betPending || amountBigInt <= 0n}
                className={`w-full py-3 rounded-lg font-heading font-bold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                  outcome === 1
                    ? "bg-neo-green/20 text-neo-green border border-neo-green/30 hover:bg-neo-green/30"
                    : "bg-neo-red/20 text-neo-red border border-neo-red/30 hover:bg-neo-red/30"
                }`}
              >
                {betPending
                  ? "Signing Transaction..."
                  : `Bet ${outcome === 1 ? "YES" : "NO"}${amount ? ` \u2014 ${amount} STRK` : ""}`}
              </button>
            ) : (
              <div className="text-center py-3 border border-dashed border-white/10 text-sm text-white/50 rounded-lg">
                Connect Wallet to Place Bets
              </div>
            )}

            {betResult && (
              <div className={`mt-3 p-2.5 border text-xs font-mono rounded-lg ${
                betResult.status === "success"
                  ? "border-neo-green/30 bg-neo-green/10"
                  : "border-neo-red/30 bg-neo-red/10"
              }`}>
                {betResult.status === "success" ? (
                  <>
                    <span className="font-bold">Bet placed on-chain</span>
                    {betResult.txHash && (
                      <a
                        href={`https://sepolia.voyager.online/tx/${betResult.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-xs text-neo-blue mt-1 hover:underline break-all"
                      >
                        View on Voyager: {betResult.txHash.slice(0, 20)}...
                      </a>
                    )}
                  </>
                ) : (
                  <span className="text-neo-red">{betResult.error}</span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Agent Predictions List */}
        {predictions.length > 0 && (
          <div className="neo-card overflow-hidden">
            <div className="px-5 py-3 border-b border-white/[0.07] bg-white/[0.03] flex items-center justify-between">
              <h2 className="font-heading font-bold text-sm text-white">Agent Predictions</h2>
              <span className="text-[10px] font-mono text-white/30">{predictions.length} agents</span>
            </div>
            <div className="divide-y divide-white/[0.05]">
              {predictions.map((pred) => {
                const voice = getAgentVoiceByName(pred.agent);
                const grade = brierGrade(pred.brierScore);
                const probPct = Math.round(pred.predictedProb * 100);
                const isYes = probPct >= 50;
                return (
                  <div key={pred.agent} className="p-4 hover:bg-white/[0.02] transition-colors">
                    <div className="flex items-center gap-2.5 mb-2.5">
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold text-white/80 border border-white/[0.08]`}
                        style={{ backgroundColor: voice?.colorClass?.includes("green") ? "rgba(16,185,129,0.15)" : voice?.colorClass?.includes("blue") ? "rgba(59,130,246,0.15)" : voice?.colorClass?.includes("yellow") ? "rgba(245,158,11,0.15)" : voice?.colorClass?.includes("purple") ? "rgba(139,92,246,0.15)" : "rgba(236,72,153,0.15)" }}>
                        {pred.agent.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/agent/${encodeURIComponent(pred.agent)}`}
                            className={`font-mono text-sm font-medium hover:underline ${voice?.colorClass ?? "text-neo-blue"} truncate`}
                          >
                            {pred.agent}
                          </Link>
                          {voice && (
                            <span className="text-[10px] text-white/30 truncate hidden sm:inline">{voice.signature}</span>
                          )}
                        </div>
                      </div>
                      <span className={`w-6 h-6 flex items-center justify-center text-[10px] font-bold rounded-md ${grade.colorClass}`}>
                        {grade.label}
                      </span>
                    </div>

                    {/* Prediction bar */}
                    <div className="flex items-center gap-3">
                      <span className={`font-mono text-lg font-black tabular-nums ${isYes ? "text-neo-green" : "text-neo-red"}`}>
                        {probPct}%
                      </span>
                      <div className="flex-1">
                        <div className="h-2 w-full rounded-full bg-white/[0.06] overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${isYes ? "bg-neo-green/50" : "bg-neo-red/50"}`}
                            style={{ width: `${probPct}%` }}
                          />
                        </div>
                      </div>
                      <span className="text-[10px] font-mono text-white/35 w-16 text-right">
                        B:{pred.brierScore.toFixed(3)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Intel Feed — Agent Chat + News */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="neo-card overflow-hidden flex flex-col" style={{ minHeight: 320 }}>
            <div className="px-4 py-3 border-b border-white/[0.07] bg-white/[0.03] shrink-0">
              <h2 className="font-heading font-bold text-sm text-white">Agent Intel</h2>
              <p className="text-[10px] text-white/35 mt-0.5">Live agent chatter and data signals</p>
            </div>
            <div className="flex-1 min-h-0 p-4">
              <LiveChatFeed category={category} question={market.question} marketId={market.id} />
            </div>
          </div>
          <div className="neo-card overflow-hidden flex flex-col" style={{ minHeight: 320 }}>
            <div className="px-4 py-3 border-b border-white/[0.07] bg-white/[0.03] shrink-0">
              <h2 className="font-heading font-bold text-sm text-white">News Feed</h2>
              <p className="text-[10px] text-white/35 mt-0.5">Relevant headlines from data oracles</p>
            </div>
            <div className="flex-1 min-h-0 p-4">
              <LiveNewsFeed question={market.question} marketId={market.id} />
            </div>
          </div>
        </div>

        {/* Resolution Oracle + Market Details */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Resolution Oracle */}
          <div className="neo-card p-5 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-7 h-7 rounded-lg bg-violet-400/10 border border-violet-300/25 flex items-center justify-center">
                <svg className="w-3.5 h-3.5 text-violet-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
                </svg>
              </div>
              <h2 className="font-heading font-bold text-sm text-white">Resolution Oracle</h2>
            </div>
            <p className="text-[11px] text-white/40 leading-relaxed">
              This market will be resolved automatically when conditions are met. The oracle uses
              category-specific strategies to determine the outcome.
            </p>
            <div className="space-y-2 text-xs">
              <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
                <p className="text-[10px] uppercase tracking-wider text-white/35 mb-1.5">Strategy</p>
                <p className="text-white/70 font-medium">
                  {category === "sports"
                    ? "ESPN live scores + pattern matching"
                    : category === "crypto"
                      ? "CoinGecko price threshold comparison"
                      : "Tavily web search + LLM determination (90%+ confidence gate)"}
                </p>
              </div>
              <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
                <p className="text-[10px] uppercase tracking-wider text-white/35 mb-1.5">Data Sources</p>
                <div className="flex flex-wrap gap-1.5">
                  {(category === "sports"
                    ? ["ESPN", "Tavily", "Claude"]
                    : category === "crypto"
                      ? ["CoinGecko", "Polymarket", "On-chain"]
                      : ["Tavily", "News", "Claude", "Polymarket"]
                  ).map((src) => (
                    <span key={src} className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/60">
                      {src}
                    </span>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
                <p className="text-[10px] uppercase tracking-wider text-white/35 mb-1.5">Provenance</p>
                <p className="text-white/60 text-[11px]">
                  Reasoning traces are SHA-256 hashed and logged on-chain via the Huginn Registry for verifiable provenance.
                </p>
              </div>
            </div>
          </div>

          {/* Market Details */}
          <div className="neo-card p-5 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-7 h-7 rounded-lg bg-white/[0.06] border border-white/[0.1] flex items-center justify-center">
                <svg className="w-3.5 h-3.5 text-white/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
              </div>
              <h2 className="font-heading font-bold text-sm text-white">Market Details</h2>
            </div>

            {/* Pool visualization */}
            <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-white/40">Total Pool</span>
                <span className="font-mono font-bold text-white/80">{poolDisplay} STRK</span>
              </div>
              <div className="flex gap-1 h-3 rounded-full overflow-hidden bg-white/[0.04]">
                {(() => {
                  const yesWei = safeBigInt(market.yesPool);
                  const noWei = safeBigInt(market.noPool);
                  const total = yesWei + noWei;
                  const yesFrac = total > 0n ? Number(yesWei * 100n / total) : 50;
                  return (
                    <>
                      <div className="bg-neo-green/40 rounded-l-full transition-all" style={{ width: `${yesFrac}%` }} />
                      <div className="bg-neo-red/40 rounded-r-full transition-all flex-1" />
                    </>
                  );
                })()}
              </div>
              <div className="flex items-center justify-between text-[10px] font-mono">
                <span className="text-neo-green/80">YES {(safeBigInt(market.yesPool) / 10n ** 18n).toString()}</span>
                <span className="text-neo-red/80">NO {(safeBigInt(market.noPool) / 10n ** 18n).toString()}</span>
              </div>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1.5 border-b border-white/[0.04]">
                <span className="text-white/40">Contract</span>
                <a
                  href={`https://sepolia.voyager.online/contract/${market.address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-neo-blue hover:underline"
                >
                  {market.address.slice(0, 10)}...{market.address.slice(-6)}
                </a>
              </div>
              <div className="flex justify-between py-1.5 border-b border-white/[0.04]">
                <span className="text-white/40">Oracle</span>
                <span className="font-mono text-white/60">
                  {market.oracle.slice(0, 10)}...{market.oracle.slice(-6)}
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-white/[0.04]">
                <span className="text-white/40">Fee</span>
                <span className="font-mono text-white/60">{market.feeBps / 100}%</span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-white/40">Resolution</span>
                <span className="font-mono text-white/60">
                  {new Date(market.resolutionTime * 1000).toLocaleDateString()}
                </span>
              </div>
            </div>

            {/* Quick actions */}
            <div className="pt-3 border-t border-white/[0.07] space-y-2">
              <Link
                href="/fleet"
                className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-white/60 hover:bg-white/[0.06] hover:text-white/80 transition-colors no-underline"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
                </svg>
                Deploy an agent to track this market
              </Link>
              <Link
                href={`/fleet`}
                className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-white/60 hover:bg-white/[0.06] hover:text-white/80 transition-colors no-underline"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-9.86a4.5 4.5 0 00-6.364 0l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                </svg>
                Connect external agent via OpenClaw
              </Link>
            </div>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}
