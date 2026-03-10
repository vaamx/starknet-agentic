"use client";

import { useState, useEffect } from "react";

interface BuzzReward {
  id: string;
  type: string;
  amount: number;
  reason: string;
  timestamp: string;
}

interface BuzzRewardsData {
  totalEarned: number;
  pendingCount: number;
  rewards: BuzzReward[];
}

const REWARD_ICONS: Record<string, string> = {
  forecast_submit: "\uD83C\uDFAF",
  forecast_accurate: "\u2B50",
  forecast_elite: "\uD83C\uDFC6",
  byok_forecast: "\uD83E\uDD16",
  debate_participate: "\uD83D\uDCAC",
  market_create: "\uD83D\uDCCA",
  winning_claim: "\uD83D\uDCB0",
  research_contribute: "\uD83D\uDD2C",
  starkcast_post: "\uD83D\uDCE1",
  weekly_top5: "\uD83D\uDC51",
};

const REWARD_LABELS: Record<string, string> = {
  forecast_submit: "Forecast Submitted",
  forecast_accurate: "Accurate Forecast",
  forecast_elite: "Elite Forecast",
  byok_forecast: "BYOK Forecast",
  debate_participate: "Debate Participation",
  market_create: "Market Created",
  winning_claim: "Winning Claim",
  research_contribute: "Research Contribution",
  starkcast_post: "StarkCast Post",
  weekly_top5: "Weekly Top 5",
};

interface BuzzRewardsPanelProps {
  walletAddress: string;
}

export default function BuzzRewardsPanel({ walletAddress }: BuzzRewardsPanelProps) {
  const [data, setData] = useState<BuzzRewardsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(
          `/api/buzz/rewards?address=${encodeURIComponent(walletAddress)}`
        );
        if (!res.ok) throw new Error("Failed to fetch rewards");
        const json = await res.json();
        if (!cancelled) {
          setData(json);
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
  }, [walletAddress]);

  if (loading) {
    return (
      <div className="neo-card p-6 animate-pulse">
        <div className="h-5 w-40 rounded bg-white/[0.06] mb-4" />
        <div className="h-10 w-28 rounded bg-white/[0.06] mb-6" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 rounded-lg bg-white/[0.04]" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="neo-card p-6">
        <p className="text-sm text-white/40">Unable to load BUZZ rewards.</p>
      </div>
    );
  }

  const rewards = data?.rewards ?? [];
  const totalEarned = data?.totalEarned ?? 0;
  const pendingCount = data?.pendingCount ?? 0;

  return (
    <div className="neo-card overflow-hidden">
      {/* Amber gradient header */}
      <div className="relative px-5 py-5 bg-gradient-to-r from-amber-500/10 via-amber-400/[0.06] to-transparent border-b border-amber-400/10">
        <p className="text-[10px] uppercase tracking-wider text-amber-400/60 font-mono mb-1">
          Total Earned
        </p>
        <p className="text-3xl font-heading font-bold tabular-nums text-amber-400">
          {totalEarned.toLocaleString()}
          <span className="ml-1.5 text-sm font-semibold text-amber-400/50">BUZZ</span>
        </p>
        {pendingCount > 0 && (
          <p className="mt-1 text-[11px] text-amber-300/50 font-mono">
            {pendingCount} pending reward{pendingCount !== 1 ? "s" : ""}
          </p>
        )}
      </div>

      {/* Rewards list */}
      <div className="divide-y divide-white/[0.04]">
        {rewards.length === 0 && (
          <div className="px-5 py-8 text-center">
            <p className="text-sm text-white/30">No rewards yet. Start forecasting to earn BUZZ.</p>
          </div>
        )}
        {rewards.map((r) => {
          const icon = REWARD_ICONS[r.type] || "\u2728";
          const label = REWARD_LABELS[r.type] || r.type;
          const ts = new Date(r.timestamp);
          const timeStr = ts.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          });

          return (
            <div
              key={r.id}
              className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-white/[0.02]"
            >
              <span className="text-lg flex-shrink-0 w-7 text-center">{icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-white/85 truncate">
                  {label}
                </p>
                <p className="text-[11px] text-white/35 truncate">{r.reason}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-[13px] font-bold tabular-nums text-amber-400">
                  +{r.amount.toLocaleString()}
                </p>
                <p className="text-[10px] text-white/30 font-mono">{timeStr}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
