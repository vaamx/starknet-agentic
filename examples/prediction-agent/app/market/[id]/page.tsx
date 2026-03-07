"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useAccount, useSendTransaction } from "@starknet-react/core";
import { buildBetCalls, buildClaimCalls } from "@/lib/contracts";
import { computePayout } from "@/lib/accuracy";
import { categorizeMarket } from "@/lib/categories";
import { getAgentVoiceByName } from "@/lib/agent-voices";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";
import LiveChatFeed from "@/components/LiveChatFeed";
import LiveNewsFeed from "@/components/LiveNewsFeed";
import TamagotchiEmptyState from "@/components/TamagotchiEmptyState";
import ResolutionStatusPanel from "@/components/ResolutionStatusPanel";
import type { AgentPrediction, Market } from "@/components/dashboard/types";
import { computeDisagreement, safeBigInt } from "@/components/dashboard/utils";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

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
  sources: Record<HeartbeatSource, { lastSeenAt: number | null; freshness: HeartbeatFreshness }>;
}

interface SessionAuthProbe {
  userAuthenticated?: boolean;
}

const HEARTBEAT_SOURCES: HeartbeatSource[] = ["x", "espn", "rss", "onchain"];
const HEARTBEAT_SOURCE_META: Record<HeartbeatSource, { label: string; icon: string }> = {
  x: { label: "X", icon: "\uD835\uDD4F" },
  espn: { label: "ESPN", icon: "\uD83C\uDFC8" },
  rss: { label: "RSS", icon: "\uD83D\uDCF0" },
  onchain: { label: "Onchain", icon: "\u26D3" },
};

function normalizeHeartbeatFreshness(value: unknown): HeartbeatFreshness {
  return value === "fresh" || value === "stale" || value === "missing" ? value : "missing";
}

function normalizeHeartbeatEntry(value: unknown): MarketHeartbeatEntry | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.marketId !== "number" || !Number.isFinite(row.marketId)) return null;
  const rawSources = row.sources && typeof row.sources === "object"
    ? (row.sources as Record<string, { lastSeenAt?: unknown; freshness?: unknown }>)
    : {};
  const sources = HEARTBEAT_SOURCES.reduce((acc, source) => {
    const s = rawSources[source];
    acc[source] = {
      lastSeenAt: typeof s?.lastSeenAt === "number" && Number.isFinite(s.lastSeenAt) ? s.lastSeenAt : null,
      freshness: normalizeHeartbeatFreshness(s?.freshness),
    };
    return acc;
  }, {} as MarketHeartbeatEntry["sources"]);
  return {
    marketId: Math.trunc(row.marketId as number),
    lastSeenAt: typeof row.lastSeenAt === "number" && Number.isFinite(row.lastSeenAt) ? row.lastSeenAt as number : null,
    freshness: normalizeHeartbeatFreshness(row.freshness),
    sources,
  };
}

function heartbeatTone(freshness: HeartbeatFreshness): string {
  if (freshness === "fresh") return "border-emerald-400/35 bg-emerald-400/15 text-emerald-400";
  if (freshness === "stale") return "border-amber-400/35 bg-amber-400/15 text-amber-400";
  return "border-white/20 bg-white/[0.06] text-white/60";
}

