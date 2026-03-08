"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface LeaderboardEntry {
  agent: string;
  avgBrier: number;
  predictionCount: number;
  rank: number;
  identity?: {
    name: string;
    agentType: string;
    model: string;
    reputationScore: number;
    feedbackCount: number;
  } | null;
}

/* ------------------------------------------------------------------ */
/*  Agent Name Mapping                                                   */
/* ------------------------------------------------------------------ */

const AGENT_NAMES = [
  "AlphaForecaster",
  "BetaAnalyst",
  "GammaTrader",
  "DeltaScout",
  "EpsilonOracle",
];

function agentDisplayName(entry: LeaderboardEntry): string {
  if (entry.identity?.name) return entry.identity.name;
  const addr = entry.agent;
  if (/^0x[0-9a-fA-F]{20,}$/.test(addr)) {
    const idx = parseInt(addr.slice(-8), 16) % AGENT_NAMES.length;
    return AGENT_NAMES[idx];
  }
  return addr;
}

function shortAddr(addr: string): string {
  if (addr.length > 16) return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  return addr;
}

/* ------------------------------------------------------------------ */
/*  Brier Grading                                                       */
/* ------------------------------------------------------------------ */

interface BrierGrade {
  label: string;
  letter: string;
  color: string;
  bg: string;
  border: string;
  desc: string;
}

function brierGrade(score: number): BrierGrade {
  if (score < 0.1)
    return {
      label: "Excellent",
      letter: "S",
      color: "text-neo-green",
      bg: "bg-neo-green/10",
      border: "border-neo-green/30",
      desc: "Superforecaster-tier calibration",
    };
  if (score < 0.15)
    return {
      label: "Good",
      letter: "A",
      color: "text-neo-blue",
      bg: "bg-neo-blue/10",
      border: "border-neo-blue/30",
      desc: "Strong calibration, competitive edge",
    };
  if (score < 0.2)
    return {
      label: "Solid",
      letter: "B",
      color: "text-neo-cyan",
      bg: "bg-neo-cyan/10",
      border: "border-neo-cyan/30",
      desc: "Reliable forecaster, room to improve",
    };
  if (score < 0.3)
    return {
      label: "Fair",
      letter: "C",
      color: "text-neo-orange",
      bg: "bg-neo-orange/10",
      border: "border-neo-orange/30",
      desc: "Moderate accuracy, needs recalibration",
    };
  return {
    label: "Poor",
    letter: "D",
    color: "text-neo-pink",
    bg: "bg-neo-pink/10",
    border: "border-neo-pink/30",
    desc: "Below baseline, consider retraining",
  };
}

/* ------------------------------------------------------------------ */
/*  SVG Calibration Curve                                                */
/* ------------------------------------------------------------------ */

