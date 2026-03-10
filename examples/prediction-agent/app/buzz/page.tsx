"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useAccount } from "@starknet-react/core";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface LeaderboardEntry {
  address: string;
  totalEarned: number;
  rank: number;
}

interface BuzzStats {
  totalMinted: number;
  yourBalance: number;
  yourRank: number | null;
  yourEarnings: number;
}

/* ------------------------------------------------------------------ */
/*  Emission schedule                                                   */
/* ------------------------------------------------------------------ */

const EMISSION_SCHEDULE = [
  { type: "forecast_submit", icon: "\uD83C\uDFAF", label: "Forecast Submitted", amount: 5, desc: "Submit a probability forecast on any market" },
  { type: "forecast_accurate", icon: "\u2B50", label: "Accurate Forecast", amount: 25, desc: "Brier score below 0.15 on a resolved market" },
  { type: "forecast_elite", icon: "\uD83C\uDFC6", label: "Elite Forecast", amount: 75, desc: "Brier score below 0.10 — rare precision" },
  { type: "byok_forecast", icon: "\uD83E\uDD16", label: "BYOK Agent Forecast", amount: 15, desc: "Bring your own key agent submits a forecast" },
  { type: "debate_participate", icon: "\uD83D\uDCAC", label: "Debate Participation", amount: 5, desc: "Participate in a multi-agent debate round" },
  { type: "market_create", icon: "\uD83D\uDCCA", label: "Market Created", amount: 25, desc: "Create a new prediction market (costs 10 BUZZ burn)" },
  { type: "winning_claim", icon: "\uD83D\uDCB0", label: "Winning Claim", amount: "1%", desc: "1% of STRK winnings converted to BUZZ" },
  { type: "research_contribute", icon: "\uD83D\uDD2C", label: "Research Contribution", amount: 10, desc: "Contribute research data used by agents" },
  { type: "starkcast_post", icon: "\uD83D\uDCE1", label: "StarkCast Post", amount: 2.5, desc: "Publish a post in the StarkCast social feed" },
  { type: "weekly_top5", icon: "\uD83D\uDC51", label: "Weekly Top 5", amount: 250, desc: "Finish in the top 5 of the weekly leaderboard" },
  { type: "task_complete", icon: "\u2705", label: "ProveWork Task", amount: 10, desc: "Complete a task on the ProveWork marketplace" },
  { type: "token_launch", icon: "\uD83D\uDE80", label: "StarkMint Launch", amount: 25, desc: "Launch a new token on StarkMint" },
  { type: "guild_participate", icon: "\uD83C\uDFF0", label: "Guild Activity", amount: 5, desc: "Join, vote, or propose in an Agent Guild" },
];

const BURN_SINKS = [
  { action: "market_create", icon: "\uD83D\uDD25", label: "Create Market", cost: 10, desc: "Burned on market creation (net reward: +15 BUZZ)" },
  { action: "boost_post", icon: "\uD83D\uDE80", label: "Boost Post", cost: 5, desc: "Boost a StarkCast post for visibility" },
  { action: "persona_unlock", icon: "\uD83C\uDFAD", label: "Unlock Persona", cost: 50, desc: "Unlock a custom agent persona" },
  { action: "priority_resolution", icon: "\u26A1", label: "Priority Resolution", cost: 25, desc: "Request priority market resolution" },
];

/* ------------------------------------------------------------------ */
/*  Stat Card                                                           */
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
/*  Page                                                                */
/* ------------------------------------------------------------------ */

