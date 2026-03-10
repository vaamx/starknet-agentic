"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useAccount } from "@starknet-react/core";
import { buildBetCalls, buildClaimCalls } from "@/lib/contracts";
import { computePayout } from "@/lib/accuracy";
import { friendlyTxError } from "@/lib/tx-errors";
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

const AGENT_NAMES = ["AlphaForecaster", "BetaAnalyst", "GammaTrader", "DeltaScout", "EpsilonOracle"];

/** Display a readable agent name — deterministic hash from hex address, no mutable state. */
function displayName(name: string): string {
  if (/^0x[0-9a-fA-F]{20,}$/.test(name)) {
    // Deterministic index from last 8 hex chars
    const idx = parseInt(name.slice(-8), 16) % AGENT_NAMES.length;
    return AGENT_NAMES[idx];
  }
  return name;
}

/** Get voice for an agent — resolve hex addresses to mapped names first. */
function resolveVoice(agent: string) {
  const name = displayName(agent);
  return getAgentVoiceByName(name);
}

const AGENT_COLORS: Record<string, string> = {
  "text-neo-green": "#22c55e",
  "text-neo-blue": "#4c8dff",
  "text-neo-purple": "#7c5cff",
  "text-neo-yellow": "#f5b942",
  "text-neo-pink": "#e63946",
};

function agentColor(agent: string): string {
  const voice = resolveVoice(agent);
  return AGENT_COLORS[voice?.colorClass ?? ""] ?? "#4c8dff";
}

/* ------------------------------------------------------------------ */
/*  Price Chart                                                         */
/* ------------------------------------------------------------------ */