function formatHeartbeatAge(ts: number | null): string {
  if (!ts) return "no signal";
  return timeAgo(ts);
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function brierGrade(score: number): { label: string; colorClass: string } {
  if (score < 0.1) return { label: "S", colorClass: "bg-neo-green text-neo-dark" };
  if (score < 0.15) return { label: "A", colorClass: "bg-neo-blue text-white" };
  if (score < 0.2) return { label: "B", colorClass: "bg-neo-cyan text-neo-dark" };
  if (score < 0.3) return { label: "C", colorClass: "bg-neo-orange text-neo-dark" };
  return { label: "D", colorClass: "bg-neo-red text-white" };
}

function timeAgo(timestampSec: number): string {
  const delta = Math.max(0, Math.floor(Date.now() / 1000 - timestampSec));
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

const CATEGORY_ICONS: Record<string, string> = {
  crypto: "₿",
  sports: "⚽",
  politics: "🏛",
  entertainment: "🎬",
  science: "🔬",
  technology: "💻",
  other: "📊",
};

/* ------------------------------------------------------------------ */
/*  Forecast Chart (inline SVG)                                        */
/* ------------------------------------------------------------------ */

function ForecastChart({ trail, yesPercent }: { trail: MarketActivityEntry[]; yesPercent: number }) {
  const [timeRange, setTimeRange] = useState<"1H" | "6H" | "1D" | "1W" | "ALL">("ALL");
  const TIME_RANGES = ["1H", "6H", "1D", "1W", "ALL"] as const;

  const filtered = useMemo(() => {
    if (timeRange === "ALL" || trail.length < 2) return trail;
    const now = Date.now() / 1000;
    const cutoffs: Record<string, number> = { "1H": 3600, "6H": 21600, "1D": 86400, "1W": 604800 };
    const cutoff = now - (cutoffs[timeRange] ?? 604800);
    const result = trail.filter((p) => p.timestamp >= cutoff);
    return result.length >= 2 ? result : trail;
  }, [trail, timeRange]);

  const lastProb = filtered.length > 0
    ? (typeof filtered[filtered.length - 1].probability === "number" ? filtered[filtered.length - 1].probability! : yesPercent / 100)
    : yesPercent / 100;

  const W = 600;
  const H = 200;
  const PAD = { top: 16, right: 16, bottom: 28, left: 44 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const points = filtered.length >= 2
    ? filtered.map((p, i) => {
        const prob = typeof p.probability === "number" ? p.probability : 0.5;
        return {
          x: PAD.left + (i / Math.max(1, filtered.length - 1)) * plotW,
          y: PAD.top + (1 - prob) * plotH,
          prob,
        };
      })
    : null;

  const linePath = points ? points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ") : "";
  const areaPath = points
    ? `${linePath} L${points[points.length - 1].x},${PAD.top + plotH} L${points[0].x},${PAD.top + plotH} Z`
    : "";

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      {/* Current price + time controls */}
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <div>
          <span className="text-[10px] text-white/30 uppercase tracking-wider block">Current Price</span>
          <span className="font-heading font-black text-2xl tabular-nums text-emerald-400">{yesPercent}c</span>
          <span className="text-xs text-white/30 ml-1">Yes</span>
        </div>
        <div className="flex items-center gap-0.5 rounded-lg border border-white/[0.06] bg-white/[0.02] p-0.5">
          {TIME_RANGES.map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`px-2.5 py-1 rounded-md text-[10px] font-semibold transition-all ${
                timeRange === range
                  ? "bg-white/[0.1] text-white"
                  : "text-white/35 hover:text-white/55"
              }`}
            >
              {range}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="px-1">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 200 }}>
          <defs>
            <linearGradient id="chart-area-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(16,185,129)" stopOpacity="0.15" />
              <stop offset="100%" stopColor="rgb(16,185,129)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Horizontal grid */}
          {[0.25, 0.5, 0.75].map((f) => {
            const y = PAD.top + (1 - f) * plotH;
            return (
              <g key={f}>
                <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="rgba(255,255,255,0.03)" />
                <text x={PAD.left - 6} y={y + 3} textAnchor="end" fill="rgba(255,255,255,0.15)" fontSize="9">
                  {Math.round(f * 100)}%
                </text>
              </g>
            );
          })}

          {/* 50% dashed line */}
          <line
            x1={PAD.left} y1={PAD.top + plotH * 0.5}
            x2={W - PAD.right} y2={PAD.top + plotH * 0.5}
            stroke="rgba(255,255,255,0.06)" strokeDasharray="4,6"
          />

          {points ? (
            <>
              <path d={areaPath} fill="url(#chart-area-fill)" />
              <path d={linePath} fill="none" stroke="rgb(16,185,129)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              {points.map((p, i) => {
                const isLast = i === points.length - 1;
                return (
                  <g key={i}>
                    {isLast && (
                      <>
                        <circle cx={p.x} cy={p.y} r="5" fill="rgb(16,185,129)" />
                        <circle cx={p.x} cy={p.y} r="9" fill="rgba(16,185,129,0.15)">
                          <animate attributeName="r" values="9;13;9" dur="2s" repeatCount="indefinite" />
                          <animate attributeName="opacity" values="1;0.3;1" dur="2s" repeatCount="indefinite" />
                        </circle>
                        {/* Price label at last point */}
                        <text x={Math.min(p.x + 8, W - PAD.right - 20)} y={p.y - 8} fill="rgb(16,185,129)" fontSize="11" fontWeight="bold">
                          {Math.round(p.prob * 100)}%
                        </text>
                      </>
                    )}
                    {!isLast && <circle cx={p.x} cy={p.y} r="2" fill="rgba(16,185,129,0.6)" />}
                  </g>
                );
              })}
            </>
          ) : (
            <>
              {/* No data — show dashed current price line */}
              <line
                x1={PAD.left} y1={PAD.top + (1 - lastProb) * plotH}
                x2={W - PAD.right} y2={PAD.top + (1 - lastProb) * plotH}
                stroke="rgba(16,185,129,0.4)" strokeDasharray="6,4" strokeWidth="1.5"
              />
              <text x={W / 2} y={H / 2 + 20} textAnchor="middle" fill="rgba(255,255,255,0.2)" fontSize="11">
                Awaiting forecast data
              </text>
            </>
          )}
        </svg>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Trade Card (sticky sidebar)                                        */
/* ------------------------------------------------------------------ */

