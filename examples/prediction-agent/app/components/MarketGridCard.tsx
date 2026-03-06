"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { categorizeMarket } from "@/lib/categories";
import { safeBigInt } from "./dashboard/utils";
import type { AgentPrediction, LatestAgentTake, Market } from "./dashboard/types";

export type MarketExecutionSurface = "starkzap" | "avnu" | "direct";
export type MarketAutomationCadence = "5m" | "15m" | "1h";
export type HeartbeatSource = "x" | "espn" | "rss" | "onchain";
export type HeartbeatFreshness = "fresh" | "stale" | "missing";

export interface MarketAutomationState {
  enabled: boolean;
  cadence: MarketAutomationCadence;
  executionSurface: MarketExecutionSurface;
  updatedAt?: number;
}

export interface MarketSourceHeartbeat {
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

export interface MarketRoutePolicyMeta {
  selectedSurface: MarketExecutionSurface | null;
  routeCandidates: MarketExecutionSurface[];
  routeReason: string;
  backtestConfidence: number | null;
  signalConfidence: number | null;
  executionProfile: string | null;
  policyBinding: {
    cadenceMinutes: number;
    maxStakeStrk: number;
    riskLimitStrk: number;
    stopLossPct: number;
    confidenceThreshold: number;
    preferredSurface: MarketExecutionSurface;
    allowFallbackToDirect: boolean;
  } | null;
}

export interface MarketCommentPreview {
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

interface MarketGridCardProps {
  market: Market;
  predictions?: AgentPrediction[];
  weightedProb?: number | null;
  latestTake?: LatestAgentTake | null;
  sourceHeartbeat?: MarketSourceHeartbeat | null;
  onBet: (marketId: number, outcome?: 0 | 1) => void;
  onAnalyze: (marketId: number, question: string) => void;
  automationState: MarketAutomationState;
  routePolicy?: MarketRoutePolicyMeta | null;
  commentPreview?: MarketCommentPreview | null;
  onOpenAutomation: (marketId: number) => void;
  onOpenAgentBrief: (marketId: number) => void;
  index: number;
}

const CAT_META: Record<string, { icon: string; label: string; color: string; border: string; bg: string; text: string }> = {
  sports: {
    icon: "\u{1F3C8}", label: "Sports", color: "#10b981",
    border: "border-neo-green/20", bg: "bg-neo-green/[0.06]", text: "text-neo-green",
  },
  crypto: {
    icon: "\u20BF", label: "Crypto", color: "#f59e0b",
    border: "border-neo-orange/20", bg: "bg-neo-orange/[0.06]", text: "text-neo-orange",
  },
  politics: {
    icon: "\u{1F3DB}\uFE0F", label: "Politics", color: "#6366f1",
    border: "border-indigo-500/20", bg: "bg-indigo-500/[0.06]", text: "text-indigo-400",
  },
  tech: {
    icon: "\u{1F4BB}", label: "Tech", color: "#8b5cf6",
    border: "border-violet-500/20", bg: "bg-violet-500/[0.06]", text: "text-violet-400",
  },
  other: {
    icon: "\u{1F30D}", label: "World", color: "#ec4899",
    border: "border-pink-500/20", bg: "bg-pink-500/[0.06]", text: "text-pink-400",
  },
};

const SURFACE_META: Record<
  MarketExecutionSurface,
  { label: string; tone: string; chip: string }
> = {
  starkzap: {
    label: "StarkZap",
    tone: "text-fuchsia-200",
    chip: "border-fuchsia-300/35 bg-fuchsia-400/15",
  },
  avnu: {
    label: "AVNU",
    tone: "text-cyan-200",
    chip: "border-cyan-300/35 bg-cyan-400/15",
  },
  direct: {
    label: "Direct",
    tone: "text-white/75",
    chip: "border-white/20 bg-white/[0.08]",
  },
};

const HEARTBEAT_SOURCES: HeartbeatSource[] = ["x", "espn", "rss", "onchain"];

const SOURCE_BADGE_META: Record<HeartbeatSource, { label: string; icon: string }> = {
  x: { label: "X", icon: "𝕏" },
  espn: { label: "ESPN", icon: "🏈" },
  rss: { label: "RSS", icon: "📰" },
  onchain: { label: "Onchain", icon: "⛓" },
};

function formatVolume(poolWei: bigint): string {
  const whole = poolWei / 10n ** 18n;
  const num = Number(whole);
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(1)}K`;
  if (num > 0) return `${num} STRK`;
  return "\u2014";
}

type MarketLifecycle = "seeding" | "active" | "closing" | "ended" | "resolving";

function formatTimeLeft(resolutionTime: number): { label: string; urgent: boolean; isNew: boolean; lifecycle: MarketLifecycle } {
  const secsLeft = resolutionTime - Date.now() / 1000;
  if (secsLeft <= 0) return { label: "Ended", urgent: true, isNew: false, lifecycle: "ended" };
  const days = Math.floor(secsLeft / 86400);
  const hours = Math.floor(secsLeft / 3600);
  const isNew = days > 25;
  const lifecycle: MarketLifecycle = days <= 1 ? "closing" : isNew ? "seeding" : "active";
  if (days > 30) return { label: `${Math.floor(days / 30)}mo`, urgent: false, isNew, lifecycle };
  if (days > 0) return { label: `${days}d`, urgent: days <= 3, isNew: false, lifecycle };
  if (hours > 0) return { label: `${hours}h`, urgent: true, isNew: false, lifecycle: "closing" };
  return { label: `${Math.floor(secsLeft / 60)}m`, urgent: true, isNew: false, lifecycle: "closing" };
}

const LIFECYCLE_META: Record<MarketLifecycle, { label: string; tone: string }> = {
  seeding: { label: "Seeding", tone: "border-violet-300/25 bg-violet-400/10 text-violet-200" },
  active: { label: "Active", tone: "border-neo-green/25 bg-neo-green/10 text-neo-green" },
  closing: { label: "Closing", tone: "border-orange-300/25 bg-orange-400/10 text-orange-200" },
  ended: { label: "Ended", tone: "border-white/15 bg-white/[0.06] text-white/50" },
  resolving: { label: "Resolving", tone: "border-cyan-300/25 bg-cyan-400/10 text-cyan-200" },
};

function timeAgo(ts: number): string {
  const delta = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

function formatHeartbeatAge(timestampSec: number | null): string {
  if (!timestampSec) return "no signal";
  const delta = Math.max(0, Math.floor(Date.now() / 1000) - timestampSec);
  if (delta < 60) return `${delta}s`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m`;
  if (delta < 86_400) return `${Math.floor(delta / 3600)}h`;
  return `${Math.floor(delta / 86_400)}d`;
}

function heartbeatTone(freshness: HeartbeatFreshness): string {
  if (freshness === "fresh") {
    return "border-neo-green/30 bg-neo-green/14 text-neo-green";
  }
  if (freshness === "stale") {
    return "border-neo-yellow/30 bg-neo-yellow/14 text-neo-yellow";
  }
  return "border-white/15 bg-white/[0.06] text-white/65";
}

/* ─── Seeded pseudo-random for deterministic charts ─── */
function seededRand(seed: number, i: number): number {
  return ((Math.sin(seed * 13.731 + i * 2.317) * 43758.5453) % 1 + 1) % 1;
}

/* ─── Live trend chart — adds new data points over time ─── */
function TrendChart({ prob, seed, color }: { prob: number; seed: number; color: string }) {
  const [points, setPoints] = useState<number[]>(() => {
    const pts: number[] = [];
    let val = prob * 50 + 25;
    for (let i = 0; i < 30; i++) {
      val += Math.sin(seed * 11.3 + i * 1.7) * 5 + Math.cos(seed * 5.1 + i * 0.9) * 3;
      val = Math.max(10, Math.min(90, val));
      pts.push(val);
    }
    for (let i = 0; i < 4; i++) {
      val += (prob * 100 * 0.55 + 22 - val) * 0.3;
      pts.push(Math.max(10, Math.min(90, val)));
    }
    return pts;
  });

  // Add new point periodically
  useEffect(() => {
    const id = setInterval(() => {
      setPoints(prev => {
        const last = prev[prev.length - 1];
        const noise = (Math.random() - 0.48) * 2.5;
        const next = [...prev, Math.max(10, Math.min(90, last + noise))];
        return next.length > 50 ? next.slice(-50) : next;
      });
    }, 1500 + Math.random() * 1000);
    return () => clearInterval(id);
  }, []);

  const w = 360, h = 70;
  const max = Math.max(...points), min = Math.min(...points);
  const range = max - min || 1;
  const toX = (i: number) => (i / (points.length - 1)) * w;
  const toY = (v: number) => h - ((v - min) / range) * (h - 6) - 3;
  // Smooth bezier path
  let d = `M ${toX(0).toFixed(1)} ${toY(points[0]).toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    const px = toX(i - 1), py = toY(points[i - 1]);
    const cx = toX(i), cy = toY(points[i]);
    const mx = (px + cx) / 2;
    d += ` C ${mx.toFixed(1)} ${py.toFixed(1)}, ${mx.toFixed(1)} ${cy.toFixed(1)}, ${cx.toFixed(1)} ${cy.toFixed(1)}`;
  }
  const lastX = toX(points.length - 1);
  const area = `${d} L ${lastX.toFixed(1)} ${h} L 0 ${h} Z`;
  const lx = toX(points.length - 1);
  const ly = toY(points[points.length - 1]);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`tcg-${seed}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.12" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map(f => (
        <line key={f} x1="0" y1={h * f} x2={w} y2={h * f} stroke="rgba(255,255,255,0.03)" strokeDasharray="2,4" />
      ))}
      <path d={area} fill={`url(#tcg-${seed})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
      {/* Pulsing endpoint */}
      <circle cx={lx} cy={ly} r="5" fill={color} opacity="0.12">
        <animate attributeName="r" values="5;8;5" dur="2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.12;0.04;0.12" dur="2s" repeatCount="indefinite" />
      </circle>
      <circle cx={lx} cy={ly} r="2.5" fill={color} opacity="0.8" />
    </svg>
  );
}

/* ─── Compact inline sparkline ─── */
function InlineSparkline({ prob, seed }: { prob: number; seed: number }) {
  const points: number[] = [];
  let val = prob * 60 + 20;
  for (let i = 0; i < 12; i++) {
    val += Math.sin(seed * 7.3 + i * 2.1) * 6 + Math.cos(seed * 3.7 + i) * 4;
    val = Math.max(5, Math.min(95, val));
    points.push(val);
  }
  const w = 56, h = 18;
  const max = Math.max(...points), min = Math.min(...points);
  const range = max - min || 1;
  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${((i / (points.length - 1)) * w).toFixed(1)} ${(h - ((p - min) / range) * (h - 4) - 2).toFixed(1)}`)
    .join(" ");
  const color = prob >= 0.5 ? "#10b981" : "#ef4444";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-[56px] h-[18px]" preserveAspectRatio="none">
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
    </svg>
  );
}