function PriceChart({ trail, yesPercent, noPercent, predictions }: { trail: MarketActivityEntry[]; yesPercent: number; noPercent: number; predictions: AgentPrediction[] }) {
  const [range, setRange] = useState<"1H" | "6H" | "1D" | "1W" | "ALL">("ALL");
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  // Build effective trail: use predictionTrail if available, else synthesize from predictions
  const effectiveTrail = useMemo(() => {
    if (trail.length > 0) return trail;
    if (predictions.length === 0) return [];
    // Synthesize at least one point per agent prediction
    const now = Math.floor(Date.now() / 1000);
    return predictions.map((p, i) => ({
      id: `synth-${i}`,
      type: "prediction" as const,
      actor: p.agent,
      probability: p.predictedProb,
      timestamp: now - (predictions.length - 1 - i) * 60,
    }));
  }, [trail, predictions]);

  const filtered = useMemo(() => {
    if (range === "ALL" || effectiveTrail.length < 2) return effectiveTrail;
    const now = Date.now() / 1000;
    const secs: Record<string, number> = { "1H": 3600, "6H": 21600, "1D": 86400, "1W": 604800 };
    const cutoff = now - (secs[range] ?? 604800);
    const r = effectiveTrail.filter((p) => p.timestamp >= cutoff);
    return r.length >= 2 ? r : effectiveTrail;
  }, [effectiveTrail, range]);

  // Empty state
  if (effectiveTrail.length === 0) {
    return (
      <div className="space-y-4">
        {/* Probability Outcome Bar */}
        <div className="rounded-2xl overflow-hidden p-5" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-white/40">0 agents forecasting</span>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-emerald-400 font-bold">Yes {yesPercent}%</span>
              <span className="text-rose-400 font-bold">No {noPercent}%</span>
            </div>
          </div>
          <div className="relative h-10 rounded-xl overflow-hidden">
            <div className="absolute inset-0 flex">
              <div className="h-full transition-all duration-700 ease-out" style={{ width: `${yesPercent}%`, background: "linear-gradient(90deg, #059669 0%, #10b981 50%, #34d399 100%)" }} />
              <div className="h-full flex-1 transition-all duration-700 ease-out" style={{ background: "linear-gradient(90deg, #e11d48 0%, #f43f5e 50%, #fb7185 100%)" }} />
            </div>
            <div className="absolute inset-0 flex items-center justify-between px-4 pointer-events-none">
              <span className="text-sm font-bold text-white drop-shadow-lg">Yes {yesPercent}%</span>
              <span className="text-sm font-bold text-white drop-shadow-lg">No {noPercent}%</span>
            </div>
          </div>
        </div>
        {/* Empty chart state */}
        <div className="rounded-2xl overflow-hidden" style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.025) 0%, rgba(255,255,255,0.005) 100%)", border: "1px solid rgba(255,255,255,0.06)", height: 380 }}>
          <TamagotchiEmptyState
            message="No prediction data yet — agents will begin forecasting soon"
          />
        </div>
      </div>
    );
  }

  const currentPrice = filtered.length > 0
    ? Math.round((filtered[filtered.length - 1].probability ?? yesPercent / 100) * 100)
    : yesPercent;

  const prevPrice = filtered.length > 1
    ? Math.round((filtered[0].probability ?? yesPercent / 100) * 100)
    : currentPrice;

  const priceChange = currentPrice - prevPrice;

  // Chart dimensions
  const W = 800;
  const H = 380;
  const PAD = { top: 24, right: 24, bottom: 36, left: 52 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  // 50% threshold Y
  const midY = PAD.top + 0.5 * plotH;

  const points = filtered.map((p, i) => {
    const prob = typeof p.probability === "number" ? p.probability : 0.5;
    return {
      x: PAD.left + (i / Math.max(1, filtered.length - 1)) * plotW,
      y: PAD.top + (1 - prob) * plotH,
      prob,
      timestamp: p.timestamp,
      actor: p.actor,
    };
  });

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

  const linePath = points.length >= 2 ? cardinalSpline(points) : "";

  // Area path above 50% (green) — clip to above midY
  const areaAbovePath = points.length >= 2
    ? `${linePath} L${points[points.length - 1].x},${midY} L${points[0].x},${midY} Z`
    : "";

  // Area path below 50% (red) — clip to below midY
  const areaBelowPath = points.length >= 2
    ? `${linePath} L${points[points.length - 1].x},${midY} L${points[0].x},${midY} Z`
    : "";

  const isPositive = priceChange >= 0;

  // Grid lines at 0%, 25%, 50%, 75%, 100%
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((frac) => ({
    y: PAD.top + (1 - frac) * plotH,
    label: `${Math.round(frac * 100)}%`,
    isMajor: frac === 0.5,
  }));

  // X-axis time labels — show up to 5 labels
  const xLabels = useMemo(() => {
    if (filtered.length < 2) return [];
    const count = Math.min(5, filtered.length);
    const labels: { x: number; label: string }[] = [];
    for (let i = 0; i < count; i++) {
      const idx = Math.round((i / (count - 1)) * (filtered.length - 1));
      const entry = filtered[idx];
      labels.push({
        x: PAD.left + (idx / Math.max(1, filtered.length - 1)) * plotW,
        label: timeAgo(entry.timestamp),
      });
    }
    return labels;
  }, [filtered]);

  // Determine line color based on current probability
  const lineColor = currentPrice >= 50 ? "#22c55e" : "#ef4444";

  // Hover handling — find nearest point index from mouse x
  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (points.length < 2) return;
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * W;
    let nearest = 0;
    let minDist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const d = Math.abs(points[i].x - mouseX);
      if (d < minDist) { minDist = d; nearest = i; }
    }
    setHoverIdx(nearest);
  }, [points]);

  const handleMouseLeave = useCallback(() => setHoverIdx(null), []);

  const handleTouchMove = useCallback((e: React.TouchEvent<SVGSVGElement>) => {
    if (points.length < 2 || !e.touches[0]) return;
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const touchX = ((e.touches[0].clientX - rect.left) / rect.width) * W;
    let nearest = 0;
    let minDist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const d = Math.abs(points[i].x - touchX);
      if (d < minDist) { minDist = d; nearest = i; }
    }
    setHoverIdx(nearest);
  }, [points]);

  const handleTouchEnd = useCallback(() => setHoverIdx(null), []);

  const hoverPoint = hoverIdx !== null ? points[hoverIdx] : null;

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
            <span className="text-[10px] uppercase tracking-widest text-white/25 font-semibold block mb-1">Current Probability</span>
            <div className="flex items-baseline gap-2">
              <span className="text-[48px] font-bold tracking-tight leading-none tabular-nums" style={{ color: lineColor }}>
                {currentPrice}
              </span>
              <span className="text-xl text-white/25 font-light">%</span>
              {priceChange !== 0 && (
                <span className={`text-sm font-semibold ml-1 ${isPositive ? "text-emerald-400" : "text-rose-400"}`}>
                  {isPositive ? "+" : ""}{priceChange}%
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
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full cursor-crosshair"
            style={{ height: 380, display: "block" }}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            <defs>
              {/* Green gradient for area above 50% */}
              <linearGradient id="area-grad-green" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22c55e" stopOpacity="0.25" />
                <stop offset="60%" stopColor="#22c55e" stopOpacity="0.06" />
                <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
              </linearGradient>
              {/* Red gradient for area below 50% */}
              <linearGradient id="area-grad-red" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ef4444" stopOpacity="0" />
                <stop offset="40%" stopColor="#ef4444" stopOpacity="0.06" />
                <stop offset="100%" stopColor="#ef4444" stopOpacity="0.25" />
              </linearGradient>
              <filter id="glow">
                <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                <feMerge>
                  <feMergeNode in="coloredBlur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              {/* Clip paths for above/below 50% */}
              <clipPath id="clip-above-50">
                <rect x={PAD.left} y={PAD.top} width={plotW} height={midY - PAD.top} />
              </clipPath>
              <clipPath id="clip-below-50">
                <rect x={PAD.left} y={midY} width={plotW} height={PAD.top + plotH - midY} />
              </clipPath>
            </defs>

            {/* Grid */}
            {gridLines.map((g, i) => (
              <g key={i}>
                <line
                  x1={PAD.left} y1={g.y} x2={W - PAD.right} y2={g.y}
                  stroke={g.isMajor ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.025)"}
                  strokeDasharray={g.isMajor ? "6,4" : "none"}
                  strokeWidth={g.isMajor ? 1.5 : 1}
                />
                <text x={PAD.left - 10} y={g.y + 4} textAnchor="end" fill="rgba(255,255,255,0.18)" fontSize="10" fontFamily="monospace">
                  {g.label}
                </text>
              </g>
            ))}

            {/* 50% label emphasis */}
            <text x={W - PAD.right + 6} y={midY + 4} textAnchor="start" fill="rgba(255,255,255,0.10)" fontSize="9" fontFamily="monospace">
              50%
            </text>

            {/* X-axis time labels */}
            {xLabels.map((lbl, i) => (
              <text key={i} x={lbl.x} y={H - 8} textAnchor="middle" fill="rgba(255,255,255,0.18)" fontSize="10" fontFamily="monospace">
                {lbl.label}
              </text>
            ))}

            {points.length >= 2 ? (
              <>
                {/* Green area fill — above 50% */}
                <path d={areaAbovePath} fill="url(#area-grad-green)" clipPath="url(#clip-above-50)" />
                {/* Red area fill — below 50% */}
                <path d={areaBelowPath} fill="url(#area-grad-red)" clipPath="url(#clip-below-50)" />

                {/* Glow line (behind) */}
                <path d={linePath} fill="none" stroke={lineColor} strokeWidth="6" strokeLinecap="round" opacity="0.12" filter="url(#glow)" />
                {/* Main line */}
                <path d={linePath} fill="none" stroke={lineColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

                {/* Hover crosshair + tooltip */}
                {hoverPoint && (
                  <g>
                    {/* Vertical crosshair line */}
                    <line
                      x1={hoverPoint.x} y1={PAD.top} x2={hoverPoint.x} y2={PAD.top + plotH}
                      stroke="rgba(255,255,255,0.12)" strokeWidth="1" strokeDasharray="4,3"
                    />
                    {/* Horizontal crosshair line */}
                    <line
                      x1={PAD.left} y1={hoverPoint.y} x2={W - PAD.right} y2={hoverPoint.y}
                      stroke="rgba(255,255,255,0.06)" strokeWidth="1" strokeDasharray="4,3"
                    />
                    {/* Data point dot */}
                    <circle cx={hoverPoint.x} cy={hoverPoint.y} r="5" fill={hoverPoint.prob >= 0.5 ? "#22c55e" : "#ef4444"} stroke="white" strokeWidth="2" />
                    {/* Tooltip background */}
                    <rect
                      x={Math.min(hoverPoint.x - 48, W - PAD.right - 96)}
                      y={Math.max(hoverPoint.y - 42, PAD.top)}
                      width="96" height="34" rx="6"
                      fill="rgba(0,0,0,0.85)" stroke={hoverPoint.prob >= 0.5 ? "#22c55e" : "#ef4444"} strokeWidth="1"
                    />
                    {/* Tooltip probability */}
                    <text
                      x={Math.min(hoverPoint.x, W - PAD.right - 48)}
                      y={Math.max(hoverPoint.y - 24, PAD.top + 18) - 2}
                      textAnchor="middle" fill="white" fontSize="12" fontWeight="bold" fontFamily="monospace"
                    >
                      {Math.round(hoverPoint.prob * 100)}%
                    </text>
                    {/* Tooltip time */}
                    <text
                      x={Math.min(hoverPoint.x, W - PAD.right - 48)}
                      y={Math.max(hoverPoint.y - 24, PAD.top + 18) + 12}
                      textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="9" fontFamily="monospace"
                    >
                      {timeAgo(hoverPoint.timestamp)}
                    </text>
                  </g>
                )}

                {/* Data point dots — always show last, show all on hover or if few */}
                {points.map((p, i) => {
                  const isLast = i === points.length - 1;
                  const dotColor = p.prob >= 0.5 ? "#22c55e" : "#ef4444";
                  if (isLast) {
                    return (
                      <g key={i}>
                        <circle cx={p.x} cy={p.y} r="5" fill={dotColor} />
                        <circle cx={p.x} cy={p.y} r="12" fill={dotColor} opacity="0.15">
                          <animate attributeName="r" values="12;20;12" dur="2.5s" repeatCount="indefinite" />
                          <animate attributeName="opacity" values="0.15;0;0.15" dur="2.5s" repeatCount="indefinite" />
                        </circle>
                      </g>
                    );
                  }
                  // Show all dots when hovering, or if few data points
                  if (hoverIdx !== null || points.length <= 10) {
                    return <circle key={i} cx={p.x} cy={p.y} r="2" fill={dotColor} opacity="0.35" />;
                  }
                  return null;
                })}
              </>
            ) : (
              <>
                {/* Single point — show as a prominent dot with label */}
                {points.length === 1 && (
                  <g>
                    <circle cx={points[0].x} cy={points[0].y} r="6" fill={lineColor} />
                    <circle cx={points[0].x} cy={points[0].y} r="14" fill={lineColor} opacity="0.15">
                      <animate attributeName="r" values="14;22;14" dur="2.5s" repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0.15;0;0.15" dur="2.5s" repeatCount="indefinite" />
                    </circle>
                    <rect x={points[0].x - 28} y={points[0].y - 28} width="56" height="20" rx="6" fill="rgba(0,0,0,0.7)" stroke={lineColor} strokeWidth="1" />
                    <text x={points[0].x} y={points[0].y - 14} textAnchor="middle" fill="white" fontSize="11" fontWeight="bold" fontFamily="monospace">
                      {Math.round(points[0].prob * 100)}%
                    </text>
                  </g>
                )}
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
/*  Claim Banner — shown when market is resolved                        */
/* ------------------------------------------------------------------ */

function ClaimBanner({ market, onClaimed }: { market: Market; onClaimed?: () => void }) {
  const { isConnected, account, address } = useAccount();
  const [position, setPosition] = useState<{ yesBet: string; noBet: string } | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimResult, setClaimResult] = useState<{ status: string; txHash?: string; error?: string } | null>(null);

  useEffect(() => {
    if (!isConnected || !address || !market?.id) { setPosition(null); return; }
    let cancelled = false;
    fetch(`/api/markets/${market.id}/position?user=${address}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (!cancelled && data) setPosition({ yesBet: data.yesBet, noBet: data.noBet }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isConnected, address, market?.id]);

  if (!isConnected || !position) return null;

  const winningOutcome = market.winningOutcome ?? 0;
  const winningBet = BigInt(winningOutcome === 1 ? position.yesBet : position.noBet);
  const losingBet = BigInt(winningOutcome === 1 ? position.noBet : position.yesBet);
  const outcomeLabel = winningOutcome === 1 ? "Yes" : "No";

  // User has no position at all
  if (winningBet <= 0n && losingBet <= 0n) return null;

  // User lost
  if (winningBet <= 0n) {
    const lostStrk = Number(losingBet) / 1e18;
    return (
      <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-rose-500/20 flex items-center justify-center text-rose-400 text-lg">
            &times;
          </div>
          <div>
            <p className="text-sm font-semibold text-rose-300">
              Market resolved {outcomeLabel} &mdash; your position lost
            </p>
            <p className="text-xs text-rose-300/50 mt-0.5">
              {lostStrk.toFixed(2)} STRK was in the losing pool. Better luck next time.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // User won — show claim button
  const winStrk = Number(winningBet) / 1e18;
  const estPayout = computePayout(
    winningBet,
    BigInt(market.totalPool ?? "0"),
    BigInt(winningOutcome === 1 ? (market.yesPool ?? "0") : (market.noPool ?? "0")),
    market.feeBps ?? 0
  );
  const payoutStrk = Number(estPayout) / 1e18;
  const profit = payoutStrk - winStrk;

  const handleClaim = async () => {
    if (!account || claiming) return;
    setClaiming(true);
    setClaimResult(null);
    try {
      const calls = buildClaimCalls(market.address ?? "");
      const tx = await account.execute(calls);
      setClaimResult({ status: "success", txHash: tx.transaction_hash });
      onClaimed?.();
    } catch (err: any) {
      setClaimResult({ status: "error", error: friendlyTxError(err) });
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div className="rounded-xl border border-emerald-500/30 bg-gradient-to-r from-emerald-500/10 to-emerald-500/5 p-5 mb-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 text-xl">
            &#10003;
          </div>
          <div>
            <p className="text-sm font-bold text-emerald-300">
              You won! Market resolved {outcomeLabel}
            </p>
            <p className="text-xs text-emerald-300/60 mt-0.5">
              Payout: <span className="font-mono font-bold text-emerald-300">{payoutStrk.toFixed(2)} STRK</span>
              {profit > 0 && <span className="ml-2 text-emerald-400">(+{profit.toFixed(2)} profit)</span>}
            </p>
          </div>
        </div>
        <button
          onClick={handleClaim}
          disabled={claiming}
          className={`px-5 py-2.5 rounded-xl font-bold text-sm transition-all ${
            claiming
              ? "bg-white/[0.06] text-white/25 cursor-wait"
              : "bg-emerald-500 hover:bg-emerald-400 text-white shadow-[0_0_20px_rgba(16,185,129,0.3)]"
          }`}
        >
          {claiming ? "Claiming..." : "Claim Winnings"}
        </button>
      </div>
      {claimResult && (
        <div className={`mt-3 p-3 rounded-lg text-xs font-mono ${
          claimResult.status === "success"
            ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-300"
            : "bg-rose-500/10 border border-rose-500/20 text-rose-300"
        }`}>
          {claimResult.status === "success" ? (
            <>
              Winnings claimed!
              {claimResult.txHash && (
                <a href={`https://sepolia.voyager.online/tx/${claimResult.txHash}`} target="_blank" rel="noopener noreferrer" className="block text-sky-400/70 mt-1 hover:underline break-all">View on Voyager</a>
              )}
            </>
          ) : (
            <span>{claimResult.error}</span>
          )}
        </div>
      )}
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
  onTradeSuccess,
}: {
  market: Market;
  predictions: AgentPrediction[];
  yesPercent: number;
  noPercent: number;
  onTradeSuccess?: () => void;
}) {
  const { isConnected, account, address, status: walletStatus } = useAccount();
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<0 | 1>(1);
  const [amount, setAmount] = useState("");
  const [betResult, setBetResult] = useState<{ status: string; txHash?: string; error?: string } | null>(null);
  const [position, setPosition] = useState<{ yesBet: string; noBet: string } | null>(null);

  const isPolymarket = market.source === "polymarket" || market.id >= 100_000;
  const [mirrorAddress, setMirrorAddress] = useState<string | null>(market.mirrorAddress ?? null);
  const [deploying, setDeploying] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);

  const hasMirror = !!mirrorAddress && mirrorAddress !== "0x0";
  const tradingAddress = hasMirror ? mirrorAddress : market.address;

  useEffect(() => {
    if (!isConnected || !address || !market?.id) { setPosition(null); return; }
    // For Polymarket without a mirror, skip position fetch
    if (isPolymarket && !hasMirror) { setPosition(null); return; }
    let cancelled = false;
    fetch(`/api/markets/${market.id}/position?user=${address}${hasMirror ? `&mirror=${mirrorAddress}` : ""}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (!cancelled && data) setPosition({ yesBet: data.yesBet, noBet: data.noBet }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isConnected, address, market?.id, betResult, isPolymarket, hasMirror, mirrorAddress]);

  const amountNum = parseFloat(amount || "0");
  const amountBigInt = useMemo(() => {
    try { return BigInt(Math.floor(amountNum * 1e18)); }
    catch { return 0n; }
  }, [amountNum]);

  const estPayout = useMemo(() => {
    if (amountBigInt <= 0n) return 0n;
    const winningPool = outcome === 1 ? BigInt(market.yesPool) : BigInt(market.noPool);
    const newWinningPool = winningPool + amountBigInt;
    const newTotalPool = BigInt(market.totalPool) + amountBigInt;
    return newWinningPool > 0n ? computePayout(amountBigInt, newTotalPool, newWinningPool, market.feeBps) : 0n;
  }, [market, amountBigInt, outcome]);

  const estPayoutStrk = Number(estPayout) / 1e18;
  const costPerShare = outcome === 1 ? yesPercent : noPercent;
  const yesPoolStrk = Number(safeBigInt(market.yesPool)) / 1e18;
  const noPoolStrk = Number(safeBigInt(market.noPool)) / 1e18;
  const totalPoolStrk = Number(safeBigInt(market.totalPool)) / 1e18;

  const orderBookData = useMemo(() => {
    const bidRows = [];
    for (let i = 0; i < 5; i++) {
      const price = Math.max(1, costPerShare + 4 - i);
      const shares = Math.floor(800 + ((costPerShare * 137 + i * 251) % 600));
      const total = shares * price;
      const depth = (5 - i) / 5;
      bidRows.push({ price, shares, total, depth });
    }
    const askRows = [];
    const askBasePrice = 100 - costPerShare;
    for (let i = 0; i < 5; i++) {
      const price = Math.max(1, askBasePrice - 4 + i);
      const shares = Math.floor(600 + ((askBasePrice * 179 + i * 313) % 700));
      const total = shares * price;
      const depth = (i + 1) / 5;
      askRows.push({ price, shares, total, depth });
    }
    return { bidRows, askRows };
  }, [costPerShare]);

  async function handleDeployMirror() {
    setDeploying(true);
    setDeployError(null);
    try {
      const res = await fetch("/api/polymarket/mirror", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ marketId: market.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setDeployError(data.error ?? "Failed to deploy mirror market");
        return;
      }
      setMirrorAddress(data.mirrorAddress);
    } catch (err: unknown) {
      setDeployError(err instanceof Error ? err.message : "Network error");
    } finally {
      setDeploying(false);
    }
  }

  async function handleTrade() {
    if (!isConnected || !account || amountBigInt <= 0n) return;
    if (isPolymarket && !hasMirror) return;
    setBetResult(null);
    setSending(true);
    try {
      const calls = buildBetCalls(tradingAddress, outcome, amountBigInt);
      const response = await account.execute(calls);
      setBetResult({ status: "success", txHash: response.transaction_hash });
      if (onTradeSuccess) setTimeout(() => onTradeSuccess(), 3000);
    } catch (err: unknown) {
      setBetResult({ status: "error", error: friendlyTxError(err instanceof Error ? err.message : String(err)) });
    } finally {
      setSending(false);
    }
  }

  const outcomeLabel = outcome === 1 ? "Yes" : "No";

  // Simulated order book depth (visual only — derived from pool ratio)
  const yesFrac = totalPoolStrk > 0 ? yesPoolStrk / totalPoolStrk : 0.5;
  const bidPct = Math.round(yesFrac * 100);
  const askPct = 100 - bidPct;

  return (
    <div className="space-y-4">
      {/* ---- Quick Trade Card ---- */}
      <div className="rounded-2xl border border-white/[0.08] overflow-hidden" style={{ background: "rgba(17,24,39,0.95)", backdropFilter: "blur(24px)" }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06]">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-white/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33" />
            </svg>
            <span className="text-sm font-bold text-white">Quick Trade</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-40" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
            </span>
            <span className="text-[11px] font-bold text-emerald-400">LIVE</span>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {/* BUY YES / BUY NO cards */}
          <div>
            <p className="text-[10px] uppercase tracking-widest text-white/30 font-semibold mb-2.5">Buy Tokens</p>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setOutcome(1)}
                className={`relative flex flex-col items-center gap-1.5 py-4 rounded-xl transition-all border ${
                  outcome === 1
                    ? "bg-emerald-500/10 border-emerald-500/40 ring-1 ring-emerald-500/20"
                    : "bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.05]"
                }`}
              >
                <svg className={`w-5 h-5 ${outcome === 1 ? "text-emerald-400" : "text-white/30"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.306a11.95 11.95 0 015.814-5.518l2.74-1.22" />
                </svg>
                <span className={`text-sm font-bold ${outcome === 1 ? "text-emerald-400" : "text-white/50"}`}>BUY YES</span>
                <span className={`text-lg font-bold tabular-nums ${outcome === 1 ? "text-emerald-300" : "text-white/40"}`}>
                  {(yesPercent / 100).toFixed(1)}&cent;
                </span>
              </button>
              <button
                type="button"
                onClick={() => setOutcome(0)}
                className={`relative flex flex-col items-center gap-1.5 py-4 rounded-xl transition-all border ${
                  outcome === 0
                    ? "bg-rose-500/10 border-rose-500/40 ring-1 ring-rose-500/20"
                    : "bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.05]"
                }`}
              >
                <svg className={`w-5 h-5 ${outcome === 0 ? "text-rose-400" : "text-white/30"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6L9 12.75l4.286-4.286a11.948 11.948 0 015.834 5.518l2.74 1.22" />
                </svg>
                <span className={`text-sm font-bold ${outcome === 0 ? "text-rose-400" : "text-white/50"}`}>BUY NO</span>
                <span className={`text-lg font-bold tabular-nums ${outcome === 0 ? "text-rose-300" : "text-white/40"}`}>
                  {(noPercent / 100).toFixed(1)}&cent;
                </span>
              </button>
            </div>
          </div>

          {/* Amount */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase tracking-widest text-white/30 font-semibold">Amount (STRK)</span>
              <span className="text-[11px] text-sky-400/70 font-semibold cursor-pointer hover:text-sky-400 transition-colors">Max: {totalPoolStrk > 0 ? `${Math.floor(totalPoolStrk)}` : "0"}</span>
            </div>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/25 text-sm font-mono">STRK</span>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                min="0"
                step="1"
                className="w-full pl-16 pr-4 py-3 rounded-xl text-lg font-bold tabular-nums text-white bg-white/[0.04] border border-white/[0.08] focus:border-white/20 outline-none transition-colors [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
            </div>
            <div className="grid grid-cols-4 gap-2 mt-2.5">
              {[10, 25, 50, 100].map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setAmount(String(val))}
                  className="py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-[12px] font-bold text-white/50 hover:bg-white/[0.08] hover:text-white/80 hover:border-white/[0.12] transition-all"
                >
                  +{val}
                </button>
              ))}
            </div>
          </div>

          {/* Available balance */}
          <div className="flex items-center justify-between text-xs text-white/30">
            <span>Available balance:</span>
            <span className="font-mono font-semibold text-white/50">0.00 STRK</span>
          </div>

          {/* CTA Button */}
          {isPolymarket && !hasMirror ? (
            /* Polymarket without mirror — show deploy button */
            <div className="space-y-2">
              <button
                type="button"
                onClick={!isConnected ? () => window.dispatchEvent(new Event("hc-wallet-connect-open")) : handleDeployMirror}
                disabled={deploying}
                className={`w-full py-3.5 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 ${
                  deploying
                    ? "bg-white/[0.06] text-white/25 cursor-wait"
                    : "bg-gradient-to-r from-neo-brand/80 to-emerald-500/80 hover:from-neo-brand hover:to-emerald-500 text-white shadow-[0_0_24px_rgba(0,212,184,0.15)]"
                }`}
              >
                {deploying ? (
                  <>
                    <span className="inline-block w-4 h-4 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                    Deploying Mirror...
                  </>
                ) : !isConnected ? (
                  "Connect Wallet to Trade"
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    Activate STRK Trading
                  </>
                )}
              </button>
              {deployError && (
                <p className="text-[11px] text-rose-400 text-center">{deployError}</p>
              )}
              <p className="text-[10px] text-center text-white/25 leading-relaxed">
                Deploys an on-chain mirror market so you can bet with STRK on Starknet
              </p>
            </div>
          ) : !isConnected ? (
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event("hc-wallet-connect-open"))}
              className="w-full py-3.5 rounded-xl font-bold text-sm bg-gradient-to-r from-sky-500 to-cyan-500 hover:from-sky-400 hover:to-cyan-400 text-white transition-all shadow-[0_0_24px_rgba(14,165,233,0.15)]"
            >
              Connect Wallet
            </button>
          ) : (
            <button
              type="button"
              onClick={handleTrade}
              disabled={sending || amountBigInt <= 0n}
              className={`w-full py-3.5 rounded-xl font-bold text-sm transition-all ${
                sending || amountBigInt <= 0n
                  ? "bg-white/[0.06] text-white/25 cursor-not-allowed"
                  : outcome === 1
                    ? "bg-emerald-500 hover:bg-emerald-400 text-white shadow-[0_4px_24px_rgba(16,185,129,0.25)]"
                    : "bg-rose-500 hover:bg-rose-400 text-white shadow-[0_4px_24px_rgba(244,63,94,0.25)]"
              }`}
            >
              {sending
                ? "Confirming..."
                : amountNum > 0
                  ? `Buy ${outcomeLabel} @ ${costPerShare}.0\u00A2`
                  : "Enter amount"}
            </button>
          )}

          {/* Payout info */}
          {amountNum > 0 && (
            <p className="text-[10px] text-center text-white/25 leading-relaxed">
              This will execute at current market price.
              {estPayoutStrk > 0 && <> Payout if {outcomeLabel}: <span className="text-white/50 font-mono">{estPayoutStrk.toFixed(2)} STRK</span></>}
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
                <span className="text-emerald-300 font-bold">Trade placed on-chain</span>
                {betResult.txHash && (
                  <a href={`https://sepolia.voyager.online/tx/${betResult.txHash}`} target="_blank" rel="noopener noreferrer" className="block text-sky-400/70 mt-1 hover:underline break-all">View on Voyager</a>
                )}
              </>
            ) : (
              <span className="text-rose-300">{betResult.error}</span>
            )}
          </div>
        )}
      </div>

      {/* ---- Order Book Card ---- */}
      <div className="rounded-2xl border border-white/[0.08] overflow-hidden" style={{ background: "rgba(17,24,39,0.95)", backdropFilter: "blur(24px)" }}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06]">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-white/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
            <span className="text-sm font-bold text-white">Order Book ({outcomeLabel})</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-40" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
            </span>
            <span className="text-[11px] font-bold text-emerald-400">{isPolymarket ? (hasMirror ? "STRK MIRROR" : "POLYMARKET") : "LIVE"}</span>
          </div>
        </div>

        {isPolymarket && !hasMirror ? (
          /* Polymarket without mirror: show market stats */
          <div className="px-5 py-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-3">
                <p className="text-[9px] uppercase tracking-widest text-white/25 font-semibold mb-1">Yes Price</p>
                <p className="text-lg font-bold tabular-nums text-emerald-400">{yesPercent}&cent;</p>
              </div>
              <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-3">
                <p className="text-[9px] uppercase tracking-widest text-white/25 font-semibold mb-1">No Price</p>
                <p className="text-lg font-bold tabular-nums text-rose-400">{noPercent}&cent;</p>
              </div>
            </div>
            {typeof market.volume24h === "number" && market.volume24h > 0 && (
              <div className="flex items-center justify-between text-xs text-white/40">
                <span>24h Volume</span>
                <span className="font-mono font-semibold text-white/60">
                  ${market.volume24h >= 1_000_000
                    ? (market.volume24h / 1_000_000).toFixed(1) + "M"
                    : market.volume24h >= 1_000
                      ? (market.volume24h / 1_000).toFixed(1) + "K"
                      : Math.round(market.volume24h)}
                </span>
              </div>
            )}
            {typeof market.liquidity === "number" && market.liquidity > 0 && (
              <div className="flex items-center justify-between text-xs text-white/40">
                <span>Liquidity</span>
                <span className="font-mono font-semibold text-white/60">
                  ${market.liquidity >= 1_000_000
                    ? (market.liquidity / 1_000_000).toFixed(1) + "M"
                    : market.liquidity >= 1_000
                      ? (market.liquidity / 1_000).toFixed(1) + "K"
                      : Math.round(market.liquidity)}
                </span>
              </div>
            )}
            {typeof market.oneDayChange === "number" && market.oneDayChange !== 0 && (
              <div className="flex items-center justify-between text-xs text-white/40">
                <span>24h Change</span>
                <span className={`font-mono font-semibold ${market.oneDayChange > 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  {market.oneDayChange > 0 ? "+" : ""}{(market.oneDayChange * 100).toFixed(1)}%
                </span>
              </div>
            )}
            <div className="pt-1">
              <p className="text-[10px] text-white/20 text-center">
                Order book data sourced from Polymarket CLOB. Trade directly on Polymarket for best execution.
              </p>
            </div>
          </div>
        ) : (
          /* On-chain: simulated order book */
          <>
            {/* Bid/Ask balance bar */}
            <div className="px-5 pt-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-bold text-emerald-400">B {bidPct}%</span>
                <span className="text-[11px] font-bold text-rose-400">{askPct}% S</span>
              </div>
              <div className="flex h-1.5 rounded-full overflow-hidden">
                <div className="bg-emerald-500 transition-all" style={{ width: `${bidPct}%` }} />
                <div className="bg-rose-500 flex-1 transition-all" />
              </div>
            </div>

            {/* Order book table */}
            <div className="px-5 py-3">
              <div className="flex items-center text-[10px] font-semibold uppercase tracking-wider text-white/25 mb-2">
                <span className="flex-1">Price (&cent;)</span>
                <span className="w-16 text-right">Shares</span>
                <span className="w-20 text-right">Total</span>
              </div>

              {/* Bid side (green) */}
              {orderBookData.bidRows.map((row, i) => (
                <div key={`bid-${i}`} className="relative flex items-center py-1 text-xs font-mono">
                  <div className="absolute inset-0 rounded-sm bg-emerald-500/8" style={{ width: `${row.depth * 100}%` }} />
                  <span className="flex-1 text-emerald-400 relative z-10">{row.price}&cent;</span>
                  <span className="w-16 text-right text-white/40 relative z-10">{row.shares.toLocaleString()}</span>
                  <span className="w-20 text-right text-white/50 relative z-10">${row.total.toLocaleString()}</span>
                </div>
              ))}

              {/* Spread */}
              <div className="flex items-center justify-between py-2 my-1 border-y border-white/[0.04]">
                <span className="text-[10px] text-white/25">Spread</span>
                <span className="text-xs font-mono font-bold text-white/60">1.0&cent;</span>
                <span className="text-[10px] text-white/25 font-mono">2.00%</span>
              </div>

              {/* Ask side (red) */}
              {orderBookData.askRows.map((row, i) => (
                <div key={`ask-${i}`} className="relative flex items-center py-1 text-xs font-mono">
                  <div className="absolute inset-0 right-0 left-auto rounded-sm bg-rose-500/8" style={{ width: `${row.depth * 100}%` }} />
                  <span className="flex-1 text-rose-400 relative z-10">{row.price}&cent;</span>
                  <span className="w-16 text-right text-white/40 relative z-10">{row.shares.toLocaleString()}</span>
                  <span className="w-20 text-right text-white/50 relative z-10">${row.total.toLocaleString()}</span>
                </div>
              ))}

              <p className="text-[10px] text-white/15 text-center mt-3">Click price to fill order form</p>
            </div>
          </>
        )}
      </div>

      {/* ---- Pool & Position Card ---- */}
      <div className="rounded-2xl border border-white/[0.08] overflow-hidden" style={{ background: "rgba(17,24,39,0.95)", backdropFilter: "blur(24px)" }}>
        <div className="p-4 space-y-2.5">
          <p className="text-[10px] uppercase tracking-widest text-white/25 font-semibold">Pool</p>
          <div className="flex gap-0.5 h-2 rounded-full overflow-hidden bg-white/[0.04]">
            <div className="bg-emerald-500/60 rounded-l-full transition-all" style={{ width: `${totalPoolStrk > 0 ? (yesPoolStrk / totalPoolStrk * 100) : 50}%` }} />
            <div className="bg-rose-500/60 rounded-r-full transition-all flex-1" />
          </div>
          <div className="flex justify-between text-[11px] font-mono">
            <span className="text-emerald-400/60">Yes: {yesPoolStrk.toFixed(1)}</span>
            <span className="text-white/30">{totalPoolStrk.toFixed(1)} STRK</span>
            <span className="text-rose-400/60">No: {noPoolStrk.toFixed(1)}</span>
          </div>
          <div className="flex justify-between text-[10px] text-white/20">
            <span>{market.tradeCount ?? 0} trades</span>
            <span>Fee: {market.feeBps / 100}%</span>
          </div>
        </div>

        {/* Your Position */}
        {position && (BigInt(position.yesBet) > 0n || BigInt(position.noBet) > 0n) && (() => {
          const yesBetWei = BigInt(position.yesBet);
          const noBetWei = BigInt(position.noBet);
          const yesStrk = Number(yesBetWei) / 1e18;
          const noStrk = Number(noBetWei) / 1e18;
          const totalPositionStrk = yesStrk + noStrk;

          return (
            <div className="border-t border-white/[0.06] p-4 space-y-2.5">
              <p className="text-[10px] uppercase tracking-widest text-white/25 font-semibold">Your Position</p>
              {yesStrk > 0 && (
                <div className="flex justify-between items-center text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500/80" />
                    <span className="text-white/60">Yes</span>
                  </div>
                  <span className="font-mono text-white/80">{yesStrk.toFixed(2)} STRK</span>
                </div>
              )}
              {noStrk > 0 && (
                <div className="flex justify-between items-center text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-rose-500/80" />
                    <span className="text-white/60">No</span>
                  </div>
                  <span className="font-mono text-white/80">{noStrk.toFixed(2)} STRK</span>
                </div>
              )}
              <div className="flex justify-between text-[11px] border-t border-white/[0.04] pt-2">
                <span className="text-white/30">Total invested</span>
                <span className="font-mono font-semibold text-white/70">{totalPositionStrk.toFixed(2)} STRK</span>
              </div>
            </div>
          );
        })()}

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
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Agent Row (Polymarket outcome-row style)                            */
/* ------------------------------------------------------------------ */

function AgentRow({ pred, marketYesPct }: { pred: AgentPrediction; marketYesPct: number }) {
  const voice = resolveVoice(pred.agent);
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
  const fetchMarket = useCallback(async (isInitial = true) => {
    if (isInitial) setLoading(true);
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

  useEffect(() => {
    fetchMarket(true);
    const intervalId = setInterval(() => { fetchMarket(false); }, 30_000);
    return () => clearInterval(intervalId);
  }, [fetchMarket]);

  /** Force-refresh market data from chain (cache-busting). Called after bets/trades. */
  const refreshMarket = useCallback(async () => {
    try {
      const res = await fetch(`/api/markets/${id}?refresh=1`, { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      setData({
        market: json.market,
        predictions: Array.isArray(json.predictions) ? json.predictions : [],
        weightedProbability: typeof json.weightedProbability === "number" ? json.weightedProbability : null,
        latestAgentTake: json.latestAgentTake ?? null,
      });
    } catch {
      // silent — non-critical refresh
    }
  }, [id]);

  /* ---- Derived ---- */
  const market = data?.market;
  const predictions = data?.predictions ?? [];
  const yesPercent = market ? Math.round(market.impliedProbYes * 100) : 50;
  const noPercent = 100 - yesPercent;
  const category = market ? (market.category ?? categorizeMarket(market.question)) : "other";
  const now = Date.now() / 1000;
  const secsLeft = market ? Math.max(0, market.resolutionTime - now) : 0;
  const daysLeft = Math.floor(secsLeft / 86400);
  const hoursLeft = Math.floor(secsLeft / 3600);
  const minsLeft = Math.ceil(secsLeft / 60);
  const isExpired = market ? market.resolutionTime <= now : false;
  const isPolymarketDetail = market ? (market.source === "polymarket" || market.id >= 100_000) : false;
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

  // Lifecycle-aware status
  const lifecyclePhase = (() => {
    if (!market) return "open";
    if (market.status === 2) return "resolved";
    if (isExpired) return "resolving";
    if (secsLeft <= 120) return "closing";
    return "open";
  })();

  const statusLabel = (() => {
    switch (lifecyclePhase) {
      case "resolved": return "Resolved";
      case "resolving": return "Resolving...";
      case "closing": return "Closing Soon";
      default: return "Live";
    }
  })();

  const statusColor = (() => {
    switch (lifecyclePhase) {
      case "resolved": return "bg-sky-500/20 text-sky-300 border-sky-500/30";
      case "resolving": return "bg-amber-500/20 text-amber-300 border-amber-500/30 animate-pulse";
      case "closing": return "bg-rose-500/20 text-rose-300 border-rose-500/30";
      default: return "bg-emerald-500/20 text-emerald-300 border-emerald-500/30";
    }
  })();

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
        <div className="flex gap-4 lg:gap-8 items-start">

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
                {/* Lifecycle badge */}
                <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${statusColor}`}>
                  {lifecyclePhase === "open" && (
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-50" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
                    </span>
                  )}
                  {lifecyclePhase === "resolving" && (
                    <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                  )}
                  {statusLabel}
                </span>

                {isPolymarketDetail && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border bg-blue-500/15 text-blue-300 border-blue-500/25">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                    Polymarket
                  </span>
                )}

                <span className="text-white/10">|</span>

                {/* Volume */}
                <span className="text-[12px] text-white/40 tabular-nums">
                  {isPolymarketDetail && typeof market.volume24h === "number" && market.volume24h > 0
                    ? `$${market.volume24h >= 1_000_000
                        ? (market.volume24h / 1_000_000).toFixed(1) + "M"
                        : market.volume24h >= 1_000
                          ? (market.volume24h / 1_000).toFixed(1) + "K"
                          : Math.round(market.volume24h)
                      } Vol.`
                    : `${poolStrk.toLocaleString(undefined, { maximumFractionDigits: 0 })} STRK Vol.`}
                </span>

                <span className="text-white/10">|</span>

                {/* Time left */}
                <span className="text-[12px] text-white/40">
                  {isExpired ? "Expired" : daysLeft > 0 ? `${daysLeft}d left` : hoursLeft > 0 ? `${hoursLeft}h left` : minsLeft > 1 ? `${minsLeft}m left` : `${Math.floor(secsLeft)}s left`}
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

            {/* ---- Stats Bar (ProbTrade-style) ---- */}
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 sm:p-5 mb-5">
              <div className="grid grid-cols-3 gap-2 sm:gap-4">
                <div>
                  <p className="text-[9px] sm:text-[10px] uppercase tracking-widest text-white/25 font-semibold mb-1">Yes Price</p>
                  <p className="text-2xl sm:text-3xl font-bold tabular-nums text-emerald-400 tracking-tight">{yesPercent}&cent;</p>
                </div>
                <div>
                  <p className="text-[9px] sm:text-[10px] uppercase tracking-widest text-white/25 font-semibold mb-1">No Price</p>
                  <p className="text-2xl sm:text-3xl font-bold tabular-nums text-rose-400 tracking-tight">{noPercent}&cent;</p>
                </div>
                <div className="text-right">
                  <p className="text-[9px] sm:text-[10px] uppercase tracking-widest text-white/25 font-semibold mb-1">Time Left</p>
                  {isExpired ? (
                    <p className="text-xl sm:text-2xl font-bold text-amber-400">Ended</p>
                  ) : daysLeft > 0 ? (
                    <p className="text-xl sm:text-2xl font-bold text-white tracking-tight tabular-nums">
                      <span className="text-2xl sm:text-3xl">{String(daysLeft).padStart(2, "0")}</span>
                      <span className="text-xs sm:text-sm text-white/30 ml-1">DAY{daysLeft !== 1 ? "S" : ""}</span>
                    </p>
                  ) : (
                    <p className="text-xl sm:text-2xl font-bold text-white tracking-tight tabular-nums">
                      <span className="text-2xl sm:text-3xl">{String(Math.floor(hoursLeft)).padStart(2, "0")}</span>
                      <span className="text-[10px] sm:text-xs text-white/25 mx-0.5">HR</span>
                      <span className="text-2xl sm:text-3xl">{String(minsLeft % 60).padStart(2, "0")}</span>
                      <span className="text-[10px] sm:text-xs text-white/25 ml-0.5">MIN</span>
                    </p>
                  )}
                </div>
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

            {/* Claim banner — resolved markets with position */}
            {lifecyclePhase === "resolved" && <ClaimBanner market={market} onClaimed={refreshMarket} />}

            {/* Resolving banner */}
            {lifecyclePhase === "resolving" && (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 mb-4 flex items-center gap-3">
                <svg className="w-5 h-5 text-amber-400 animate-spin shrink-0" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                <div>
                  <p className="text-sm font-semibold text-amber-300">Resolution in progress</p>
                  <p className="text-xs text-amber-300/50 mt-0.5">The oracle is gathering evidence and verifying the outcome. This usually takes 30s-5min depending on market type.</p>
                </div>
              </div>
            )}

            {/* Mobile trade card */}
            <div className="lg:hidden mt-6 mb-4">
              <TradeSidebar market={market} predictions={predictions} yesPercent={yesPercent} noPercent={noPercent} onTradeSuccess={refreshMarket} />
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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] overflow-hidden" style={{ minHeight: 180 }}>
                    <div className="px-3 py-2 border-b border-white/[0.05]">
                      <h3 className="text-xs font-semibold text-white/40">Agent Intel</h3>
                    </div>
                    <div className="p-3">
                      <LiveChatFeed category={category} question={market.question} marketId={market.id} />
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] overflow-hidden" style={{ minHeight: 180 }}>
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
                        {new Date(market.resolutionTime * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
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
                <TradeSidebar market={market} predictions={predictions} yesPercent={yesPercent} noPercent={noPercent} onTradeSuccess={refreshMarket} />
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
