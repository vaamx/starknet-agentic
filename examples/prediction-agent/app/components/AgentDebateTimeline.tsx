"use client";

import { useEffect, useMemo, useState } from "react";

interface ActivityEntry {
  id: string;
  type: string;
  actor: string;
  marketId?: number;
  question?: string;
  probability?: number;
  detail?: string;
  debateTarget?: string;
  timestamp: number;
}

interface DebateThread {
  marketId: number;
  question: string;
  latestTimestamp: number;
  debates: Array<{
    actor: string;
    target?: string;
    detail?: string;
    timestamp: number;
  }>;
  predictions: Array<{
    actor: string;
    probability: number;
    timestamp: number;
  }>;
}

function timeAgo(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}

function ProbabilityTrail({ points }: { points: number[] }) {
  const chartPoints = points.slice(-8);
  if (chartPoints.length < 2) return null;
  const width = 220;
  const height = 32;
  const step = width / Math.max(1, chartPoints.length - 1);
  const polyline = chartPoints
    .map((value, idx) => {
      const x = idx * step;
      const y = height - (Math.max(0, Math.min(1, value)) * height);
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-8"
      aria-label="Probability trail"
    >
      <polyline
        points={polyline}
        fill="none"
        stroke="rgba(93, 245, 213, 0.9)"
        strokeWidth="2"
      />
    </svg>
  );
}

export default function AgentDebateTimeline() {
  const [activities, setActivities] = useState<ActivityEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/activity?limit=120", { cache: "no-store" });
        if (!res.ok) return;
        const payload = await res.json();
        const list = Array.isArray(payload.activities)
          ? (payload.activities as ActivityEntry[])
          : [];
        if (!cancelled) setActivities(list);
      } catch {
        // Non-fatal.
      }
    };

    load();
    const interval = setInterval(load, 20_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const threads = useMemo(() => {
    const byMarket = new Map<number, DebateThread>();
    for (const activity of activities) {
      if (typeof activity.marketId !== "number") continue;
      if (
        activity.type !== "debate" &&
        activity.type !== "prediction" &&
        activity.type !== "bet"
      ) {
        continue;
      }
      const marketId = activity.marketId;
      const existing = byMarket.get(marketId) ?? {
        marketId,
        question: activity.question ?? `Market #${marketId}`,
        latestTimestamp: activity.timestamp,
        debates: [],
        predictions: [],
      };
      existing.latestTimestamp = Math.max(existing.latestTimestamp, activity.timestamp);
      if (activity.question && existing.question.startsWith("Market #")) {
        existing.question = activity.question;
      }
      if (activity.type === "debate") {
        existing.debates.push({
          actor: activity.actor,
          target: activity.debateTarget,
          detail: activity.detail,
          timestamp: activity.timestamp,
        });
      }
      if (
        activity.type === "prediction" &&
        typeof activity.probability === "number"
      ) {
        existing.predictions.push({
          actor: activity.actor,
          probability: Math.max(0, Math.min(1, activity.probability)),
          timestamp: activity.timestamp,
        });
      }
      byMarket.set(marketId, existing);
    }

    return Array.from(byMarket.values())
      .map((thread) => {
        const predictionValues = thread.predictions.map((p) => p.probability);
        const divergence =
          predictionValues.length > 1
            ? Math.max(...predictionValues) - Math.min(...predictionValues)
            : 0;
        return { ...thread, divergence };
      })
      .filter((thread) => thread.debates.length > 0 || thread.predictions.length > 1)
      .sort((a, b) => b.latestTimestamp - a.latestTimestamp)
      .slice(0, 6);
  }, [activities]);

  if (threads.length === 0) {
    return (
      <section className="neo-card p-4">
        <h3 className="font-heading font-bold text-sm mb-1">Agent Debate Timeline</h3>
        <p className="text-xs text-white/45">
          Waiting for cross-agent disagreements to form.
        </p>
      </section>
    );
  }

  return (
    <section className="neo-card p-4" aria-label="Agent debate timeline">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-heading font-bold text-sm">Agent Debate Timeline</h3>
        <span className="text-[10px] font-mono text-white/35">
          {threads.length} active threads
        </span>
      </div>
      <div className="space-y-3">
        {threads.map((thread) => {
          const latestDebate = thread.debates.sort((a, b) => b.timestamp - a.timestamp)[0];
          const recentPredictions = thread.predictions
            .slice()
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, 4);
          return (
            <article key={thread.marketId} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-white/80 line-clamp-2">
                  {thread.question}
                </p>
                <span className="text-[10px] font-mono text-white/35 whitespace-nowrap">
                  {timeAgo(thread.latestTimestamp)}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-2 text-[10px] font-mono">
                <span className="rounded-full border border-neo-orange/35 bg-neo-orange/10 px-2 py-0.5 text-neo-orange">
                  div {(thread.divergence * 100).toFixed(0)}pp
                </span>
                <span className="text-white/35">m#{thread.marketId}</span>
              </div>
              <div className="mt-2">
                <ProbabilityTrail points={thread.predictions.map((p) => p.probability)} />
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {recentPredictions.map((prediction, idx) => (
                  <span
                    key={`${prediction.actor}-${prediction.timestamp}-${idx}`}
                    className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-white/65"
                  >
                    {prediction.actor}: {(prediction.probability * 100).toFixed(0)}%
                  </span>
                ))}
              </div>
              {latestDebate && (
                <p className="mt-2 text-[11px] text-white/55 line-clamp-2">
                  <span className="text-white/75">{latestDebate.actor}</span>
                  {latestDebate.target ? ` -> ${latestDebate.target}: ` : ": "}
                  {latestDebate.detail ?? "debate update"}
                </p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
