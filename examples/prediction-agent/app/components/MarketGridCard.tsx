"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { categorizeMarket } from "@/lib/categories";
import { safeBigInt } from "./dashboard/utils";
import type { AgentPrediction, LatestAgentTake, Market } from "./dashboard/types";

interface MarketGridCardProps {
  market: Market;
  predictions?: AgentPrediction[];
  weightedProb?: number | null;
  latestTake?: LatestAgentTake | null;
  onBet: (marketId: number, outcome?: 0 | 1) => void;
  index: number;
}

const CAT_META: Record<string, { icon: string; label: string; color: string; border: string; bg: string; text: string }> = {
  sports: {
    icon: "\u{1F3C8}", label: "Sports", color: "#10b981",
    border: "border-emerald-500/20", bg: "bg-emerald-500/[0.06]", text: "text-emerald-400",
  },
  crypto: {
    icon: "\u20BF", label: "Crypto", color: "#f59e0b",
    border: "border-amber-500/20", bg: "bg-amber-500/[0.06]", text: "text-amber-400",
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

function formatVolume(poolWei: bigint): string {
  const whole = poolWei / 10n ** 18n;
  const num = Number(whole);
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(1)}K`;
  if (num > 0) return `${num} STRK`;
  return "\u2014";
}

function formatTimeLeft(resolutionTime: number): { label: string; urgent: boolean; isNew: boolean } {
  const secsLeft = resolutionTime - Date.now() / 1000;
  if (secsLeft <= 0) return { label: "Ended", urgent: true, isNew: false };
  const days = Math.floor(secsLeft / 86400);
  const hours = Math.floor(secsLeft / 3600);
  const isNew = days > 25;
  if (days > 30) return { label: `${Math.floor(days / 30)}mo`, urgent: false, isNew };
  if (days > 0) return { label: `${days}d`, urgent: days <= 3, isNew: false };
  if (hours > 0) return { label: `${hours}h`, urgent: true, isNew: false };
  return { label: `${Math.floor(secsLeft / 60)}m`, urgent: true, isNew: false };
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
  onBet,
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
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 px-2 py-[3px] rounded-md text-[10px] font-semibold uppercase tracking-wider ${cat.bg} ${cat.text}`}>
                <span className="text-[11px] leading-none">{cat.icon}</span>
                {cat.label}
              </span>
              {isLive && (
                <span className="flex items-center gap-1 px-2 py-[3px] rounded-md text-[9px] font-bold uppercase bg-red-500/[0.12] text-red-400 border border-red-500/15">
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
              <span className={`text-[28px] font-heading font-extrabold tabular-nums leading-none ${yesPct >= 50 ? "text-emerald-400" : "text-red-400"} ${ticked ? "animate-prob-tick" : ""}`}
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
                    <span className={`text-[10px] font-mono tabular-nums ${aiDiff > 0 ? "text-emerald-400/70" : "text-red-400/70"}`}>
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
        </div>

        {/* ─── Trade buttons ─── */}
        {!isExpired ? (
          <div className="px-4 pb-3 flex gap-2">
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onBet(market.id, 1); }}
              className="flex-1 py-2.5 rounded-xl text-[13px] font-heading font-bold bg-emerald-500/[0.1] text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/[0.18] hover:border-emerald-400/[0.35] active:scale-[0.98] transition-all"
            >
              Yes {yesPct}¢
            </button>
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onBet(market.id, 0); }}
              className="flex-1 py-2.5 rounded-xl text-[13px] font-heading font-bold bg-red-500/[0.1] text-red-400 border border-red-500/20 hover:bg-red-500/[0.18] hover:border-red-400/[0.35] active:scale-[0.98] transition-all"
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

        {/* ─── Footer: agents + volume + trades ─── */}
        <div className="px-4 py-2.5 border-t border-white/[0.04] flex items-center gap-3 relative z-10">
          <AgentAvatars predictions={predictions} />
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