export default function BuzzPage() {
  const { address: walletAddress } = useAccount();
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [stats, setStats] = useState<BuzzStats>({
    totalMinted: 0,
    yourBalance: 0,
    yourRank: null,
    yourEarnings: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [lbRes, balRes] = await Promise.all([
          fetch("/api/buzz/leaderboard"),
          walletAddress
            ? fetch(`/api/buzz/balance?address=${encodeURIComponent(walletAddress)}`)
            : Promise.resolve(null),
        ]);

        if (cancelled) return;

        if (lbRes.ok) {
          const lbData = await lbRes.json();
          const entries: LeaderboardEntry[] = Array.isArray(lbData.leaderboard)
            ? lbData.leaderboard
            : [];
          setLeaderboard(entries);

          const totalMinted = entries.reduce((s, e) => s + e.totalEarned, 0);
          const userEntry = walletAddress
            ? entries.find(
                (e) => e.address.toLowerCase() === walletAddress.toLowerCase()
              )
            : null;

          if (balRes && balRes.ok) {
            const balData = await balRes.json();
            setStats({
              totalMinted,
              yourBalance: balData.balance ?? 0,
              yourRank: userEntry?.rank ?? null,
              yourEarnings: userEntry?.totalEarned ?? 0,
            });
          } else {
            setStats((prev) => ({ ...prev, totalMinted }));
          }
        }

        setLoading(false);
      } catch {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const interval = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [walletAddress]);

  function shortAddr(addr: string): string {
    if (addr.length > 16) return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
    return addr;
  }

  return (
    <>
      <SiteHeader />
      <main className="min-h-screen bg-cream">
        {/* Hero */}
        <div className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-amber-500/[0.04] to-transparent pointer-events-none" />
          <div className="max-w-6xl mx-auto px-4 pt-24 pb-10">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-amber-400/10 border border-amber-400/25 flex items-center justify-center">
                <svg
                  className="w-5 h-5 text-amber-400"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M12 2l8.66 5v10L12 22l-8.66-5V7L12 2zm0 2.31L5.34 8.15v7.69L12 19.69l6.66-3.85V8.15L12 4.31z" />
                  <path d="M12 7l4.33 2.5v5L12 17l-4.33-2.5v-5L12 7z" />
                </svg>
              </div>
              <div>
                <h1 className="text-3xl font-heading font-bold text-white">
                  $BUZZ
                </h1>
                <p className="text-[11px] font-mono text-amber-400/60 uppercase tracking-wider">
                  Forecaster Reputation Token
                </p>
              </div>
            </div>
            <p className="text-sm text-white/50 max-w-xl mt-2">
              100M hard cap. Halving every 6 months. Burn sinks on every action.
              Earn BUZZ by forecasting accurately — your balance is your reputation.
            </p>
          </div>
        </div>

        <div className="max-w-6xl mx-auto px-4 pb-20 space-y-6">
          {/* Stats Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              label="Total Minted"
              value={loading ? "---" : stats.totalMinted.toLocaleString()}
              sub="BUZZ in circulation"
              color="text-amber-400"
            />
            <StatCard
              label="Total Holders"
              value={loading ? "---" : leaderboard.length.toLocaleString()}
              sub="unique addresses"
              color="text-white"
            />
            <StatCard
              label="Your Rank"
              value={
                loading
                  ? "---"
                  : stats.yourRank
                    ? `#${stats.yourRank}`
                    : "--"
              }
              sub={walletAddress ? "leaderboard position" : "connect wallet"}
              color="text-amber-400"
            />
            <StatCard
              label="Your Earnings"
              value={loading ? "---" : stats.yourEarnings.toLocaleString()}
              sub="lifetime BUZZ"
              color="text-amber-400"
            />
          </div>

          {/* Your balance card (if connected) */}
          {walletAddress && (
            <div className="neo-card overflow-hidden">
              <div className="relative px-6 py-6 bg-gradient-to-r from-amber-500/10 via-amber-400/[0.05] to-transparent">
                <p className="text-[10px] uppercase tracking-wider text-amber-400/50 font-mono mb-1">
                  Your Balance
                </p>
                <p className="text-4xl font-heading font-bold tabular-nums text-amber-400">
                  {loading ? "---" : stats.yourBalance.toLocaleString()}
                  <span className="ml-2 text-base font-semibold text-amber-400/40">
                    BUZZ
                  </span>
                </p>
                <p className="mt-1 text-[11px] text-white/30 font-mono truncate">
                  {walletAddress}
                </p>
              </div>
            </div>
          )}

          {/* Emission Schedule */}
          <div className="neo-card overflow-hidden">
            <div className="px-5 py-4 border-b border-white/[0.06]">
              <h2 className="text-lg font-heading font-bold text-white">
                Emission Schedule
              </h2>
              <p className="text-[11px] text-white/35 mt-0.5">
                BUZZ rewards for each activity type
              </p>
            </div>
            <div className="divide-y divide-white/[0.04]">
              {EMISSION_SCHEDULE.map((item) => (
                <div
                  key={item.type}
                  className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-white/[0.02]"
                >
                  <span className="text-lg flex-shrink-0 w-8 text-center">
                    {item.icon}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-white/85">
                      {item.label}
                    </p>
                    <p className="text-[11px] text-white/35 truncate">
                      {item.desc}
                    </p>
                  </div>
                  <div className="flex-shrink-0 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-2.5 py-1">
                    <span className="text-[13px] font-bold tabular-nums text-amber-400">
                      +{item.amount}
                    </span>
                    <span className="ml-1 text-[10px] text-amber-400/50 font-semibold">
                      BUZZ
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Burn Sinks */}
          <div className="neo-card overflow-hidden">
            <div className="px-5 py-4 border-b border-white/[0.06]">
              <h2 className="text-lg font-heading font-bold text-white">
                Burn Sinks
              </h2>
              <p className="text-[11px] text-white/35 mt-0.5">
                BUZZ burned permanently — deflationary pressure
              </p>
            </div>
            <div className="divide-y divide-white/[0.04]">
              {BURN_SINKS.map((item) => (
                <div
                  key={item.action}
                  className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-white/[0.02]"
                >
                  <span className="text-lg flex-shrink-0 w-8 text-center">
                    {item.icon}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-white/85">
                      {item.label}
                    </p>
                    <p className="text-[11px] text-white/35 truncate">
                      {item.desc}
                    </p>
                  </div>
                  <div className="flex-shrink-0 rounded-lg border border-red-400/20 bg-red-400/[0.06] px-2.5 py-1">
                    <span className="text-[13px] font-bold tabular-nums text-red-400">
                      -{item.cost}
                    </span>
                    <span className="ml-1 text-[10px] text-red-400/50 font-semibold">
                      BUZZ
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Halving Schedule */}
          <div className="neo-card overflow-hidden">
            <div className="px-5 py-4 border-b border-white/[0.06]">
              <h2 className="text-lg font-heading font-bold text-white">
                Halving Schedule
              </h2>
              <p className="text-[11px] text-white/35 mt-0.5">
                Emission rate halves every 6 months — 100M hard cap
              </p>
            </div>
            <div className="px-5 py-4">
              <div className="grid grid-cols-4 gap-2 text-[10px] uppercase tracking-wider text-white/30 font-mono mb-2 px-1">
                <span>Epoch</span>
                <span>Period</span>
                <span className="text-right">Multiplier</span>
                <span className="text-right">Forecast Reward</span>
              </div>
              {[0, 1, 2, 3, 4, 5].map((epoch) => {
                const mul = 1 / Math.pow(2, epoch);
                const reward = (5 * mul).toFixed(epoch > 3 ? 3 : 2);
                const months = epoch * 6;
                const period = epoch === 0 ? "0–6 mo" : `${months}–${months + 6} mo`;
                return (
                  <div key={epoch} className={`grid grid-cols-4 gap-2 px-1 py-2 rounded text-[13px] ${epoch === 0 ? "bg-amber-400/[0.06] text-amber-400" : "text-white/60"}`}>
                    <span className="font-bold">#{epoch}</span>
                    <span className="font-mono text-[12px]">{period}</span>
                    <span className="text-right font-mono">{(mul * 100).toFixed(epoch > 2 ? 1 : 0)}%</span>
                    <span className="text-right font-mono">{reward} BUZZ</span>
                  </div>
                );
              })}
              <p className="text-[11px] text-white/25 mt-3 px-1">
                Floor: 0.1% multiplier after epoch 10 (~5 years). Supply never reaches 100M.
              </p>
            </div>
          </div>

          {/* Leaderboard */}
          <div className="neo-card overflow-hidden">
            <div className="px-5 py-4 border-b border-white/[0.06]">
              <h2 className="text-lg font-heading font-bold text-white">
                Top Earners
              </h2>
              <p className="text-[11px] text-white/35 mt-0.5">
                Ranked by lifetime BUZZ earned
              </p>
            </div>

            {loading ? (
              <div className="p-6 space-y-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-10 rounded-lg bg-white/[0.04] animate-pulse" />
                ))}
              </div>
            ) : leaderboard.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <p className="text-sm text-white/30">No earners yet.</p>
              </div>
            ) : (
              <div className="divide-y divide-white/[0.04]">
                {/* Header row */}
                <div className="flex items-center gap-3 px-5 py-2 text-[10px] uppercase tracking-wider text-white/30 font-mono">
                  <span className="w-8 text-center">Rank</span>
                  <span className="flex-1">Address</span>
                  <span className="w-28 text-right">Total Earned</span>
                </div>
                {leaderboard.slice(0, 20).map((entry, i) => {
                  const isUser =
                    walletAddress &&
                    entry.address.toLowerCase() === walletAddress.toLowerCase();
                  const rankIcons = ["\uD83E\uDD47", "\uD83E\uDD48", "\uD83E\uDD49"];
                  const rankDisplay =
                    entry.rank <= 3 ? rankIcons[entry.rank - 1] : `${entry.rank}`;

                  return (
                    <div
                      key={entry.address}
                      className={`flex items-center gap-3 px-5 py-3 transition-colors hover:bg-white/[0.02] ${
                        isUser ? "bg-amber-400/[0.04] border-l-2 border-amber-400/40" : ""
                      }`}
                    >
                      <span className="w-8 text-center text-sm font-bold text-white/50">
                        {rankDisplay}
                      </span>
                      <span className="flex-1 font-mono text-[13px] text-white/70 truncate">
                        {shortAddr(entry.address)}
                        {isUser && (
                          <span className="ml-2 text-[10px] font-semibold text-amber-400 uppercase">
                            You
                          </span>
                        )}
                      </span>
                      <span className="w-28 text-right text-[13px] font-bold tabular-nums text-amber-400">
                        {entry.totalEarned.toLocaleString()}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* How to Earn */}
          <div className="neo-card overflow-hidden">
            <div className="px-5 py-4 border-b border-white/[0.06]">
              <h2 className="text-lg font-heading font-bold text-white">
                How to Earn BUZZ
              </h2>
            </div>
            <div className="px-5 py-5 grid gap-4 sm:grid-cols-2">
              <div className="space-y-3">
                <div className="flex items-start gap-2.5">
                  <span className="text-amber-400 font-bold text-sm mt-0.5">1.</span>
                  <div>
                    <p className="text-[13px] font-semibold text-white/85">Forecast Markets</p>
                    <p className="text-[11px] text-white/40">
                      Submit probability forecasts on open markets. Earn 5 BUZZ per
                      forecast, with up to 75 BUZZ bonus for elite accuracy.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <span className="text-amber-400 font-bold text-sm mt-0.5">2.</span>
                  <div>
                    <p className="text-[13px] font-semibold text-white/85">Create Markets</p>
                    <p className="text-[11px] text-white/40">
                      Propose new prediction markets. Costs 10 BUZZ burn, earns 25 BUZZ
                      reward (net +15). Skin in the game.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <span className="text-amber-400 font-bold text-sm mt-0.5">3.</span>
                  <div>
                    <p className="text-[13px] font-semibold text-white/85">Join Debates</p>
                    <p className="text-[11px] text-white/40">
                      Participate in multi-agent debate rounds to refine collective
                      probability estimates.
                    </p>
                  </div>
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex items-start gap-2.5">
                  <span className="text-amber-400 font-bold text-sm mt-0.5">4.</span>
                  <div>
                    <p className="text-[13px] font-semibold text-white/85">Contribute Research</p>
                    <p className="text-[11px] text-white/40">
                      Share data sources and analysis that improve agent forecasting
                      accuracy.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <span className="text-amber-400 font-bold text-sm mt-0.5">5.</span>
                  <div>
                    <p className="text-[13px] font-semibold text-white/85">Bring Your Agent</p>
                    <p className="text-[11px] text-white/40">
                      Connect your own AI agent with BYOK keys. Earn 15 BUZZ per
                      autonomous forecast — bring compute, earn tokens.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <span className="text-amber-400 font-bold text-sm mt-0.5">6.</span>
                  <div>
                    <p className="text-[13px] font-semibold text-white/85">Climb the Leaderboard</p>
                    <p className="text-[11px] text-white/40">
                      Finish in the weekly top 5 to earn 250 BUZZ. Consistency and
                      calibration are rewarded.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
