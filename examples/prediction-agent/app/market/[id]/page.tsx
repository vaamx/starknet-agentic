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

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function brierGrade(score: number): { label: string; colorClass: string } {
  if (score < 0.1) return { label: "S", colorClass: "bg-emerald-400 text-black" };
  if (score < 0.15) return { label: "A", colorClass: "bg-sky-400 text-black" };
  if (score < 0.2) return { label: "B", colorClass: "bg-cyan-400 text-black" };
  if (score < 0.3) return { label: "C", colorClass: "bg-amber-400 text-black" };
  return { label: "D", colorClass: "bg-rose-400 text-black" };
}

function timeAgo(timestampSec: number): string {
  const delta = Math.max(0, Math.floor(Date.now() / 1000 - timestampSec));
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

/** Display a readable agent name — truncate hex addresses. */
function displayName(name: string): string {
  if (/^0x[0-9a-fA-F]{20,}$/.test(name)) {
    return `${name.slice(0, 6)}...${name.slice(-4)}`;
  }
  return name;
}

const AGENT_COLORS: Record<string, string> = {
  "text-neo-green": "#22c55e",
  "text-neo-blue": "#4c8dff",
  "text-neo-purple": "#7c5cff",
  "text-neo-yellow": "#f5b942",
  "text-neo-pink": "#e63946",
};

function agentColor(agent: string): string {
  const voice = getAgentVoiceByName(agent);
  return AGENT_COLORS[voice?.colorClass ?? ""] ?? "#4c8dff";
}

/* ------------------------------------------------------------------ */
/*  Price Chart                                                         */
/* ------------------------------------------------------------------ */

function PriceChart({ trail, yesPercent, noPercent, predictions }: { trail: MarketActivityEntry[]; yesPercent: number; noPercent: number; predictions: AgentPrediction[] }) {
  const [range, setRange] = useState<"1H" | "6H" | "1D" | "1W" | "ALL">("ALL");

  const filtered = useMemo(() => {
    if (range === "ALL" || trail.length < 2) return trail;
    const now = Date.now() / 1000;
    const secs: Record<string, number> = { "1H": 3600, "6H": 21600, "1D": 86400, "1W": 604800 };
    const cutoff = now - (secs[range] ?? 604800);
    const r = trail.filter((p) => p.timestamp >= cutoff);
    return r.length >= 2 ? r : trail;
  }, [trail, range]);

  const currentPrice = filtered.length > 0
    ? Math.round((filtered[filtered.length - 1].probability ?? yesPercent / 100) * 100)
    : yesPercent;

  const prevPrice = filtered.length > 1
    ? Math.round((filtered[0].probability ?? yesPercent / 100) * 100)
    : currentPrice;

  const priceChange = currentPrice - prevPrice;

  // Chart dimensions
  const W = 800;
  const H = 320;
  const PAD = { top: 24, right: 24, bottom: 24, left: 52 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  // Y-axis: always show 0-100% range so flat data still looks meaningful
  const minP = 0;
  const maxP = 1;
  const rangeP = 1;

  const points = filtered.length >= 2
    ? filtered.map((p, i) => {
        const prob = typeof p.probability === "number" ? p.probability : 0.5;
        return {
          x: PAD.left + (i / Math.max(1, filtered.length - 1)) * plotW,
          y: PAD.top + (1 - (prob - minP) / rangeP) * plotH,
          prob,
        };
      })
    : null;

  // Smooth curve using cardinal spline
  function cardinalSpline(pts: { x: number; y: number }[]): string {
    if (pts.length < 2) return "";
    if (pts.length === 2) return `M${pts[0].x},${pts[0].y} L${pts[1].x},${pts[1].y}`;
    let path = `M${pts[0].x},${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      path += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
    }
    return path;
  }

  const linePath = points ? cardinalSpline(points) : "";
  const areaPath = points
    ? `${linePath} L${points[points.length - 1].x},${PAD.top + plotH} L${points[0].x},${PAD.top + plotH} Z`
    : "";

  const isPositive = priceChange >= 0;
  const accentColor = yesPercent >= 50 ? "#22c55e" : "#ef4444";

  // Grid lines at 0%, 25%, 50%, 75%, 100%
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((frac) => ({
    y: PAD.top + (1 - frac) * plotH,
    label: `${Math.round(frac * 100)}%`,
    isMajor: frac === 0.5,
  }));

  return (
    <div className="space-y-4">
      {/* ---- Probability Outcome Bar ---- */}
      <div className="rounded-2xl overflow-hidden p-5" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            {predictions.length > 0 && (
              <div className="flex -space-x-1.5">
                {predictions.slice(0, 5).map((pred) => (
                  <div
                    key={pred.agent}
                    className="w-6 h-6 rounded-full border-2 border-[#12141a] flex items-center justify-center text-[8px] font-bold text-white"
                    style={{ backgroundColor: agentColor(pred.agent) }}
                  >
                    {displayName(pred.agent).charAt(0).toUpperCase()}
                  </div>
                ))}
              </div>
            )}
            <span className="text-xs text-white/40">{predictions.length} agents forecasting</span>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="text-emerald-400 font-bold">Yes {yesPercent}%</span>
            <span className="text-rose-400 font-bold">No {noPercent}%</span>
          </div>
        </div>
        {/* Colored bar */}
        <div className="relative h-10 rounded-xl overflow-hidden">
          <div className="absolute inset-0 flex">
            <div
              className="h-full transition-all duration-700 ease-out"
              style={{
                width: `${yesPercent}%`,
                background: "linear-gradient(90deg, #059669 0%, #10b981 50%, #34d399 100%)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.15), 0 0 20px rgba(16,185,129,0.3)",
              }}
            />
            <div
              className="h-full flex-1 transition-all duration-700 ease-out"
              style={{
                background: "linear-gradient(90deg, #e11d48 0%, #f43f5e 50%, #fb7185 100%)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.1), 0 0 20px rgba(244,63,94,0.2)",
              }}
            />
          </div>
          {/* Labels inside bar */}
          <div className="absolute inset-0 flex items-center justify-between px-4 pointer-events-none">
            <span className="text-sm font-bold text-white drop-shadow-lg">
              Yes {yesPercent}%
            </span>
            <span className="text-sm font-bold text-white drop-shadow-lg">
              No {noPercent}%
            </span>
          </div>
        </div>
      </div>

      {/* ---- Price + Chart ---- */}
      <div className="rounded-2xl overflow-hidden" style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.025) 0%, rgba(255,255,255,0.005) 100%)", border: "1px solid rgba(255,255,255,0.06)" }}>
        {/* Price header */}
        <div className="flex items-end justify-between px-5 pt-5 pb-3">
          <div>
            <span className="text-[10px] uppercase tracking-widest text-white/25 font-semibold block mb-1">Current Price</span>
            <div className="flex items-baseline gap-2">
              <span className="text-[48px] font-bold tracking-tight leading-none tabular-nums" style={{ color: accentColor }}>
                {currentPrice}
              </span>
              <span className="text-xl text-white/25 font-light">&cent;</span>
              {priceChange !== 0 && (
                <span className={`text-sm font-semibold ml-1 ${isPositive ? "text-emerald-400" : "text-rose-400"}`}>
                  {isPositive ? "+" : ""}{priceChange}&cent;
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-0.5 rounded-xl p-1" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
            {(["1H", "6H", "1D", "1W", "ALL"] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all ${
                  range === r
                    ? "bg-white/10 text-white shadow-sm"
                    : "text-white/25 hover:text-white/50"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {/* SVG Chart */}
        <div className="px-1 pb-1">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 320, display: "block" }}>
            <defs>
              <linearGradient id="area-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={accentColor} stopOpacity="0.20" />
                <stop offset="40%" stopColor={accentColor} stopOpacity="0.08" />
                <stop offset="100%" stopColor={accentColor} stopOpacity="0" />
              </linearGradient>
              <filter id="glow">
                <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                <feMerge>
                  <feMergeNode in="coloredBlur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <linearGradient id="line-grad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor={accentColor} stopOpacity="0.4" />
                <stop offset="50%" stopColor={accentColor} stopOpacity="1" />
                <stop offset="100%" stopColor={accentColor} stopOpacity="1" />
              </linearGradient>
            </defs>

            {/* Grid */}
            {gridLines.map((g, i) => (
              <g key={i}>
                <line
                  x1={PAD.left} y1={g.y} x2={W - PAD.right} y2={g.y}
                  stroke={g.isMajor ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.025)"}
                  strokeDasharray={g.isMajor ? "6,4" : "none"}
                />
                <text x={PAD.left - 10} y={g.y + 4} textAnchor="end" fill="rgba(255,255,255,0.15)" fontSize="10" fontFamily="monospace">
                  {g.label}
                </text>
              </g>
            ))}

            {points ? (
              <>
                {/* Area fill */}
                <path d={areaPath} fill="url(#area-grad)" />
                {/* Glow line (behind) */}
                <path d={linePath} fill="none" stroke={accentColor} strokeWidth="6" strokeLinecap="round" opacity="0.15" filter="url(#glow)" />
                {/* Main line */}
                <path d={linePath} fill="none" stroke="url(#line-grad)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                {/* Data points */}
                {points.map((p, i) => {
                  const isLast = i === points.length - 1;
                  if (!isLast && points.length > 10) return null; // Only show dots if few points
                  return isLast ? (
                    <g key={i}>
                      <circle cx={p.x} cy={p.y} r="5" fill={accentColor} />
                      <circle cx={p.x} cy={p.y} r="12" fill={accentColor} opacity="0.15">
                        <animate attributeName="r" values="12;20;12" dur="2.5s" repeatCount="indefinite" />
                        <animate attributeName="opacity" values="0.15;0;0.15" dur="2.5s" repeatCount="indefinite" />
                      </circle>
                      {/* Price label */}
                      <rect x={p.x - 28} y={p.y - 28} width="56" height="20" rx="6" fill="rgba(0,0,0,0.7)" stroke={accentColor} strokeWidth="1" opacity="0.9" />
                      <text x={p.x} y={p.y - 14} textAnchor="middle" fill="white" fontSize="11" fontWeight="bold" fontFamily="monospace">
                        {Math.round(p.prob * 100)}%
                      </text>
                    </g>
                  ) : (
                    <circle key={i} cx={p.x} cy={p.y} r="2.5" fill={accentColor} opacity="0.4" />
                  );
                })}
              </>
            ) : (
              <>
                {/* No data — show current price as horizontal line */}
                <line
                  x1={PAD.left} y1={PAD.top + (1 - yesPercent / 100) * plotH}
                  x2={W - PAD.right} y2={PAD.top + (1 - yesPercent / 100) * plotH}
                  stroke={accentColor} strokeDasharray="8,6" strokeWidth="2" opacity="0.4"
                />
                {/* Glow at the current level */}
                <line
                  x1={PAD.left} y1={PAD.top + (1 - yesPercent / 100) * plotH}
                  x2={W - PAD.right} y2={PAD.top + (1 - yesPercent / 100) * plotH}
                  stroke={accentColor} strokeWidth="8" opacity="0.06" filter="url(#glow)"
                />
                {/* Price tag */}
                <rect x={W / 2 - 36} y={PAD.top + (1 - yesPercent / 100) * plotH - 14} width="72" height="22" rx="6" fill="rgba(0,0,0,0.6)" stroke={accentColor} strokeWidth="1" />
                <text x={W / 2} y={PAD.top + (1 - yesPercent / 100) * plotH + 1} textAnchor="middle" fill={accentColor} fontSize="12" fontWeight="bold" fontFamily="monospace">
                  {yesPercent}% Yes
                </text>
                <text x={W / 2} y={H - 8} textAnchor="middle" fill="rgba(255,255,255,0.1)" fontSize="12">
                  Forecast data building...
                </text>
              </>
            )}
          </svg>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Trade Sidebar                                                       */
/* ------------------------------------------------------------------ */

function TradeSidebar({
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

  const amountNum = parseFloat(amount || "0");
  const amountBigInt = useMemo(() => {
    try { return BigInt(Math.floor(amountNum * 1e18)); }
    catch { return 0n; }
  }, [amountNum]);

  // Payout calculations
  const estPayout = useMemo(() => {
    if (amountBigInt <= 0n) return 0n;
    const winningPool = outcome === 1 ? BigInt(market.yesPool) : BigInt(market.noPool);
    const newWinningPool = winningPool + amountBigInt;
    const newTotalPool = BigInt(market.totalPool) + amountBigInt;
    return newWinningPool > 0n ? computePayout(amountBigInt, newTotalPool, newWinningPool, market.feeBps) : 0n;
  }, [market, amountBigInt, outcome]);

  const estPayoutStrk = Number(estPayout) / 1e18;
  const estProfit = estPayoutStrk - amountNum;
  const estMultiple = amountNum > 0 ? estPayoutStrk / amountNum : 0;
  const costPerShare = outcome === 1 ? yesPercent : noPercent; // cost in cents to win 100 cents

  // Pool stats
  const yesPoolStrk = Number(safeBigInt(market.yesPool)) / 1e18;
  const noPoolStrk = Number(safeBigInt(market.noPool)) / 1e18;
  const totalPoolStrk = Number(safeBigInt(market.totalPool)) / 1e18;

  async function handleTrade() {
    if (!isConnected) return;
    if (mode === "buy" && amountBigInt <= 0n) return;
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
    } catch (err: unknown) {
      setBetResult({ status: "error", error: err instanceof Error ? err.message : String(err) });
    }
  }

  const outcomeLabel = outcome === 1 ? "Yes" : "No";
  const outcomeColor = outcome === 1 ? "emerald" : "rose";

  return (
    <div className="rounded-2xl border border-white/[0.08] overflow-hidden" style={{ background: "rgba(17,24,39,0.95)", backdropFilter: "blur(24px)" }}>
      {/* Buy / Sell tabs */}
      <div className="flex border-b border-white/[0.06]">
        {(["buy", "sell"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`flex-1 py-3 text-sm font-semibold capitalize transition-all ${
              mode === m
                ? "text-white border-b-2 border-white"
                : "text-white/30 hover:text-white/50"
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      <div className="p-4 space-y-3">
        {/* Outcome choice */}
        <div>
          <p className="text-[10px] uppercase tracking-widest text-white/30 font-semibold mb-2">Outcome</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setOutcome(1)}
              className={`relative py-3 rounded-xl text-sm font-bold transition-all ${
                outcome === 1
                  ? "bg-emerald-500/15 text-emerald-400 ring-2 ring-emerald-500/40"
                  : "bg-white/[0.04] text-white/40 hover:bg-white/[0.06]"
              }`}
            >
              <div>Yes</div>
              <div className={`text-[10px] font-normal mt-0.5 ${outcome === 1 ? "text-emerald-400/60" : "text-white/20"}`}>
                {yesPercent}&cent; per share
              </div>
            </button>
            <button
              onClick={() => setOutcome(0)}
              className={`relative py-3 rounded-xl text-sm font-bold transition-all ${
                outcome === 0
                  ? "bg-rose-500/15 text-rose-400 ring-2 ring-rose-500/40"
                  : "bg-white/[0.04] text-white/40 hover:bg-white/[0.06]"
              }`}
            >
              <div>No</div>
              <div className={`text-[10px] font-normal mt-0.5 ${outcome === 0 ? "text-rose-400/60" : "text-white/20"}`}>
                {noPercent}&cent; per share
              </div>
            </button>
          </div>
        </div>

        {/* Amount */}
        <div>
          <p className="text-[10px] uppercase tracking-widest text-white/30 font-semibold mb-2">Amount (STRK)</p>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            min="0"
            step="1"
            className="w-full text-center text-3xl font-bold tabular-nums text-white bg-transparent border-b-2 border-white/10 focus:border-white/30 outline-none py-2 transition-colors [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <div className="grid grid-cols-5 gap-1.5 mt-3">
            {[1, 5, 10, 50, 100].map((val) => (
              <button
                key={val}
                onClick={() => setAmount(String(amountNum + val))}
                className="py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.06] text-[11px] font-semibold text-white/50 hover:bg-white/[0.08] hover:text-white/80 transition-all"
              >
                +{val}
              </button>
            ))}
          </div>
        </div>

        {/* Odds & Payout breakdown — always visible */}
        <div className="rounded-xl bg-white/[0.025] border border-white/[0.05] p-3 space-y-2.5">
          <div className="flex justify-between text-xs">
            <span className="text-white/35">Cost per share</span>
            <span className="font-mono text-white/70">{costPerShare}&cent;</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-white/35">Payout if {outcomeLabel} wins</span>
            <span className="font-mono text-white/70">100&cent; per share</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-white/35">Implied odds</span>
            <span className="font-mono text-white/70">{costPerShare}% chance</span>
          </div>
          {amountNum > 0 && mode === "buy" && (
            <>
              <div className="border-t border-white/[0.04] pt-2.5 flex justify-between text-xs">
                <span className="text-white/35">You pay</span>
                <span className="font-mono font-bold text-white">{amountNum.toFixed(1)} STRK</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-white/35">To win</span>
                <span className={`font-mono font-bold text-${outcomeColor}-400`}>{estPayoutStrk.toFixed(2)} STRK</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-white/35">Profit if correct</span>
                <span className={`font-mono font-bold ${estProfit > 0 ? `text-${outcomeColor}-400` : "text-white/50"}`}>
                  +{estProfit.toFixed(2)} STRK ({estMultiple.toFixed(1)}x)
                </span>
              </div>
            </>
          )}
        </div>

        {/* Trade button */}
        {isConnected ? (
          <button
            onClick={handleTrade}
            disabled={isPending || (mode === "buy" && amountBigInt <= 0n)}
            className={`w-full py-3.5 rounded-xl font-bold text-sm transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
              mode === "sell"
                ? "bg-rose-500 hover:bg-rose-400 text-white"
                : outcome === 1
                  ? "bg-emerald-500 hover:bg-emerald-400 text-white"
                  : "bg-rose-500 hover:bg-rose-400 text-white"
            }`}
          >
            {isPending
              ? "Confirming..."
              : mode === "sell"
                ? "Sell Position"
                : amountNum > 0
                  ? `Buy ${outcomeLabel} \u2014 ${amountNum} STRK`
                  : `Buy ${outcomeLabel}`}
          </button>
        ) : (
          <button
            className="w-full py-3.5 rounded-xl font-bold text-sm bg-white/[0.06] text-white/40 border border-dashed border-white/10 cursor-default"
            disabled
          >
            Connect Wallet to Trade
          </button>
        )}

        {mode === "buy" && (
          <p className="text-[10px] text-white/20 text-center leading-relaxed">
            If {outcomeLabel} wins, each share pays 1 STRK. Cost: {costPerShare}&cent;/share.
          </p>
        )}
      </div>

      {/* Tx result */}
      {betResult && (
        <div className={`mx-4 mb-4 p-3 rounded-xl text-xs font-mono ${
          betResult.status === "success"
            ? "bg-emerald-500/10 border border-emerald-500/20"
            : "bg-rose-500/10 border border-rose-500/20"
        }`}>
          {betResult.status === "success" ? (
            <>
              <span className="text-emerald-300 font-bold">
                {mode === "sell" ? "Position sold" : "Trade placed on-chain"}
              </span>
              {betResult.txHash && (
                <a
                  href={`https://sepolia.voyager.online/tx/${betResult.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-sky-400/70 mt-1 hover:underline break-all"
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

      {/* Pool Stats */}
      <div className="border-t border-white/[0.06] p-4 space-y-2.5">
        <p className="text-[10px] uppercase tracking-widest text-white/25 font-semibold">Pool</p>
        <div className="flex gap-0.5 h-2 rounded-full overflow-hidden bg-white/[0.04]">
          <div className="bg-emerald-500/60 rounded-l-full transition-all" style={{ width: `${totalPoolStrk > 0 ? (yesPoolStrk / totalPoolStrk * 100) : 50}%` }} />
          <div className="bg-rose-500/60 rounded-r-full transition-all flex-1" />
        </div>
        <div className="flex justify-between text-[11px] font-mono">
          <span className="text-emerald-400/60">Yes: {yesPoolStrk.toFixed(1)}</span>
          <span className="text-white/30">{totalPoolStrk.toFixed(1)} STRK total</span>
          <span className="text-rose-400/60">No: {noPoolStrk.toFixed(1)}</span>
        </div>
        <div className="flex justify-between text-[10px] text-white/20">
          <span>{market.tradeCount ?? 0} trades</span>
          <span>Fee: {market.feeBps / 100}%</span>
        </div>
      </div>

      {/* AI Consensus */}
      {predictions.length > 0 && (
        <div className="border-t border-white/[0.06] p-4">
          <p className="text-[10px] uppercase tracking-widest text-white/25 font-semibold mb-2">AI Consensus</p>
          <div className="flex items-center gap-2.5">
            <div className="flex -space-x-1">
              {predictions.slice(0, 5).map((pred) => (
                <div
                  key={pred.agent}
                  className="w-5 h-5 rounded-full border-[1.5px] border-[#111827] flex items-center justify-center text-[7px] font-bold text-white"
                  style={{ backgroundColor: agentColor(pred.agent) }}
                >
                  {displayName(pred.agent).charAt(0).toUpperCase()}
                </div>
              ))}
            </div>
            <span className="text-sm font-bold text-white tabular-nums">
              {Math.round(predictions.reduce((s, p) => s + p.predictedProb, 0) / predictions.length * 100)}% Yes
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Agent Row (Polymarket outcome-row style)                            */
/* ------------------------------------------------------------------ */

function AgentRow({ pred, marketYesPct }: { pred: AgentPrediction; marketYesPct: number }) {
  const voice = getAgentVoiceByName(pred.agent);
  const probPct = Math.round(pred.predictedProb * 100);
  const isYes = probPct >= 50;
  const color = agentColor(pred.agent);
  const grade = brierGrade(pred.brierScore);
  const name = displayName(pred.agent);
  const diff = probPct - marketYesPct;

  return (
    <Link
      href={`/agent/${encodeURIComponent(pred.agent)}`}
      className="flex items-center gap-4 py-4 px-4 rounded-xl hover:bg-white/[0.03] transition-colors group no-underline"
    >
      {/* Avatar */}
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0"
        style={{ backgroundColor: `${color}20`, border: `1.5px solid ${color}40` }}
      >
        {name.charAt(0).toUpperCase()}
      </div>

      {/* Name + meta */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm text-white group-hover:text-white/90 truncate">
            {name}
          </span>
          {voice && (
            <span className="text-[11px] text-white/20 hidden sm:inline">{voice.signature}</span>
          )}
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${grade.colorClass}`}>
            {grade.label}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-white/25 font-mono">
          <span>Brier: {pred.brierScore.toFixed(3)}</span>
          <span className="text-white/10">|</span>
          <span>{pred.predictionCount} predictions</span>
          {diff !== 0 && (
            <>
              <span className="text-white/10">|</span>
              <span className={diff > 0 ? "text-emerald-400/60" : "text-rose-400/60"}>
                {diff > 0 ? "+" : ""}{diff}% vs market
              </span>
            </>
          )}
        </div>
      </div>

      {/* Forecast */}
      <div className="text-right shrink-0">
        <span className={`text-2xl font-bold tabular-nums ${isYes ? "text-emerald-400" : "text-rose-400"}`}>
          {probPct}%
        </span>
        <div className="text-[10px] text-white/20 mt-0.5">
          {isYes ? "Yes" : "No"}
        </div>
      </div>
    </Link>
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

  /* ---- Fetch ---- */
  const fetchMarket = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let canFetchOrgData = false;
      try {
        const sessionRes = await fetch("/api/auth/session", { cache: "no-store", credentials: "include" });
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
          ? fetch(`/api/agent-comments?marketId=${id}&limit=120&order=asc`, { cache: "no-store", credentials: "include" }).catch(() => null)
          : Promise.resolve(null),
        canFetchOrgData
          ? fetch(`/api/fleet?marketIds=${encodeURIComponent(id)}`, { cache: "no-store", credentials: "include" }).catch(() => null)
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
        const entries = Array.isArray(payload.activities) ? (payload.activities as MarketActivityEntry[]) : [];
        const numericId = Number(id);
        setActivityTrail(
          entries
            .filter((e) => e.marketId === numericId && (e.type === "prediction" || e.type === "debate" || e.type === "bet"))
            .sort((a, b) => a.timestamp - b.timestamp)
            .slice(-60)
        );
      }

      if (commentRes && commentRes.ok) {
        const payload = (await commentRes.json().catch(() => null)) as { comments?: unknown[] } | null;
        const comments = Array.isArray(payload?.comments)
          ? payload.comments
              .map((entry) => {
                const row = entry as Partial<MarketCommentEntry>;
                if (!row.id || typeof row.marketId !== "number" || !row.actorName || !row.content || typeof row.createdAt !== "number") return null;
                return {
                  id: row.id,
                  marketId: row.marketId,
                  parentId: typeof row.parentId === "string" ? row.parentId : null,
                  actorName: row.actorName,
                  content: row.content,
                  sourceType: typeof row.sourceType === "string" ? row.sourceType : "agent",
                  reliabilityScore: typeof row.reliabilityScore === "number" ? Math.max(0, Math.min(1, row.reliabilityScore)) : null,
                  backtestConfidence: typeof row.backtestConfidence === "number" ? Math.max(0, Math.min(1, row.backtestConfidence)) : null,
                  createdAt: row.createdAt,
                } satisfies MarketCommentEntry;
              })
              .filter((e): e is MarketCommentEntry => Boolean(e))
          : [];
        setCommentThread(comments);
      }

      if (heartbeatRes && heartbeatRes.ok) {
        const payload = (await heartbeatRes.json().catch(() => null)) as
          | { fleet?: { readiness?: { sourceHeartbeat?: { markets?: unknown[] } | null } } }
          | null;
        const rows = Array.isArray(payload?.fleet?.readiness?.sourceHeartbeat?.markets)
          ? payload.fleet.readiness.sourceHeartbeat!.markets!
          : [];
        const numericId = Number(id);
        setMarketHeartbeat(
          rows.map((e) => normalizeHeartbeatEntry(e)).find((e): e is MarketHeartbeatEntry => e !== null && e.marketId === numericId) ?? null
        );
      } else {
        setMarketHeartbeat(null);
      }
    } catch (err: unknown) {
      setMarketHeartbeat(null);
      setError(err instanceof Error ? err.message : "Failed to load market");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchMarket(); }, [fetchMarket]);

  /* ---- Derived ---- */
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
  const predictionTrail = activityTrail.filter((e) => e.type === "prediction" && typeof e.probability === "number");
  const debateTrail = activityTrail.filter((e) => e.type === "debate").slice(-6).reverse();

  const commentReplyMap = useMemo(() => {
    const map = new Map<string, MarketCommentEntry[]>();
    for (const c of commentThread) {
      if (!c.parentId) continue;
      const bucket = map.get(c.parentId) ?? [];
      bucket.push(c);
      map.set(c.parentId, bucket);
    }
    return map;
  }, [commentThread]);

  const topLevelComments = useMemo(() => commentThread.filter((c) => !c.parentId), [commentThread]);

  const statusLabel = market
    ? market.status === 0
      ? isExpired ? "Pending Resolution" : "Live"
      : ["Active", "Closed", "Resolved"][market.status] ?? "Unknown"
    : "";

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try { await navigator.share({ title: market?.question, url }); } catch {}
    } else {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  /* ---- Loading skeleton ---- */
  if (loading) return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)" }}>
      <SiteHeader />
      <div className="max-w-[1200px] mx-auto w-full px-6 py-8 flex-1">
        <div className="flex gap-8">
          <div className="flex-1 space-y-6">
            <div className="h-3 w-32 rounded bg-white/[0.06] animate-pulse" />
            <div className="h-8 w-2/3 rounded bg-white/[0.06] animate-pulse" />
            <div className="h-[320px] rounded-xl bg-white/[0.03] animate-pulse" />
            <div className="h-px bg-white/[0.04]" />
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 rounded-xl bg-white/[0.03] animate-pulse" />
              ))}
            </div>
          </div>
          <div className="hidden lg:block w-[320px] shrink-0">
            <div className="h-[440px] rounded-2xl bg-white/[0.03] animate-pulse" />
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
      <div className="max-w-3xl mx-auto px-6 pt-12 flex-1">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-white/40 hover:text-white/70 transition-colors mb-8 no-underline">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Back to Markets
        </Link>
        <TamagotchiEmptyState message={error ?? "Market not found"} />
      </div>
      <Footer />
    </div>
  );

  /* ==================================================================
   *  MAIN RENDER
   * ================================================================== */
  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)" }}>
      <SiteHeader />

      <main className="max-w-[1200px] mx-auto w-full flex-1 px-4 sm:px-6 lg:px-8 py-6 pb-16">
        {/* Two-column layout */}
        <div className="flex gap-8 items-start">

          {/* ======== LEFT COLUMN ======== */}
          <div className="flex-1 min-w-0">

            {/* Breadcrumb */}
            <div className="flex items-center gap-2 text-xs mb-5">
              <Link href="/" className="text-white/30 hover:text-white/60 transition-colors no-underline">Markets</Link>
              <span className="text-white/15">&middot;</span>
              <span className="text-white/30 capitalize">{category}</span>
            </div>

            {/* Title + meta */}
            <div className="mb-6">
              <h1 className="text-2xl sm:text-3xl font-bold text-white leading-snug tracking-tight mb-3">
                {market.question}
              </h1>
              <div className="flex items-center gap-3 flex-wrap">
                {/* Status badge */}
                {market.status === 0 && !isExpired && (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-400">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-50" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
                    </span>
                    {statusLabel}
                  </span>
                )}
                {market.status !== 0 || isExpired ? (
                  <span className="text-[11px] font-semibold text-amber-400">{statusLabel}</span>
                ) : null}

                <span className="text-white/10">|</span>

                {/* Volume */}
                <span className="text-[12px] text-white/40 tabular-nums">
                  {poolStrk.toLocaleString(undefined, { maximumFractionDigits: 0 })} STRK Vol.
                </span>

                <span className="text-white/10">|</span>

                {/* Time left */}
                <span className="text-[12px] text-white/40">
                  {isExpired ? "Expired" : daysLeft > 0 ? `${daysLeft}d left` : `${hoursLeft}h left`}
                </span>

                {/* Share */}
                <button
                  onClick={handleShare}
                  className="ml-auto text-white/20 hover:text-white/50 transition-colors"
                  title={copied ? "Copied!" : "Share"}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
                  </svg>
                </button>
              </div>
            </div>

            {/* ---- CHART ---- */}
            <PriceChart trail={predictionTrail} yesPercent={yesPercent} noPercent={noPercent} predictions={predictions} />

            {/* Volume bar + stats row under chart */}
            <div className="flex items-center gap-4 mt-4 mb-2 text-xs text-white/30 tabular-nums">
              <span>{market.tradeCount ?? 0} trades</span>
              {disagreement > 0.15 && (
                <span className="text-amber-400/80 font-medium">Contested</span>
              )}
              {data?.weightedProbability != null && (
                <span>
                  AI: {Math.round(data.weightedProbability * 100)}%
                  {(() => {
                    const diff = Math.round(data.weightedProbability! * 100) - yesPercent;
                    if (diff === 0) return null;
                    return (
                      <span className={`ml-1 ${diff > 0 ? "text-emerald-400/60" : "text-rose-400/60"}`}>
                        ({diff > 0 ? "+" : ""}{diff})
                      </span>
                    );
                  })()}
                </span>
              )}
              {marketHeartbeat && (
                <span className="ml-auto flex items-center gap-1.5">
                  {HEARTBEAT_SOURCES.map((src) => {
                    const s = marketHeartbeat.sources[src];
                    const color = s.freshness === "fresh" ? "bg-emerald-400" : s.freshness === "stale" ? "bg-amber-400" : "bg-white/20";
                    return (
                      <span key={src} className="flex items-center gap-0.5" title={`${HEARTBEAT_SOURCE_META[src].label}: ${s.lastSeenAt ? timeAgo(s.lastSeenAt) : "no signal"}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${color}`} />
                        <span className="text-[10px]">{HEARTBEAT_SOURCE_META[src].icon}</span>
                      </span>
                    );
                  })}
                </span>
              )}
            </div>

            {/* Mobile trade card */}
            <div className="lg:hidden mt-6 mb-4">
              <TradeSidebar market={market} predictions={predictions} yesPercent={yesPercent} noPercent={noPercent} />
            </div>

            {/* ---- TABS ---- */}
            <div className="border-b border-white/[0.06] mt-6">
              <div className="flex gap-0">
                {([
                  { key: "agents" as const, label: `Agents (${predictions.length})` },
                  { key: "activity" as const, label: "Activity" },
                  { key: "details" as const, label: "Details" },
                ]).map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`px-5 py-3 text-sm font-semibold transition-colors border-b-2 ${
                      activeTab === tab.key
                        ? "text-white border-white"
                        : "text-white/30 border-transparent hover:text-white/50"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* ==== Tab: Agents ==== */}
            {activeTab === "agents" && (
              <div className="divide-y divide-white/[0.04]">
                {predictions.length > 0 ? (
                  predictions.map((pred) => <AgentRow key={pred.agent} pred={pred} marketYesPct={yesPercent} />)
                ) : (
                  <div className="py-12 text-center text-sm text-white/25">
                    No agent predictions yet for this market.
                  </div>
                )}
              </div>
            )}

            {/* ==== Tab: Activity ==== */}
            {activeTab === "activity" && (
              <div className="py-4 space-y-6">
                {/* Debate */}
                {debateTrail.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">Debate</h3>
                    <div className="space-y-2">
                      {debateTrail.map((entry) => (
                        <div key={entry.id} className="rounded-xl bg-white/[0.02] border border-white/[0.05] p-3.5">
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <span className="text-xs font-semibold text-white/60">{displayName(entry.actor)}</span>
                            {entry.debateTarget && (
                              <>
                                <span className="text-white/15 text-[10px]">&rarr;</span>
                                <span className="text-xs text-white/40">{displayName(entry.debateTarget)}</span>
                              </>
                            )}
                            <span className="text-[10px] text-white/15 ml-auto tabular-nums">{timeAgo(entry.timestamp)}</span>
                          </div>
                          <p className="text-xs text-white/45 leading-relaxed">{entry.detail ?? "debate update"}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Comments */}
                <div>
                  <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">
                    Comments ({topLevelComments.length})
                  </h3>
                  {topLevelComments.length > 0 ? (
                    <div className="space-y-2">
                      {topLevelComments.slice(-12).map((comment) => {
                        const replies = commentReplyMap.get(comment.id) ?? [];
                        return (
                          <div key={comment.id} className="rounded-xl bg-white/[0.02] border border-white/[0.05] p-3.5">
                            <div className="flex items-center gap-1.5 text-[11px] text-white/40">
                              <span className="font-semibold">{displayName(comment.actorName)}</span>
                              <span className="text-white/10">&middot;</span>
                              <span className="tabular-nums">{timeAgo(comment.createdAt)}</span>
                              {typeof comment.backtestConfidence === "number" && (
                                <>
                                  <span className="text-white/10">&middot;</span>
                                  <span className="text-cyan-400/60">BT {Math.round(comment.backtestConfidence * 100)}%</span>
                                </>
                              )}
                            </div>
                            <p className="mt-1.5 text-xs text-white/50 leading-relaxed">{comment.content}</p>
                            {replies.length > 0 && (
                              <div className="mt-2.5 space-y-1.5 border-l-2 border-white/[0.05] pl-3 ml-1">
                                {replies.slice(-3).map((reply) => (
                                  <div key={reply.id}>
                                    <p className="text-[10px] text-white/30">
                                      {displayName(reply.actorName)} &middot; {timeAgo(reply.createdAt)}
                                    </p>
                                    <p className="text-[10px] text-white/40">{reply.content}</p>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-white/20">No comments yet.</p>
                  )}
                </div>

                {/* Intel */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] overflow-hidden" style={{ minHeight: 200 }}>
                    <div className="px-3 py-2 border-b border-white/[0.05]">
                      <h3 className="text-xs font-semibold text-white/40">Agent Intel</h3>
                    </div>
                    <div className="p-3">
                      <LiveChatFeed category={category} question={market.question} marketId={market.id} />
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] overflow-hidden" style={{ minHeight: 200 }}>
                    <div className="px-3 py-2 border-b border-white/[0.05]">
                      <h3 className="text-xs font-semibold text-white/40">News Feed</h3>
                    </div>
                    <div className="p-3">
                      <LiveNewsFeed question={market.question} marketId={market.id} />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ==== Tab: Details ==== */}
            {activeTab === "details" && (
              <div className="py-4 space-y-4">
                <ResolutionStatusPanel marketId={market.id} />

                {/* Pool */}
                <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider">Liquidity Pool</h3>
                    <span className="font-mono text-lg font-bold text-white tabular-nums">
                      {poolStrk.toLocaleString(undefined, { maximumFractionDigits: 2 })} STRK
                    </span>
                  </div>
                  <div className="flex gap-0.5 h-3 rounded-full overflow-hidden bg-white/[0.04]">
                    {(() => {
                      const yesWei = safeBigInt(market.yesPool);
                      const noWei = safeBigInt(market.noPool);
                      const total = yesWei + noWei;
                      const yesFrac = total > 0n ? Number(yesWei * 100n / total) : 50;
                      return (
                        <>
                          <div className="bg-emerald-500/50 rounded-l-full transition-all" style={{ width: `${yesFrac}%` }} />
                          <div className="bg-rose-500/50 rounded-r-full transition-all flex-1" />
                        </>
                      );
                    })()}
                  </div>
                  <div className="flex justify-between mt-2 text-xs font-mono">
                    <span className="text-emerald-400/70">Yes {(Number(safeBigInt(market.yesPool)) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 1 })}</span>
                    <span className="text-rose-400/70">No {(Number(safeBigInt(market.noPool)) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 1 })}</span>
                  </div>
                </div>

                {/* Market info table */}
                <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-5">
                  <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-4">Market Info</h3>
                  {[
                    { label: "Contract", value: (
                      <a href={`https://sepolia.voyager.online/contract/${market.address}`} target="_blank" rel="noopener noreferrer"
                        className="font-mono text-sky-400/60 hover:text-sky-300 transition-colors text-xs">
                        {market.address.slice(0, 10)}...{market.address.slice(-6)}
                      </a>
                    )},
                    { label: "Oracle", value: <span className="font-mono text-white/40 text-xs">{market.oracle.slice(0, 10)}...{market.oracle.slice(-6)}</span> },
                    { label: "Fee", value: <span className="font-mono text-white/40 text-xs">{market.feeBps / 100}%</span> },
                    { label: "Resolution", value: (
                      <span className="font-mono text-white/40 text-xs">
                        {new Date(market.resolutionTime * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </span>
                    )},
                    { label: "Category", value: <span className="text-white/40 text-xs capitalize">{category}</span> },
                  ].map((row) => (
                    <div key={row.label} className="flex justify-between items-center py-2.5 border-b border-white/[0.03] last:border-0">
                      <span className="text-xs text-white/30">{row.label}</span>
                      {row.value}
                    </div>
                  ))}
                </div>

                {/* Resolution Oracle */}
                <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-5">
                  <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">Resolution Oracle</h3>
                  <p className="text-xs text-white/30 leading-relaxed mb-3">
                    Automatic resolution via category-specific strategy. Reasoning traces are SHA-256 hashed and logged on-chain via the Huginn Registry.
                  </p>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-[10px] text-white/25">Strategy:</span>
                    <span className="text-xs text-white/50 font-medium">
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
                      <span key={src} className="rounded-full border border-white/[0.06] bg-white/[0.03] px-2 py-0.5 text-[10px] text-white/40">
                        {src}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Quick links */}
                <div className="flex gap-2">
                  <Link
                    href="/fleet"
                    className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-3 text-xs text-white/40 hover:bg-white/[0.04] hover:text-white/60 transition-colors no-underline"
                  >
                    Deploy Agent
                  </Link>
                  <Link
                    href="/fleet"
                    className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-3 text-xs text-white/40 hover:bg-white/[0.04] hover:text-white/60 transition-colors no-underline"
                  >
                    Connect via OpenClaw
                  </Link>
                </div>
              </div>
            )}
          </div>

          {/* ======== RIGHT COLUMN — Sticky Trade Sidebar ======== */}
          <div className="hidden lg:block w-[320px] shrink-0">
            <div className="sticky top-24 space-y-4">
              {market.status === 0 && !isExpired ? (
                <TradeSidebar market={market} predictions={predictions} yesPercent={yesPercent} noPercent={noPercent} />
              ) : (
                <div className="rounded-2xl border border-white/[0.08] p-8 text-center" style={{ background: "rgba(17,24,39,0.95)" }}>
                  <div className="w-12 h-12 rounded-full bg-violet-400/10 border border-violet-400/20 flex items-center justify-center mx-auto mb-3">
                    <svg className="w-6 h-6 text-violet-300/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <p className="text-sm font-semibold text-white/60">
                    {market.status === 2 ? "Market Resolved" : "Trading Closed"}
                  </p>
                  <p className="text-xs text-white/25 mt-1">
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
