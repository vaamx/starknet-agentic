"use client";

import { useState, useEffect } from "react";
import { useAccount } from "@starknet-react/core";

interface UserStats {
  streak: number;
  accuracy: number;
  totalBets: number;
  pnl: number;
}

const DEFAULT_STATS: UserStats = {
  streak: 0,
  accuracy: 0,
  totalBets: 0,
  pnl: 0,
};

export default function UserStatsBar() {
  const { address, isConnected } = useAccount();
  const [stats, setStats] = useState<UserStats>(DEFAULT_STATS);

  useEffect(() => {
    if (!isConnected || !address) {
      setStats(DEFAULT_STATS);
      return;
    }
    try {
      const raw = localStorage.getItem(`user-stats-v1-${address}`);
      if (raw) {
        setStats({ ...DEFAULT_STATS, ...JSON.parse(raw) });
      }
    } catch {
      // ignore
    }
  }, [address, isConnected]);

  if (!isConnected) return null;

  return (
    <div className="flex items-center gap-2 text-xs text-white/60">
      {stats.streak > 0 && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-neo-orange/20 bg-neo-orange/5">
          <span className="w-1 h-1 rounded-full bg-neo-orange" />
          <span className="text-[10px] text-neo-orange font-semibold">streak</span>
          <span className="font-mono font-bold text-[10px] text-white/80">{stats.streak}</span>
        </span>
      )}
      {stats.totalBets > 0 && (
        <>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-white/[0.08] bg-white/[0.03]">
            <span className="text-[10px] text-white/50">accuracy</span>
            <span className="font-mono font-bold text-[10px] text-white/80">
              {(stats.accuracy * 100).toFixed(0)}%
            </span>
          </span>
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border ${
            stats.pnl >= 0 ? "border-neo-green/20 bg-neo-green/5" : "border-neo-red/20 bg-neo-red/5"
          }`}>
            <span className="text-[10px] text-white/50">P&L</span>
            <span
              className={`font-mono font-bold text-[10px] ${
                stats.pnl >= 0 ? "text-neo-green" : "text-neo-red"
              }`}
            >
              {stats.pnl >= 0 ? "+" : ""}
              {stats.pnl.toFixed(1)}
            </span>
          </span>
        </>
      )}
    </div>
  );
}