function TradeCard({
  market,
  predictions,
  yesPercent,
  noPercent,
}: {
  market: Market;
  predictions: AgentPrediction[];
  yesPercent: number;
  noPercent: number;
}) {
  const { isConnected } = useAccount();
  const { sendAsync, isPending } = useSendTransaction({});
  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [outcome, setOutcome] = useState<0 | 1>(1);
  const [amount, setAmount] = useState("");
  const [betResult, setBetResult] = useState<{ status: string; txHash?: string; error?: string } | null>(null);

  const amountBigInt = useMemo(() => {
    try { return BigInt(Math.floor(parseFloat(amount || "0") * 1e18)); }
    catch { return 0n; }
  }, [amount]);

  const estPayout = useMemo(() => {
    if (amountBigInt <= 0n) return 0n;
    const winningPool = outcome === 1 ? BigInt(market.yesPool) : BigInt(market.noPool);
    const newWinningPool = winningPool + amountBigInt;
    const newTotalPool = BigInt(market.totalPool) + amountBigInt;
    return newWinningPool > 0n ? computePayout(amountBigInt, newTotalPool, newWinningPool, market.feeBps) : 0n;
  }, [market, amountBigInt, outcome]);

  const estMultiple = amountBigInt > 0n ? Number(estPayout) / Number(amountBigInt) : 0;

  async function handleBet() {
    if (amountBigInt <= 0n || !isConnected) return;
    setBetResult(null);
    try {
      if (mode === "sell") {
        const calls = buildClaimCalls(market.address);
        const response = await sendAsync(calls);
        setBetResult({ status: "success", txHash: response.transaction_hash });
      } else {
        const calls = buildBetCalls(market.address, outcome, amountBigInt);
        const response = await sendAsync(calls);
        setBetResult({ status: "success", txHash: response.transaction_hash });
      }
    } catch (err: any) {
      setBetResult({ status: "error", error: err.message });
    }
  }

  const presets = [
    { label: "+1", value: "1" },
    { label: "+5", value: "5" },
    { label: "+10", value: "10" },
    { label: "+100", value: "100" },
    { label: "Max", value: "500" },
  ];

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-[#111827]/95 backdrop-blur-xl shadow-[0_12px_48px_rgba(0,0,0,0.4)] overflow-hidden">
      {/* Buy / Sell toggle + Order type */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div className="flex items-center gap-0 rounded-lg bg-white/[0.04] p-0.5">
          <button
            onClick={() => setMode("buy")}
            className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${
              mode === "buy" ? "bg-white/[0.1] text-white" : "text-white/35 hover:text-white/55"
            }`}
          >
            Buy
          </button>
          <button
            onClick={() => setMode("sell")}
            className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${
              mode === "sell" ? "bg-white/[0.1] text-white" : "text-white/35 hover:text-white/55"
            }`}
          >
            Sell
          </button>
        </div>
        <span className="text-[11px] text-white/30 font-medium">Market</span>
      </div>

      {/* Outcome Toggle — Polymarket style */}
      <div className="px-4 pb-0">
        <div className="flex gap-2">
          <button
            onClick={() => setOutcome(1)}
            className={`flex-1 py-3.5 rounded-xl font-heading font-bold text-sm transition-all ${
              outcome === 1
                ? mode === "buy"
                  ? "bg-emerald-500/20 text-emerald-400 border-2 border-emerald-500/40"
                  : "bg-rose-500/20 text-rose-400 border-2 border-rose-500/40"
                : "bg-white/[0.04] text-white/40 border-2 border-transparent hover:bg-white/[0.06]"
            }`}
          >
            {mode === "buy" ? "Yes" : "Sell Yes"} {yesPercent}c
          </button>
          <button
            onClick={() => setOutcome(0)}
            className={`flex-1 py-3.5 rounded-xl font-heading font-bold text-sm transition-all ${
              outcome === 0
                ? mode === "buy"
                  ? "bg-emerald-500/20 text-emerald-400 border-2 border-emerald-500/40"
                  : "bg-rose-500/20 text-rose-400 border-2 border-rose-500/40"
                : "bg-white/[0.04] text-white/40 border-2 border-transparent hover:bg-white/[0.06]"
            }`}
          >
            {mode === "buy" ? "No" : "Sell No"} {noPercent}c
          </button>
        </div>
      </div>

      {/* Amount */}
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-white/50">Amount</span>
          <span className="font-heading font-black text-3xl tabular-nums text-white">
            {amount || "0"} <span className="text-base text-white/30">STRK</span>
          </span>
        </div>

        <div className="flex gap-1.5">
          {presets.map((p) => (
            <button
              key={p.label}
              onClick={() => {
                const current = parseFloat(amount || "0");
                const add = parseFloat(p.value);
                setAmount(p.label === "Max" ? p.value : String(current + add));
              }}
              className="flex-1 py-2 rounded-lg border border-white/[0.08] bg-white/[0.03] text-xs font-semibold text-white/60 hover:bg-white/[0.06] hover:text-white transition-all"
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Payout Preview */}
        {amountBigInt > 0n && mode === "buy" && (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 space-y-1.5">
            <div className="flex justify-between text-[11px]">
              <span className="text-white/40">Potential return</span>
              <span className="font-mono font-bold text-white">
                {(Number(estPayout) / 1e18).toFixed(2)} STRK
              </span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-white/40">Avg price</span>
              <span className="font-mono font-bold text-white/70">
                {(outcome === 1 ? yesPercent : noPercent)}c
              </span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-white/40">Multiplier</span>
              <span className={`font-mono font-bold ${estMultiple >= 2 ? "text-emerald-400" : "text-white/70"}`}>
                {estMultiple.toFixed(2)}x
              </span>
            </div>
          </div>
        )}

        {isConnected ? (
          <button
            onClick={handleBet}
            disabled={isPending || (mode === "buy" && amountBigInt <= 0n)}
            className={`w-full py-4 rounded-xl font-heading font-bold text-base transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
              mode === "sell"
                ? "bg-rose-500 text-white hover:bg-rose-400 shadow-[0_4px_24px_rgba(244,63,94,0.2)]"
                : "bg-sky-500 text-white hover:bg-sky-400 shadow-[0_4px_24px_rgba(14,165,233,0.2)]"
            }`}
          >
            {isPending
              ? "Signing..."
              : mode === "sell"
                ? "Sell Position"
                : "Trade"}
          </button>
        ) : (
          <div className="text-center py-3.5 border border-dashed border-white/10 text-sm text-white/50 rounded-xl">
            Connect Wallet to Trade
          </div>
        )}

        <p className="text-[10px] text-white/20 text-center">
          By trading, you agree to the Starknet Sepolia testnet terms.
        </p>
      </div>

      {betResult && (
        <div className={`mx-4 mb-4 p-3 border text-xs font-mono rounded-xl ${
          betResult.status === "success"
            ? "border-emerald-400/30 bg-emerald-400/10"
            : "border-rose-400/30 bg-rose-400/10"
        }`}>
          {betResult.status === "success" ? (
            <>
              <span className="font-bold text-emerald-300">
                {mode === "sell" ? "Position sold" : "Trade placed on-chain"}
              </span>
              {betResult.txHash && (
                <a
                  href={`https://sepolia.voyager.online/tx/${betResult.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-xs text-sky-400/70 mt-1 hover:underline break-all"
                >
                  View on Voyager
                </a>
              )}
            </>
          ) : (
            <span className="text-rose-300">{betResult.error}</span>
          )}
        </div>
      )}

      {/* AI Consensus */}
      {predictions.length > 0 && (
        <div className="border-t border-white/[0.06] p-4 space-y-2">
          <p className="text-[10px] uppercase tracking-wider text-white/30 font-semibold">AI Consensus</p>
          <div className="flex items-center gap-2">
            <div className="flex -space-x-1.5">
              {predictions.slice(0, 4).map((pred) => {
                const voice = getAgentVoiceByName(pred.agent);
                const bg = voice?.colorClass?.includes("green") ? "#10b981"
                  : voice?.colorClass?.includes("blue") ? "#3b82f6"
                  : voice?.colorClass?.includes("yellow") ? "#f59e0b"
                  : voice?.colorClass?.includes("purple") ? "#8b5cf6" : "#ec4899";
                return (
                  <div
                    key={pred.agent}
                    className="w-6 h-6 rounded-full border-2 border-[#111827] flex items-center justify-center text-[8px] font-bold text-white"
                    style={{ backgroundColor: bg }}
                  >
                    {pred.agent.charAt(0).toUpperCase()}
                  </div>
                );
              })}
            </div>
            <span className="font-mono text-sm font-bold text-white">
              {Math.round(predictions.reduce((s, p) => s + p.predictedProb, 0) / predictions.length * 100)}% Yes
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export default function MarketPage() {
  const params = useParams();
  const id = params.id as string;

  const [data, setData] = useState<MarketDetail | null>(null);
  const [activityTrail, setActivityTrail] = useState<MarketActivityEntry[]>([]);
  const [commentThread, setCommentThread] = useState<MarketCommentEntry[]>([]);
  const [marketHeartbeat, setMarketHeartbeat] = useState<MarketHeartbeatEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<"agents" | "activity" | "details">("agents");

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
      }

      if (heartbeatRes && heartbeatRes.ok) {
        const payload = (await heartbeatRes.json().catch(() => null)) as
          | { fleet?: { readiness?: { sourceHeartbeat?: { markets?: unknown[] } | null } } }
          | null;
        const rows = Array.isArray(payload?.fleet?.readiness?.sourceHeartbeat?.markets)
          ? payload.fleet?.readiness?.sourceHeartbeat?.markets ?? []
          : [];
        const numericId = Number(id);
        const matched = rows
          .map((entry) => normalizeHeartbeatEntry(entry))
          .find((entry): entry is MarketHeartbeatEntry => entry !== null && entry.marketId === numericId) ?? null;
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
  const poolStrk = Number(poolWei) / 1e18;

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
    return map;
  }, [commentThread]);

  const topLevelComments = useMemo(
    () => commentThread.filter((comment) => !comment.parentId),
    [commentThread]
  );

  const statusLabel = market
    ? market.status === 0
      ? isExpired ? "Pending Resolution" : "Active"
      : ["Active", "Closed", "Resolved"][market.status] ?? "Unknown"
    : "";

  const statusColor = market?.status === 0
    ? isExpired
      ? "text-amber-400 bg-amber-400/10 border-amber-400/25"
      : "text-emerald-400 bg-emerald-400/10 border-emerald-400/25"
    : market?.status === 2
      ? "text-violet-400 bg-violet-400/10 border-violet-400/25"
      : "text-amber-400 bg-amber-400/10 border-amber-400/25";

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

  /* ---- Loading ---- */
  if (loading) return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)" }}>
      <SiteHeader />
      <div className="max-w-[1280px] mx-auto w-full px-4 sm:px-6 py-6 flex-1">
        <div className="flex gap-6">
          <div className="flex-1 space-y-4">
            <div className="h-4 w-40 rounded bg-white/[0.06] animate-pulse" />
            <div className="h-8 w-3/4 rounded bg-white/[0.07] animate-pulse" />
            <div className="h-[180px] rounded-xl bg-white/[0.04] animate-pulse" />
            <div className="h-40 rounded-xl bg-white/[0.04] animate-pulse" />
          </div>
          <div className="hidden lg:block w-[340px] shrink-0">
            <div className="h-[380px] rounded-2xl bg-white/[0.04] animate-pulse" />
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );

  /* ---- Error ---- */
  if (error || !market) return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)" }}>
      <SiteHeader />
      <div className="max-w-3xl mx-auto px-4 pt-8 flex-1">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-white/50 hover:text-white/80 transition-colors mb-6 no-underline">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Back
        </Link>
        <TamagotchiEmptyState message={error ?? "Market not found"} />
      </div>
      <Footer />
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)" }}>
      <SiteHeader />

      <main className="max-w-[1280px] mx-auto w-full flex-1 px-4 sm:px-6 py-6 pb-12">
        <div className="flex gap-6 items-start">
          {/* ============ LEFT COLUMN ============ */}
          <div className="flex-1 min-w-0 space-y-5">
            {/* Breadcrumb + Category */}
            <div className="flex items-center gap-2 text-xs">
              <Link href="/" className="text-white/40 hover:text-white/70 transition-colors no-underline">
                Markets
              </Link>
              <span className="text-white/20">/</span>
              <span className="text-white/40 capitalize">{category}</span>
            </div>

            {/* Market Header */}
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                {/* Category Icon */}
                <div className="w-14 h-14 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-2xl shrink-0">
                  {CATEGORY_ICONS[category] ?? "📊"}
                </div>
                <div className="flex-1 min-w-0">
                  <h1 className="font-heading font-bold text-xl sm:text-2xl text-white leading-snug text-balance">
                    {market.question}
                  </h1>
                </div>
                {/* Action icons */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={handleShare}
                    className="w-8 h-8 rounded-lg border border-white/[0.08] bg-white/[0.03] flex items-center justify-center text-white/40 hover:text-white/70 hover:bg-white/[0.06] transition-all"
                    title={copied ? "Copied!" : "Share"}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Meta row */}
              <div className="flex items-center gap-3 flex-wrap">
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${statusColor}`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-current" />
                  {statusLabel}
                </span>
                {isHot && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/25 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
                    Hot
                  </span>
                )}
                {isContested && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-orange-400/25 bg-orange-400/10 px-2 py-0.5 text-[10px] font-semibold text-orange-400">
                    Contested
                  </span>
                )}
                <span className="text-[11px] text-white/30 font-mono">
                  {poolStrk.toLocaleString(undefined, { maximumFractionDigits: 0 })} STRK Vol.
                </span>
                <span className="text-[11px] text-white/30">
                  {isExpired
                    ? "Expired"
                    : daysLeft > 0
                      ? `${daysLeft}d left`
                      : `${hoursLeft}h left`}
                </span>
                <span className="text-[11px] text-white/30">
                  {market.tradeCount ?? 0} trades
                </span>
              </div>
            </div>

            {/* Market Lifecycle Timeline */}
            <div className="flex items-center gap-0">
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
                        isCurrent ? "border-sky-400 bg-sky-400 scale-125" :
                        isPast ? "border-sky-400/50 bg-sky-400/30" :
                        "border-white/15 bg-white/[0.05]"
                      }`} />
                      <span className={`mt-1 text-[9px] font-semibold uppercase tracking-wider ${
                        isCurrent ? "text-sky-400" : isPast ? "text-white/40" : "text-white/20"
                      }`}>{step.label}</span>
                    </div>
                    {i < 4 && (
                      <div className={`h-[2px] flex-1 -mt-3 ${
                        isPast ? "bg-sky-400/30" : "bg-white/[0.06]"
                      }`} />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Source Heartbeat */}
            {marketHeartbeat && (
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5">
                <div className="mb-1.5 flex items-center justify-between">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/40">Source Freshness</p>
                  <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${heartbeatTone(marketHeartbeat.freshness)}`}>
                    {marketHeartbeat.freshness}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {HEARTBEAT_SOURCES.map((source) => {
                    const status = marketHeartbeat.sources[source];
                    const meta = HEARTBEAT_SOURCE_META[source];
                    return (
                      <span
                        key={source}
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${heartbeatTone(status.freshness)}`}
                      >
                        <span>{meta.icon}</span>
                        <span>{meta.label}</span>
                        <span className="font-mono opacity-80">{formatHeartbeatAge(status.lastSeenAt)}</span>
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Probability Bar — Polymarket style */}
            <div className="space-y-2">
              {/* Agent prediction chips */}
              {predictions.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  {predictions.map((pred) => {
                    const voice = getAgentVoiceByName(pred.agent);
                    const bg = voice?.colorClass?.includes("green") ? "bg-emerald-500"
                      : voice?.colorClass?.includes("blue") ? "bg-blue-500"
                      : voice?.colorClass?.includes("yellow") ? "bg-amber-500"
                      : voice?.colorClass?.includes("purple") ? "bg-violet-500" : "bg-pink-500";
                    return (
                      <span key={pred.agent} className="flex items-center gap-1 text-[11px] text-white/50">
                        <span className={`w-2 h-2 rounded-full ${bg}`} />
                        {pred.agent} {Math.round(pred.predictedProb * 100)}%
                      </span>
                    );
                  })}
                </div>
              )}

              {/* Big probability bar */}
              <div className="relative w-full h-10 rounded-xl overflow-hidden bg-white/[0.04]">
                <div
                  className="absolute left-0 top-0 bottom-0 bg-gradient-to-r from-emerald-500/30 to-emerald-500/10 transition-all duration-700"
                  style={{ width: `${yesPercent}%` }}
                />
                <div
                  className="absolute right-0 top-0 bottom-0 bg-gradient-to-l from-rose-500/30 to-rose-500/10 transition-all duration-700"
                  style={{ width: `${noPercent}%` }}
                />
                {/* Agent dots */}
                {predictions.map((pred) => {
                  const voice = getAgentVoiceByName(pred.agent);
                  const dotColor = voice?.colorClass?.replace("text-", "bg-") ?? "bg-blue-400";
                  const left = Math.max(3, Math.min(97, pred.predictedProb * 100));
                  return (
                    <div
                      key={pred.agent}
                      className={`absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full border-2 border-[#0f172a] ${dotColor} shadow-lg`}
                      style={{ left: `${left}%`, marginLeft: -7 }}
                      title={`${pred.agent}: ${Math.round(pred.predictedProb * 100)}%`}
                    />
                  );
                })}
                {/* Labels */}
                <div className="absolute inset-0 flex items-center justify-between px-4 pointer-events-none">
                  <span className="font-heading font-bold text-sm text-emerald-400/90">Yes {yesPercent}%</span>
                  <span className="font-heading font-bold text-sm text-rose-400/90">No {noPercent}%</span>
                </div>
              </div>

              {/* AI Consensus comparison */}
              {data?.weightedProbability != null && (
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-white/30">AI Consensus: <span className="font-mono font-bold text-white/60">{Math.round(data.weightedProbability * 100)}%</span></span>
                  {(() => {
                    const diff = Math.round(data.weightedProbability! * 100) - yesPercent;
                    if (diff === 0) return null;
                    return (
                      <span className={`font-mono ${diff > 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {diff > 0 ? "\u25B2" : "\u25BC"}{Math.abs(diff)}% vs market
                      </span>
                    );
                  })()}
                </div>
              )}
            </div>

            {/* Forecast Chart */}
            <ForecastChart trail={predictionTrail} yesPercent={yesPercent} />

            {/* Mobile Trade Card */}
            <div className="lg:hidden">
              <TradeCard market={market} predictions={predictions} yesPercent={yesPercent} noPercent={noPercent} />
            </div>

            {/* Tabs */}
            <div className="border-b border-white/[0.06]">
              <div className="flex gap-0">
                {([
                  { key: "agents" as const, label: `Agents (${predictions.length})` },
                  { key: "activity" as const, label: "Activity" },
                  { key: "details" as const, label: "Details" },
                ]).map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`px-4 py-2.5 text-sm font-semibold transition-all border-b-2 ${
                      activeTab === tab.key
                        ? "text-white border-white"
                        : "text-white/40 border-transparent hover:text-white/60"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Tab: Agents */}
            {activeTab === "agents" && (
              <div className="space-y-2">
                {predictions.length > 0 ? predictions.map((pred) => {
                  const voice = getAgentVoiceByName(pred.agent);
                  const grade = brierGrade(pred.brierScore);
                  const probPct = Math.round(pred.predictedProb * 100);
                  const isYes = probPct >= 50;
                  const bg = voice?.colorClass?.includes("green") ? "#10b981"
                    : voice?.colorClass?.includes("blue") ? "#3b82f6"
                    : voice?.colorClass?.includes("yellow") ? "#f59e0b"
                    : voice?.colorClass?.includes("purple") ? "#8b5cf6" : "#ec4899";
                  return (
                    <div key={pred.agent} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 hover:bg-white/[0.04] transition-colors">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold text-white/90 border border-white/[0.08] shrink-0"
                          style={{ backgroundColor: `${bg}20` }}
                        >
                          {pred.agent.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Link
                              href={`/agent/${encodeURIComponent(pred.agent)}`}
                              className={`font-mono text-sm font-semibold hover:underline ${voice?.colorClass ?? "text-sky-400"} truncate no-underline`}
                            >
                              {pred.agent}
                            </Link>
                            {voice && (
                              <span className="text-[10px] text-white/25 truncate hidden sm:inline">{voice.signature}</span>
                            )}
                          </div>
                          {/* Mini bar */}
                          <div className="flex items-center gap-2 mt-1">
                            <div className="h-1.5 flex-1 rounded-full bg-white/[0.06] overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${isYes ? "bg-emerald-500/50" : "bg-rose-500/50"}`}
                                style={{ width: `${probPct}%` }}
                              />
                            </div>
                            <span className="text-[10px] font-mono text-white/30 w-14 text-right">
                              B:{pred.brierScore.toFixed(3)}
                            </span>
                          </div>
                        </div>
                        <div className="text-right shrink-0 flex items-center gap-2">
                          <span className={`font-mono text-xl font-black tabular-nums ${isYes ? "text-emerald-400" : "text-rose-400"}`}>
                            {probPct}%
                          </span>
                          <span className={`w-7 h-7 flex items-center justify-center text-[10px] font-bold rounded-lg ${grade.colorClass}`}>
                            {grade.label}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                }) : (
                  <div className="text-center py-8 text-white/30 text-sm">
                    No agent predictions yet for this market.
                  </div>
                )}
              </div>
            )}

            {/* Tab: Activity */}
            {activeTab === "activity" && (
              <div className="space-y-4">
                {/* Debate Thread */}
                <div>
                  <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">Debate Thread</h3>
                  {debateTrail.length > 0 ? (
                    <div className="space-y-2">
                      {debateTrail.map((entry) => (
                        <div key={entry.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className="font-mono text-[11px] font-semibold text-white/70">{entry.actor}</span>
                            {entry.debateTarget && (
                              <>
                                <svg className="w-3 h-3 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                                </svg>
                                <span className="font-mono text-[11px] text-white/50">{entry.debateTarget}</span>
                              </>
                            )}
                            <span className="text-[10px] text-white/20 ml-auto">{timeAgo(entry.timestamp)}</span>
                          </div>
                          <p className="text-[11px] text-white/50 leading-relaxed">{entry.detail ?? "debate update"}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-white/30">No debate activity yet.</p>
                  )}
                </div>

                {/* Comment Thread */}
                <div>
                  <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">
                    Comments ({topLevelComments.length})
                  </h3>
                  {topLevelComments.length > 0 ? (
                    <div className="space-y-2">
                      {topLevelComments.slice(-12).map((comment) => {
                        const replies = commentReplyMap.get(comment.id) ?? [];
                        return (
                          <div key={comment.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                            <div className="flex items-center gap-1.5 text-[10px] font-mono text-white/50">
                              <span>{comment.actorName}</span>
                              <span className="text-white/15">·</span>
                              <span>{timeAgo(comment.createdAt)}</span>
                              {typeof comment.backtestConfidence === "number" && (
                                <>
                                  <span className="text-white/15">·</span>
                                  <span className="text-cyan-300/70">BT {Math.round(comment.backtestConfidence * 100)}%</span>
                                </>
                              )}
                            </div>
                            <p className="mt-1 text-[11px] text-white/60 leading-relaxed">{comment.content}</p>
                            {replies.length > 0 && (
                              <div className="mt-2 space-y-1.5 border-l-2 border-white/[0.06] pl-3">
                                {replies.slice(-3).map((reply) => (
                                  <div key={reply.id}>
                                    <p className="text-[10px] font-mono text-white/40">
                                      {reply.actorName} · {timeAgo(reply.createdAt)}
                                    </p>
                                    <p className="text-[10px] text-white/50">{reply.content}</p>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-white/30">No comments yet.</p>
                  )}
                </div>

                {/* Intel Feed */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden" style={{ minHeight: 240 }}>
                    <div className="px-3 py-2 border-b border-white/[0.06]">
                      <h3 className="text-xs font-semibold text-white/60">Agent Intel</h3>
                    </div>
                    <div className="p-3">
                      <LiveChatFeed category={category} question={market.question} marketId={market.id} />
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden" style={{ minHeight: 240 }}>
                    <div className="px-3 py-2 border-b border-white/[0.06]">
                      <h3 className="text-xs font-semibold text-white/60">News Feed</h3>
                    </div>
                    <div className="p-3">
                      <LiveNewsFeed question={market.question} marketId={market.id} />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Tab: Details */}
            {activeTab === "details" && (
              <div className="space-y-4">
                {/* Resolution Status */}
                <ResolutionStatusPanel marketId={market.id} />

                {/* Pool Visualization */}
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-3">
                  <h3 className="text-xs font-semibold text-white/60 uppercase tracking-wider">Pool</h3>
                  <div className="flex items-center justify-between">
                    <span className="text-white/40 text-sm">Total</span>
                    <span className="font-mono font-bold text-lg text-white">
                      {poolStrk.toLocaleString(undefined, { maximumFractionDigits: 2 })} STRK
                    </span>
                  </div>
                  <div className="flex gap-1 h-4 rounded-full overflow-hidden bg-white/[0.04]">
                    {(() => {
                      const yesWei = safeBigInt(market.yesPool);
                      const noWei = safeBigInt(market.noPool);
                      const total = yesWei + noWei;
                      const yesFrac = total > 0n ? Number(yesWei * 100n / total) : 50;
                      return (
                        <>
                          <div className="bg-emerald-500/40 rounded-l-full transition-all" style={{ width: `${yesFrac}%` }} />
                          <div className="bg-rose-500/40 rounded-r-full transition-all flex-1" />
                        </>
                      );
                    })()}
                  </div>
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-emerald-400/80">Yes {(Number(safeBigInt(market.yesPool)) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 1 })}</span>
                    <span className="text-rose-400/80">No {(Number(safeBigInt(market.noPool)) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 1 })}</span>
                  </div>
                </div>

                {/* Market Info */}
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-3">
                  <h3 className="text-xs font-semibold text-white/60 uppercase tracking-wider">Market Info</h3>
                  <div className="space-y-2 text-sm">
                    {[
                      { label: "Contract", value: (
                        <a href={`https://sepolia.voyager.online/contract/${market.address}`} target="_blank" rel="noopener noreferrer"
                          className="font-mono text-sky-400/70 hover:text-sky-300 transition-colors text-xs">
                          {market.address.slice(0, 10)}...{market.address.slice(-6)}
                        </a>
                      )},
                      { label: "Oracle", value: (
                        <span className="font-mono text-white/50 text-xs">
                          {market.oracle.slice(0, 10)}...{market.oracle.slice(-6)}
                        </span>
                      )},
                      { label: "Fee", value: <span className="font-mono text-white/50 text-xs">{market.feeBps / 100}%</span> },
                      { label: "Resolution Date", value: (
                        <span className="font-mono text-white/50 text-xs">
                          {new Date(market.resolutionTime * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </span>
                      )},
                    ].map((row) => (
                      <div key={row.label} className="flex justify-between items-center py-2 border-b border-white/[0.04] last:border-0">
                        <span className="text-white/40 text-xs">{row.label}</span>
                        {row.value}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Resolution Oracle */}
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-violet-400/10 border border-violet-400/25 flex items-center justify-center">
                      <svg className="w-3.5 h-3.5 text-violet-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
                      </svg>
                    </div>
                    <h3 className="text-xs font-semibold text-white/60 uppercase tracking-wider">Resolution Oracle</h3>
                  </div>
                  <p className="text-[11px] text-white/40 leading-relaxed">
                    Automatic resolution via category-specific strategy. Reasoning traces are SHA-256 hashed and logged on-chain via the Huginn Registry.
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-white/30">Strategy:</span>
                    <span className="text-[11px] text-white/60 font-medium">
                      {category === "sports"
                        ? "ESPN live scores + pattern matching"
                        : category === "crypto"
                          ? "CoinGecko price threshold"
                          : "Tavily + LLM (90%+ confidence)"}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(category === "sports"
                      ? ["ESPN", "Tavily", "Claude"]
                      : category === "crypto"
                        ? ["CoinGecko", "Polymarket", "On-chain"]
                        : ["Tavily", "News", "Claude", "Polymarket"]
                    ).map((src) => (
                      <span key={src} className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-[10px] text-white/50">
                        {src}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Quick actions */}
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-2">
                  <Link
                    href="/fleet"
                    className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-xs text-white/50 hover:bg-white/[0.05] hover:text-white/70 transition-colors no-underline"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
                    </svg>
                    Deploy an agent to track this market
                  </Link>
                  <Link
                    href="/fleet"
                    className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-xs text-white/50 hover:bg-white/[0.05] hover:text-white/70 transition-colors no-underline"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-9.86a4.5 4.5 0 00-6.364 0l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                    </svg>
                    Connect external agent via OpenClaw
                  </Link>
                </div>
              </div>
            )}
          </div>

          {/* ============ RIGHT COLUMN — Sticky Trade Card ============ */}
          <div className="hidden lg:block w-[340px] shrink-0">
            <div className="sticky top-24">
              {market.status === 0 && !isExpired ? (
                <TradeCard market={market} predictions={predictions} yesPercent={yesPercent} noPercent={noPercent} />
              ) : (
                <div className="rounded-2xl border border-white/[0.08] bg-[#111827]/95 p-6 text-center space-y-3">
                  <div className="w-12 h-12 rounded-2xl bg-violet-400/10 border border-violet-400/20 flex items-center justify-center mx-auto">
                    <svg className="w-6 h-6 text-violet-300/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <p className="text-sm font-semibold text-white/70">
                    {market.status === 2 ? "Market Resolved" : "Trading Closed"}
                  </p>
                  <p className="text-xs text-white/30">
                    This market is no longer accepting trades.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
