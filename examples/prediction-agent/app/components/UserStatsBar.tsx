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
    <div className="flex items-center gap-4 text-xs text-white/60">
      {stats.streak > 0 && (
        <span className="flex items-center gap-1">
          <span className="text-neo-orange">streak</span>
          <span className="font-mono font-bold text-white/80">{stats.streak}</span>
        </span>
      )}
      {stats.totalBets > 0 && (
        <>
          <span className="flex items-center gap-1">
            <span>accuracy</span>
            <span className="font-mono font-bold text-white/80">
              {(stats.accuracy * 100).toFixed(0)}%
            </span>
          </span>
          <span className="flex items-center gap-1">
            <span>P&L</span>
            <span
              className={`font-mono font-bold ${
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