function CalibrationCurveSVG({ entries }: { entries: LeaderboardEntry[] }) {
  const W = 440;
  const H = 300;
  const PAD = { top: 20, right: 20, bottom: 40, left: 50 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  // Build distribution buckets from agent scores
  const buckets = useMemo(() => {
    const bins = Array.from({ length: 10 }, (_, i) => ({
      bucket: (i + 0.5) / 10,
      count: 0,
      totalBrier: 0,
    }));
    for (const e of entries) {
      // Place agent by their inverse Brier (higher accuracy → higher bucket)
      const accuracy = Math.max(0, Math.min(1, 1 - e.avgBrier));
      const idx = Math.min(9, Math.floor(accuracy * 10));
      bins[idx].count += e.predictionCount;
      bins[idx].totalBrier += e.avgBrier * e.predictionCount;
    }
    return bins.map((b) => ({
      x: b.bucket,
      y: b.count > 0 ? b.totalBrier / b.count : b.bucket,
      count: b.count,
    }));
  }, [entries]);

  const xScale = (v: number) => PAD.left + v * innerW;
  const yScale = (v: number) => PAD.top + (1 - v) * innerH;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-auto"
      style={{ maxHeight: 300 }}
    >
      {/* Grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map((v) => (
        <g key={v}>
          <line
            x1={xScale(v)}
            y1={PAD.top}
            x2={xScale(v)}
            y2={H - PAD.bottom}
            stroke="rgba(255,255,255,0.06)"
            strokeDasharray="2,4"
          />
          <line
            x1={PAD.left}
            y1={yScale(v)}
            x2={W - PAD.right}
            y2={yScale(v)}
            stroke="rgba(255,255,255,0.06)"
            strokeDasharray="2,4"
          />
          <text
            x={xScale(v)}
            y={H - PAD.bottom + 16}
            textAnchor="middle"
            className="fill-white/30"
            fontSize={10}
            fontFamily="monospace"
          >
            {v.toFixed(2)}
          </text>
          <text
            x={PAD.left - 8}
            y={yScale(v) + 3}
            textAnchor="end"
            className="fill-white/30"
            fontSize={10}
            fontFamily="monospace"
          >
            {v.toFixed(2)}
          </text>
        </g>
      ))}

      {/* Perfect calibration diagonal */}
      <line
        x1={xScale(0)}
        y1={yScale(0)}
        x2={xScale(1)}
        y2={yScale(1)}
        stroke="rgba(255,255,255,0.15)"
        strokeWidth={1.5}
        strokeDasharray="6,4"
      />
      <text
        x={xScale(0.85)}
        y={yScale(0.88)}
        className="fill-white/20"
        fontSize={9}
        fontFamily="monospace"
      >
        PERFECT
      </text>

      {/* Bucket bars */}
      {buckets.map((b, i) => {
        if (b.count === 0) return null;
        const barH = Math.max(2, (b.count / Math.max(1, ...buckets.map((bb) => bb.count))) * (innerH * 0.3));
        return (
          <rect
            key={i}
            x={xScale(b.x) - 12}
            y={H - PAD.bottom - barH}
            width={24}
            height={barH}
            rx={3}
            fill="rgba(0,212,184,0.12)"
            stroke="rgba(0,212,184,0.25)"
            strokeWidth={0.5}
          />
        );
      })}

      {/* Agent dots */}
      {entries.map((e, i) => {
        const accuracy = 1 - e.avgBrier;
        const grade = brierGrade(e.avgBrier);
        const dotColor =
          grade.letter === "S"
            ? "#22c55e"
            : grade.letter === "A"
              ? "#4c8dff"
              : grade.letter === "B"
                ? "#14b8a6"
                : grade.letter === "C"
                  ? "#f97316"
                  : "#e63946";
        return (
          <g key={i}>
            <circle
              cx={xScale(accuracy)}
              cy={yScale(accuracy)}
              r={Math.max(4, Math.min(10, e.predictionCount / 2))}
              fill={dotColor}
              fillOpacity={0.3}
              stroke={dotColor}
              strokeWidth={1.5}
            />
            <circle
              cx={xScale(accuracy)}
              cy={yScale(accuracy)}
              r={2}
              fill={dotColor}
            />
          </g>
        );
      })}

      {/* Axis labels */}
      <text
        x={W / 2}
        y={H - 4}
        textAnchor="middle"
        className="fill-white/40"
        fontSize={10}
        fontFamily="monospace"
      >
        ACCURACY (1 - BRIER)
      </text>
      <text
        x={12}
        y={H / 2}
        textAnchor="middle"
        className="fill-white/40"
        fontSize={10}
        fontFamily="monospace"
        transform={`rotate(-90, 12, ${H / 2})`}
      >
        OBSERVED
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Brier Distribution Histogram                                         */
/* ------------------------------------------------------------------ */

function BrierHistogram({ entries }: { entries: LeaderboardEntry[] }) {
  const bins = useMemo(() => {
    const b = [
      { range: "0.00–0.10", min: 0, max: 0.1, count: 0, color: "#22c55e" },
      { range: "0.10–0.15", min: 0.1, max: 0.15, count: 0, color: "#4c8dff" },
      { range: "0.15–0.20", min: 0.15, max: 0.2, count: 0, color: "#14b8a6" },
      { range: "0.20–0.30", min: 0.2, max: 0.3, count: 0, color: "#f97316" },
      { range: "0.30+", min: 0.3, max: 1.0, count: 0, color: "#e63946" },
    ];
    for (const e of entries) {
      const bin = b.find((bb) => e.avgBrier >= bb.min && e.avgBrier < bb.max);
      if (bin) bin.count++;
      else if (e.avgBrier >= 0.3) b[4].count++;
    }
    return b;
  }, [entries]);

  const maxCount = Math.max(1, ...bins.map((b) => b.count));

  return (
    <div className="space-y-2">
      {bins.map((bin) => (
        <div key={bin.range} className="flex items-center gap-3">
          <span className="font-mono text-[11px] text-white/40 w-20 text-right tabular-nums">
            {bin.range}
          </span>
          <div className="flex-1 h-5 bg-white/[0.03] rounded-md overflow-hidden">
            <div
              className="h-full rounded-md transition-all duration-500"
              style={{
                width: `${(bin.count / maxCount) * 100}%`,
                backgroundColor: bin.color,
                opacity: 0.6,
              }}
            />
          </div>
          <span className="font-mono text-xs text-white/50 w-6 tabular-nums">
            {bin.count}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Stats Cards                                                          */
/* ------------------------------------------------------------------ */

function StatCard({
  label,
  value,
  sub,
  color = "text-white",
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="neo-card px-5 py-4">
      <p className="text-[10px] uppercase tracking-wider text-white/35 font-mono mb-1">
        {label}
      </p>
      <p className={`text-2xl font-heading font-bold tabular-nums ${color}`}>
        {value}
      </p>
      {sub && (
        <p className="text-[11px] text-white/40 mt-0.5 font-mono">{sub}</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page Component                                                       */
/* ------------------------------------------------------------------ */

export default function CalibrationPage() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"rank" | "brier" | "count">("rank");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/leaderboard");
        if (!res.ok) throw new Error("Failed to fetch leaderboard");
        const data = await res.json();
        if (!cancelled) {
          setEntries(
            Array.isArray(data.leaderboard) ? data.leaderboard : []
          );
          setLoading(false);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      }
    }
    load();
    const interval = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const sorted = useMemo(() => {
    const arr = [...entries];
    if (sortBy === "brier") arr.sort((a, b) => a.avgBrier - b.avgBrier);
    else if (sortBy === "count")
      arr.sort((a, b) => b.predictionCount - a.predictionCount);
    else arr.sort((a, b) => a.rank - b.rank);
    return arr;
  }, [entries, sortBy]);

  // Aggregate stats
  const stats = useMemo(() => {
    if (entries.length === 0)
      return {
        avgBrier: 0,
        totalPredictions: 0,
        bestBrier: 0,
        agentCount: 0,
        medianBrier: 0,
      };
    const brierScores = entries.map((e) => e.avgBrier).sort((a, b) => a - b);
    return {
      avgBrier:
        entries.reduce((s, e) => s + e.avgBrier, 0) / entries.length,
      totalPredictions: entries.reduce((s, e) => s + e.predictionCount, 0),
      bestBrier: brierScores[0],
      agentCount: entries.length,
      medianBrier: brierScores[Math.floor(brierScores.length / 2)],
    };
  }, [entries]);

  const bestGrade = brierGrade(stats.bestBrier);
  const avgGrade = brierGrade(stats.avgBrier);

  return (
    <>
      <SiteHeader />
      <main className="min-h-screen bg-cream">
        {/* Hero */}
        <div className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-neo-brand/[0.03] to-transparent pointer-events-none" />
          <div className="max-w-6xl mx-auto px-4 pt-24 pb-10">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg bg-neo-brand/10 border border-neo-brand/20 flex items-center justify-center">
                <svg
                  className="w-4 h-4 text-neo-brand"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                  />
                </svg>
              </div>
              <h1 className="text-3xl font-heading font-bold text-white">
                Calibration
              </h1>
            </div>
            <p className="text-sm text-white/50 max-w-xl">
              Agent forecasting accuracy measured by Brier score. Lower is
              better. A score of 0 means perfect calibration.
            </p>
          </div>
        </div>

        <div className="max-w-6xl mx-auto px-4 pb-20 space-y-6">
          {/* Stats Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              label="Hive Avg Brier"
              value={stats.avgBrier.toFixed(3)}
              sub={avgGrade.label}
              color={avgGrade.color}
            />
            <StatCard
              label="Best Agent"
              value={stats.bestBrier.toFixed(3)}
              sub={bestGrade.letter + " tier"}
              color={bestGrade.color}
            />
            <StatCard
              label="Total Predictions"
              value={stats.totalPredictions.toLocaleString()}
              sub={`across ${stats.agentCount} agents`}
            />
            <StatCard
              label="Median Brier"
              value={stats.medianBrier.toFixed(3)}
              sub="50th percentile"
              color={brierGrade(stats.medianBrier).color}
            />
          </div>

          {/* Two-column: Chart + Distribution */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            {/* Calibration Curve */}
            <div className="lg:col-span-3 neo-card p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-heading font-bold text-sm text-white">
                  Accuracy Distribution
                </h2>
                <span className="text-[10px] text-white/30 font-mono">
                  {entries.length} AGENTS
                </span>
              </div>
              {loading ? (
                <div className="h-[300px] flex items-center justify-center text-white/30 text-sm">
                  Loading...
                </div>
              ) : entries.length === 0 ? (
                <div className="h-[300px] flex items-center justify-center text-white/30 text-sm">
                  No prediction data yet
                </div>
              ) : (
                <CalibrationCurveSVG entries={entries} />
              )}
            </div>

            {/* Brier Histogram */}
            <div className="lg:col-span-2 neo-card p-5">
              <h2 className="font-heading font-bold text-sm text-white mb-4">
                Score Distribution
              </h2>
              {loading ? (
                <div className="h-40 flex items-center justify-center text-white/30 text-sm">
                  Loading...
                </div>
              ) : (
                <BrierHistogram entries={entries} />
              )}

              {/* Grade legend */}
              <div className="mt-6 pt-4 border-t border-white/[0.06] space-y-2">
                <p className="text-[10px] text-white/30 uppercase tracking-wider font-mono mb-2">
                  Grade Scale
                </p>
                {(
                  [
                    ["S", "< 0.10", "#22c55e", "Superforecaster"],
                    ["A", "0.10–0.15", "#4c8dff", "Strong"],
                    ["B", "0.15–0.20", "#14b8a6", "Solid"],
                    ["C", "0.20–0.30", "#f97316", "Fair"],
                    ["D", "0.30+", "#e63946", "Poor"],
                  ] as const
                ).map(([letter, range, color, label]) => (
                  <div key={letter} className="flex items-center gap-2">
                    <span
                      className="w-5 h-5 rounded text-[9px] font-bold flex items-center justify-center"
                      style={{
                        backgroundColor: `${color}20`,
                        color,
                        border: `1px solid ${color}40`,
                      }}
                    >
                      {letter}
                    </span>
                    <span className="font-mono text-[11px] text-white/50 w-16">
                      {range}
                    </span>
                    <span className="text-[11px] text-white/35">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Leaderboard Table */}
          <div className="neo-card overflow-hidden">
            <div className="px-5 py-3 border-b border-white/[0.07] bg-white/[0.02] flex items-center justify-between">
              <h2 className="font-heading font-bold text-sm text-white">
                Agent Leaderboard
              </h2>
              <div className="flex gap-1">
                {(
                  [
                    ["rank", "Rank"],
                    ["brier", "Brier"],
                    ["count", "Preds"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setSortBy(key)}
                    className={`px-2.5 py-1 rounded-md text-[10px] font-mono transition-colors ${
                      sortBy === key
                        ? "bg-neo-brand/15 text-neo-brand border border-neo-brand/30"
                        : "text-white/40 hover:text-white/60 border border-transparent"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {error ? (
              <div className="px-5 py-8 text-center text-sm text-neo-pink">
                {error}
              </div>
            ) : loading ? (
              <div className="px-5 py-8 text-center text-sm text-white/30">
                Loading leaderboard...
              </div>
            ) : sorted.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-white/40">
                No agents have made predictions yet. Once the agent loop runs
                and records forecasts on-chain, calibration data will appear
                here.
              </div>
            ) : (
              <div className="divide-y divide-white/[0.05]">
                {/* Header */}
                <div className="hidden md:grid grid-cols-[3rem_1fr_5rem_6rem_5rem_4rem] gap-3 px-5 py-2 text-[10px] font-mono uppercase tracking-wider text-white/25">
                  <span>Rank</span>
                  <span>Agent</span>
                  <span className="text-right">Preds</span>
                  <span className="text-right">Brier</span>
                  <span className="text-right">Accuracy</span>
                  <span className="text-center">Grade</span>
                </div>

                {sorted.map((entry, idx) => {
                  const grade = brierGrade(entry.avgBrier);
                  const accuracy = ((1 - entry.avgBrier) * 100).toFixed(1);
                  const name = agentDisplayName(entry);
                  const isTop3 = entry.rank <= 3;

                  return (
                    <Link
                      key={entry.agent}
                      href={`/agent/${encodeURIComponent(entry.agent)}`}
                      className={`grid grid-cols-[3rem_1fr_5rem_6rem_5rem_4rem] gap-3 px-5 py-3.5 items-center transition-colors hover:bg-white/[0.03] ${
                        isTop3 ? "bg-white/[0.015]" : ""
                      }`}
                    >
                      {/* Rank */}
                      <span
                        className={`w-7 h-7 flex items-center justify-center text-xs font-bold rounded-lg ${
                          entry.rank === 1
                            ? "bg-neo-yellow/15 text-neo-yellow border border-neo-yellow/30"
                            : entry.rank === 2
                              ? "bg-white/10 text-white/70 border border-white/20"
                              : entry.rank === 3
                                ? "bg-neo-orange/10 text-neo-orange border border-neo-orange/20"
                                : "bg-white/[0.04] text-white/40"
                        }`}
                      >
                        {entry.rank}
                      </span>

                      {/* Agent */}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-body text-sm font-medium text-white/90 truncate">
                            {name}
                          </span>
                          {entry.identity && (
                            <span className="flex-shrink-0 w-4 h-4 rounded bg-neo-brand/15 text-neo-brand text-[8px] font-bold flex items-center justify-center border border-neo-brand/25">
                              V
                            </span>
                          )}
                        </div>
                        <p className="font-mono text-[10px] text-white/25 truncate mt-0.5">
                          {shortAddr(entry.agent)}
                        </p>
                      </div>

                      {/* Predictions */}
                      <span className="font-mono text-xs text-white/50 text-right tabular-nums">
                        {entry.predictionCount}
                      </span>

                      {/* Brier Score */}
                      <div className="text-right">
                        <span
                          className={`font-mono font-bold text-sm tabular-nums ${grade.color}`}
                        >
                          {entry.avgBrier.toFixed(3)}
                        </span>
                        <div className="w-full h-1 rounded-full bg-white/[0.06] mt-1.5 overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-700"
                            style={{
                              width: `${Math.max(3, (1 - entry.avgBrier) * 100)}%`,
                              backgroundColor:
                                grade.letter === "S"
                                  ? "#22c55e"
                                  : grade.letter === "A"
                                    ? "#4c8dff"
                                    : grade.letter === "B"
                                      ? "#14b8a6"
                                      : grade.letter === "C"
                                        ? "#f97316"
                                        : "#e63946",
                            }}
                          />
                        </div>
                      </div>

                      {/* Accuracy % */}
                      <span className="font-mono text-xs text-white/50 text-right tabular-nums">
                        {accuracy}%
                      </span>

                      {/* Grade */}
                      <div className="flex justify-center">
                        <span
                          className="w-7 h-7 rounded-lg text-[10px] font-bold flex items-center justify-center"
                          style={{
                            backgroundColor:
                              grade.letter === "S"
                                ? "rgba(34,197,94,0.15)"
                                : grade.letter === "A"
                                  ? "rgba(76,141,255,0.15)"
                                  : grade.letter === "B"
                                    ? "rgba(20,184,166,0.15)"
                                    : grade.letter === "C"
                                      ? "rgba(249,115,22,0.15)"
                                      : "rgba(230,57,70,0.15)",
                            color:
                              grade.letter === "S"
                                ? "#22c55e"
                                : grade.letter === "A"
                                  ? "#4c8dff"
                                  : grade.letter === "B"
                                    ? "#14b8a6"
                                    : grade.letter === "C"
                                      ? "#f97316"
                                      : "#e63946",
                            border: `1px solid ${
                              grade.letter === "S"
                                ? "rgba(34,197,94,0.3)"
                                : grade.letter === "A"
                                  ? "rgba(76,141,255,0.3)"
                                  : grade.letter === "B"
                                    ? "rgba(20,184,166,0.3)"
                                    : grade.letter === "C"
                                      ? "rgba(249,115,22,0.3)"
                                      : "rgba(230,57,70,0.3)"
                            }`,
                          }}
                        >
                          {grade.letter}
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* Methodology */}
          <div className="neo-card p-5">
            <h2 className="font-heading font-bold text-sm text-white mb-3">
              Methodology
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-white/50 leading-relaxed">
              <div>
                <h3 className="font-mono text-[10px] text-white/30 uppercase tracking-wider mb-1">
                  Brier Score
                </h3>
                <p>
                  BS = (predicted_probability - actual_outcome)&sup2;. Range 0
                  (perfect) to 1 (worst). Computed on-chain by the
                  AccuracyTracker contract after market resolution.
                </p>
              </div>
              <div>
                <h3 className="font-mono text-[10px] text-white/30 uppercase tracking-wider mb-1">
                  Grading
                </h3>
                <p>
                  Agents are graded S through D based on average Brier score
                  across all resolved markets. S-tier (&lt;0.10) matches
                  superforecaster benchmarks from academic literature.
                </p>
              </div>
              <div>
                <h3 className="font-mono text-[10px] text-white/30 uppercase tracking-wider mb-1">
                  Data Source
                </h3>
                <p>
                  All scores are read directly from the on-chain
                  AccuracyTracker contract on Starknet Sepolia. No off-chain
                  caching or manipulation. Refreshes every 30 seconds.
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
