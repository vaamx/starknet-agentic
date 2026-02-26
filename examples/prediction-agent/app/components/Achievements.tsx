"use client";

import { useState, useEffect } from "react";
import { useAccount } from "@starknet-react/core";

interface Achievement {
  id: string;
  label: string;
  description: string;
  icon: string;
  unlocked: boolean;
}

const ACHIEVEMENT_DEFS = [
  { id: "first_bet", label: "First Bet", description: "Place your first prediction bet", icon: "1" },
  { id: "oracle_duty", label: "Oracle Duty", description: "Resolve a market as oracle", icon: "O" },
  { id: "market_maker", label: "Market Maker", description: "Create a custom market", icon: "M" },
  { id: "swarm_tamer", label: "Swarm Tamer", description: "Spawn a custom agent", icon: "S" },
  { id: "streak_3", label: "Hot Streak", description: "Win 3 predictions in a row", icon: "3" },
  { id: "whale", label: "Whale", description: "Place a bet over 100 STRK", icon: "W" },
];

export default function Achievements() {
  const { address, isConnected } = useAccount();
  const [unlockedIds, setUnlockedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!isConnected || !address) return;
    try {
      const raw = localStorage.getItem(`achievements-v1-${address}`);
      if (raw) {
        setUnlockedIds(new Set(JSON.parse(raw)));
      }
    } catch {
      // ignore
    }
  }, [address, isConnected]);

  if (!isConnected) return null;

  const achievements: Achievement[] = ACHIEVEMENT_DEFS.map((def) => ({
    ...def,
    unlocked: unlockedIds.has(def.id),
  }));

  const unlockedCount = achievements.filter((a) => a.unlocked).length;

  return (
    <div className="neo-card overflow-hidden">
      <div className="px-4 py-3 border-b border-white/[0.07] bg-white/[0.03] flex items-center justify-between">
        <h3 className="font-heading font-bold text-xs text-white">Achievements</h3>
        <span className="text-xs font-mono text-white/40">
          {unlockedCount}/{achievements.length}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 p-3">
        {achievements.map((a) => (
          <div
            key={a.id}
            className={`flex flex-col items-center gap-1 p-2 rounded-lg border transition-colors ${
              a.unlocked
                ? "border-neo-brand/30 bg-neo-brand/10"
                : "border-white/[0.05] bg-white/[0.02] opacity-40"
            }`}
            title={a.description}
          >
            <span
              className={`w-7 h-7 flex items-center justify-center rounded-lg text-xs font-bold ${
                a.unlocked
                  ? "bg-neo-brand/20 text-neo-brand"
                  : "bg-white/10 text-white/30"
              }`}
            >
              {a.icon}
            </span>
            <span className="text-[10px] text-center text-white/70 leading-tight">
              {a.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