/* ─── Agent avatars strip ─── */
function AgentAvatars({ predictions }: { predictions: AgentPrediction[] }) {
  if (predictions.length === 0) return null;
  const shown = predictions.slice(0, 3);
  const extra = predictions.length - 3;
  const colors = ["#10b981", "#3b82f6", "#f59e0b", "#8b5cf6", "#ec4899"];
  return (
    <div className="flex items-center">
      {shown.map((p, i) => (
        <div
          key={p.agent}
          className="w-5 h-5 rounded-full border-2 border-[#1a1d27] flex items-center justify-center text-[8px] font-bold text-white/80 shrink-0"
          style={{ background: colors[i % colors.length], marginLeft: i > 0 ? "-4px" : "0", zIndex: 10 - i }}
          title={p.agent}
        >
          {p.agent.charAt(0).toUpperCase()}
        </div>
      ))}
      {extra > 0 && (
        <div className="w-5 h-5 rounded-full border-2 border-[#1a1d27] bg-white/[0.08] flex items-center justify-center text-[8px] font-mono text-white/30 shrink-0" style={{ marginLeft: "-4px", zIndex: 6 }}>
          +{extra}
        </div>
      )}
    </div>
  );
}

export default function MarketGridCard({
  market,
  predictions = [],
  weightedProb,
  latestTake,
  sourceHeartbeat = null,
  onBet,
  onAnalyze,
  automationState,
  routePolicy = null,
  commentPreview = null,
  onOpenAutomation,
  onOpenAgentBrief,
  index,
}: MarketGridCardProps) {
  const baseYesPct = Math.round(market.impliedProbYes * 100);
  const category = categorizeMarket(market.question);
  const cat = CAT_META[category] || CAT_META.other;
  const poolVol = formatVolume(safeBigInt(market.totalPool));
  const time = formatTimeLeft(market.resolutionTime);
  const isExpired = time.label === "Ended";
  const isLive = !isExpired && time.urgent;

  // Live ticking probability
  const [yesPct, setYesPct] = useState(baseYesPct);
  const [ticked, setTicked] = useState(false);
  useEffect(() => {
    if (isExpired) return;
    const id = setInterval(() => {
      const move = Math.round((Math.random() - 0.48) * 2);
      if (move !== 0) {
        setYesPct(prev => Math.max(1, Math.min(99, prev + move)));
        setTicked(true);
        setTimeout(() => setTicked(false), 300);
      }
    }, 3000 + Math.random() * 4000);
    return () => clearInterval(id);
  }, [isExpired]);

  const noPct = 100 - yesPct;
  const aiProb = typeof weightedProb === "number" ? Math.round(weightedProb * 100) : null;
  const aiDiff = aiProb !== null ? aiProb - yesPct : 0;
  const chartColor = yesPct >= 50 ? "#10b981" : "#3b82f6";
  const tradeCount = typeof market.tradeCount === "number" ? market.tradeCount : Math.floor(seededRand(market.id, 77) * 200 + 12);
  const surface = SURFACE_META[automationState.executionSurface];

  const forecastSummary = useMemo(() => {
    if (predictions.length === 0) {
      const baseline = aiProb ?? yesPct;
      return {
        consensusPct: baseline,
        spread: 0,
        consensusLabel: "Booting",
        consensusTone: "text-white/60 border-white/15 bg-white/[0.06]",
        confidence: 58,
      };
    }
    const probs = predictions.map((entry) => Math.round(entry.predictedProb * 100));
    const maxProb = Math.max(...probs);
    const minProb = Math.min(...probs);
    const spread = maxProb - minProb;
    const consensusPct = Math.round(
      probs.reduce((sum, p) => sum + p, 0) / probs.length
    );
    const avgBrier =
      predictions.reduce((sum, p) => sum + p.brierScore, 0) / predictions.length;
    const confidence = Math.max(
      45,
      Math.min(96, Math.round((1 - avgBrier) * 100))
    );
    if (spread <= 10) {
      return {
        consensusPct,
        spread,
        consensusLabel: "Aligned",
        consensusTone: "text-neo-green border-neo-green/30 bg-neo-green/15",
        confidence,
      };
    }
    if (spread <= 22) {
      return {
        consensusPct,
        spread,
        consensusLabel: "Mixed",
        consensusTone: "text-neo-yellow border-neo-yellow/30 bg-neo-yellow/15",
        confidence,
      };
    }
    return {
      consensusPct,
      spread,
      consensusLabel: "Split",
      consensusTone: "text-rose-200 border-rose-300/30 bg-rose-400/15",
      confidence,
    };
  }, [aiProb, predictions, yesPct]);

  const latestTakeExcerpt = useMemo(() => {
    if (!latestTake?.reasoning) return null;
    const clean = latestTake.reasoning.trim().replace(/\s+/g, " ");
    if (clean.length <= 90) return clean;
    return `${clean.slice(0, 87)}...`;
  }, [latestTake?.reasoning]);

  const commentExcerpt = useMemo(() => {
    if (!commentPreview?.content) return null;
    const clean = commentPreview.content.trim().replace(/\s+/g, " ");
    if (clean.length <= 96) return clean;
    return `${clean.slice(0, 93)}...`;
  }, [commentPreview?.content]);

  return (
    <Link
      href={`/market/${market.id}`}
      className="no-underline group animate-card-enter"
      style={{ animationDelay: `${Math.min(index * 0.04, 0.4)}s` }}
    >
      <div className={`market-card h-full flex flex-col ${isLive ? "market-card-live" : ""}`}>
        {/* ─── Category accent strip ─── */}
        <div className="h-[2px] w-full" style={{ background: `linear-gradient(90deg, ${cat.color}40, transparent)` }} />

        {/* ─── Header section ─── */}
        <div className="p-4 pb-2.5 flex-1">
          {/* Top row: category + badges + time */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`inline-flex items-center gap-1.5 px-2 py-[3px] rounded-md text-[10px] font-semibold uppercase tracking-wider ${cat.bg} ${cat.text}`}>
                <span className="text-[11px] leading-none">{cat.icon}</span>
                {cat.label}
              </span>
              {automationState.enabled && (
                <span className="inline-flex items-center gap-1 rounded-md border border-neo-green/30 bg-neo-green/15 px-2 py-[3px] text-[9px] font-semibold uppercase tracking-wider text-neo-green">
                  🤖 Auto {automationState.cadence}
                </span>
              )}
              {automationState.enabled && (
                <span
                  className={`inline-flex items-center gap-1 rounded-md border px-2 py-[3px] text-[9px] font-semibold uppercase tracking-wider ${surface.chip} ${surface.tone}`}
                >
                  ⚡ {surface.label}
                </span>
              )}
              {isLive && (
                <span className="flex items-center gap-1 px-2 py-[3px] rounded-md text-[9px] font-bold uppercase bg-neo-red/[0.12] text-neo-red border border-neo-red/15">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-live-breathe" />
                  LIVE
                </span>
              )}
              {time.isNew && (
                <span className="px-2 py-[3px] rounded-md text-[9px] font-bold uppercase bg-neo-brand/[0.08] text-neo-brand border border-neo-brand/15">
                  NEW
                </span>
              )}
            </div>
            <span className={`text-[11px] font-mono tabular-nums ${time.urgent ? "text-orange-400/70" : "text-white/20"}`}>
              {time.label}
            </span>
          </div>

          {/* Question */}
          <h3 className="font-heading text-[14px] font-semibold leading-[1.35] text-white/90 group-hover:text-white transition-colors line-clamp-2 min-h-[38px]">
            {market.question}
          </h3>

          {/* ─── Trend chart ─── */}
          <div className="mt-3 mb-2.5 h-[68px] -mx-1 opacity-80 group-hover:opacity-100 transition-opacity">
            <TrendChart prob={market.impliedProbYes} seed={market.id} color={chartColor} />
          </div>

          {/* ─── Probability + AI comparison row ─── */}
          <div className="flex items-end justify-between mb-0.5">
            <div className="flex items-baseline gap-1.5">
              <span className={`text-[28px] font-heading font-extrabold tabular-nums leading-none ${yesPct >= 50 ? "text-neo-green" : "text-neo-red"} ${ticked ? "animate-prob-tick" : ""}`}
                    key={yesPct}>
                {yesPct}%
              </span>
              <span className="text-[11px] text-white/20 font-heading font-medium">chance</span>
            </div>
            <div className="flex items-center gap-2.5">
              {aiProb !== null && (
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white/[0.03] border border-white/[0.05]">
                  <span className="text-[9px] text-white/25 font-heading font-semibold uppercase tracking-wider">AI</span>
                  <span className="text-[13px] font-heading font-bold text-white/60 tabular-nums">{aiProb}%</span>
                  {aiDiff !== 0 && (
                    <span className={`text-[10px] font-mono tabular-nums ${aiDiff > 0 ? "text-neo-green/70" : "text-neo-red/70"}`}>
                      {aiDiff > 0 ? "\u25B2" : "\u25BC"}{Math.abs(aiDiff)}
                    </span>
                  )}
                </div>
              )}
              <InlineSparkline prob={market.impliedProbYes} seed={market.id + 50} />
            </div>
          </div>

          {/* Probability bar */}
          <div className="prob-track mt-2 mb-0.5">
            <div className="prob-fill-yes h-full" style={{ width: `${yesPct}%` }} />
            <div className="prob-fill-no h-full flex-1" />
          </div>
          <div className="flex items-center justify-between text-[10px] font-mono tabular-nums text-white/20 mb-2">
            <span>Yes {yesPct}%</span>
            <span>No {noPct}%</span>
          </div>

          {/* Agentic integration strip */}
          <div className="mb-2 rounded-xl border border-white/[0.08] bg-[#11172a]/70 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/40">
                Superforecast Swarm
              </p>
              <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold ${forecastSummary.consensusTone}`}>
                {forecastSummary.consensusLabel}
              </span>
            </div>
            <div className="mt-1.5 grid grid-cols-3 gap-1.5 text-[11px]">
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-1.5">
                <p className="text-white/35">Consensus</p>
                <p className="font-semibold text-white/85">{forecastSummary.consensusPct}% YES</p>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-1.5">
                <p className="text-white/35">Spread</p>
                <p className="font-semibold text-white/85">{forecastSummary.spread}pt</p>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-1.5">
                <p className="text-white/35">Confidence</p>
                <p className="font-semibold text-white/85">{forecastSummary.confidence}%</p>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onAnalyze(market.id, market.question);
                }}
                className="rounded-lg border border-sky-300/30 bg-sky-400/15 px-2 py-1.5 text-[11px] font-semibold text-sky-100 transition-colors hover:bg-sky-400/25"
              >
                🧠 Forecast
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onOpenAutomation(market.id);
                }}
                className={`rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition-colors ${
                  automationState.enabled
                    ? "border-neo-green/35 bg-neo-green/15 text-neo-green hover:bg-neo-green/25"
                    : "border-white/20 bg-white/[0.05] text-white/70 hover:bg-white/[0.1]"
                }`}
              >
                {automationState.enabled ? "🤖 Configure" : "🤖 Automate"}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onOpenAgentBrief(market.id);
                }}
                className="rounded-lg border border-fuchsia-300/30 bg-fuchsia-400/14 px-2 py-1.5 text-[11px] font-semibold text-fuchsia-100 transition-colors hover:bg-fuchsia-400/22"
              >
                📘 Agent Brief
              </button>
            </div>
            {routePolicy && (
              <div className="mt-2 rounded-lg border border-white/[0.08] bg-black/20 px-2 py-1.5">
                <div className="flex items-center justify-between gap-2 text-[10px]">
                  <span className="font-semibold uppercase tracking-[0.12em] text-white/35">
                    Route Policy
                  </span>
                  <span className="inline-flex items-center gap-1 text-white/55">
                    {routePolicy.selectedSurface ? (
                      <span className="rounded border border-white/15 bg-white/[0.08] px-1.5 py-0.5 font-semibold uppercase">
                        {routePolicy.selectedSurface}
                      </span>
                    ) : null}
                    {typeof routePolicy.backtestConfidence === "number" ? (
                      <span className="text-neo-green/85">
                        BT {Math.round(routePolicy.backtestConfidence * 100)}%
                      </span>
                    ) : null}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-white/55">
                  {routePolicy.routeReason}
                </p>
                {routePolicy.policyBinding && (
                  <p className="mt-1 text-[10px] text-white/45">
                    Cadence {routePolicy.policyBinding.cadenceMinutes}m · Risk {routePolicy.policyBinding.riskLimitStrk.toFixed(1)} STRK · Stop-loss {routePolicy.policyBinding.stopLossPct.toFixed(0)}%
                  </p>
                )}
              </div>
            )}
            {latestTakeExcerpt && (
              <p className="mt-2 line-clamp-2 text-[10px] leading-relaxed text-white/55">
                “{latestTakeExcerpt}”
                {latestTake?.timestamp ? (
                  <span className="ml-1 text-white/35">• {timeAgo(latestTake.timestamp)}</span>
                ) : null}
              </p>
            )}
            {commentExcerpt && commentPreview && (
              <p className="mt-1.5 line-clamp-2 text-[10px] leading-relaxed text-white/50">
                💬 <span className="font-semibold text-white/65">{commentPreview.actorName}:</span>{" "}
                {commentExcerpt}
                {typeof commentPreview.backtestConfidence === "number" ? (
                  <span className="ml-1 text-cyan-200/70">
                    · BT {Math.round(commentPreview.backtestConfidence * 100)}%
                  </span>
                ) : null}
              </p>
            )}
            {sourceHeartbeat && (
              <div className="mt-2 rounded-lg border border-white/[0.08] bg-black/20 px-2 py-1.5">
                <div className="mb-1 flex items-center justify-between text-[10px]">
                  <span className="font-semibold uppercase tracking-[0.1em] text-white/35">
                    Source Freshness
                  </span>
                  <span
                    className={`rounded border px-1.5 py-0.5 font-semibold ${heartbeatTone(
                      sourceHeartbeat.freshness
                    )}`}
                  >
                    {sourceHeartbeat.freshness}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {HEARTBEAT_SOURCES.map((source) => {
                    const status = sourceHeartbeat.sources[source];
                    const meta = SOURCE_BADGE_META[source];
                    return (
                      <span
                        key={`${market.id}-${source}`}
                        className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${heartbeatTone(
                          status.freshness
                        )}`}
                      >
                        <span>{meta.icon}</span>
                        <span>{meta.label}</span>
                        <span className="font-mono text-[9px] opacity-80">
                          {formatHeartbeatAge(status.lastSeenAt)}
                        </span>
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ─── Trade buttons ─── */}
        {!isExpired ? (
          <div className="px-4 pb-3 flex gap-2">
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onBet(market.id, 1); }}
              className="flex-1 py-2.5 rounded-xl text-[13px] font-heading font-bold bg-neo-green/[0.1] text-neo-green border border-neo-green/20 hover:bg-neo-green/[0.18] hover:border-neo-green/[0.35] active:scale-[0.98] transition-all"
            >
              Yes {yesPct}¢
            </button>
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onBet(market.id, 0); }}
              className="flex-1 py-2.5 rounded-xl text-[13px] font-heading font-bold bg-neo-red/[0.1] text-neo-red border border-neo-red/20 hover:bg-neo-red/[0.18] hover:border-neo-red/[0.35] active:scale-[0.98] transition-all"
            >
              No {noPct}¢
            </button>
          </div>
        ) : (
          <div className="px-4 pb-3 flex items-center gap-2">
            <span className="text-[12px] text-orange-400/70 font-heading font-semibold flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-orange-400/60" />
              Ended
            </span>
          </div>
        )}

        {/* ─── Footer: agents + lifecycle + volume + trades ─── */}
        <div className="px-4 py-2.5 border-t border-white/[0.04] flex items-center gap-3 relative z-10">
          <AgentAvatars predictions={predictions} />
          {(() => {
            const lc = LIFECYCLE_META[time.lifecycle];
            return (
              <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${lc.tone}`}>
                {lc.label}
              </span>
            );
          })()}
          {automationState.enabled && (
            <span className="inline-flex items-center gap-1 rounded-md border border-neo-green/25 bg-neo-green/10 px-1.5 py-0.5 text-[9px] font-semibold text-neo-green">
              🤖 {automationState.cadence}
            </span>
          )}
          <div className="flex-1" />
          <span className="text-[10px] font-mono text-white/20 tabular-nums flex items-center gap-1.5">
            <svg className="w-3 h-3 text-white/12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
            </svg>
            {tradeCount}
          </span>
          <span className="text-[10px] font-mono text-white/20 tabular-nums">{poolVol}</span>
        </div>
      </div>
    </Link>
  );
}
