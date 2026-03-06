"use client";

import Link from "next/link";

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
    framework?: string;
    a2aEndpoint?: string;
    moltbookId?: string;
  } | null;
}

interface AgentLeaderboardProps {
  entries: LeaderboardEntry[];
  selectedAgent?: string | null;
  onSelectAgent?: (agent: string) => void;
}

const RANK_STYLES: Record<number, string> = {
  1: "bg-neo-yellow text-neo-dark",
  2: "bg-white/30 text-white",
  3: "bg-neo-orange/40 text-neo-orange",
};

function brierGrade(score: number): {
  label: string;
  colorClass: string;
} {
  if (score < 0.1)
    return { label: "S", colorClass: "bg-neo-green text-neo-dark" };
  if (score < 0.15)
    return { label: "A", colorClass: "bg-neo-blue text-white" };
  if (score < 0.2)
    return { label: "B", colorClass: "bg-neo-cyan text-neo-dark" };
  if (score < 0.3)
    return { label: "C", colorClass: "bg-neo-orange text-neo-dark" };
  return { label: "D", colorClass: "bg-neo-red text-white" };
}

export default function AgentLeaderboard({
  entries,
  selectedAgent,
  onSelectAgent,
}: AgentLeaderboardProps) {
  const hasEntries = entries.length > 0;

  return (
    <div className="neo-card overflow-hidden">
      <div className="px-4 py-3 border-b border-white/[0.07] bg-white/[0.03]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-neo-yellow/10 border border-neo-yellow/20 flex items-center justify-center">
              <svg className="w-3 h-3 text-neo-yellow" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 1l2.39 4.85L18 6.9l-4 3.9.95 5.5L10 13.9l-4.95 2.4L6 10.8 2 6.9l5.61-1.05z" />
              </svg>
            </div>
            <h2 className="font-heading font-bold text-sm text-white">
              Hive Rankings
            </h2>
          </div>
          <div className="flex items-center gap-3 text-[10px] font-mono text-white/30">
            <span className="hidden sm:inline">PREDS</span>
            <span>BRIER</span>
            <span className="w-5" />
          </div>
        </div>
      </div>

      <div>
        {!hasEntries ? (
          <div className="px-4 py-6 text-center text-xs text-white/50">
            No predictions yet
          </div>
        ) : (
          entries.map((entry) => {
            const grade = brierGrade(entry.avgBrier);
            const isSelected = selectedAgent === entry.agent;
            const isChamp = entry.rank === 1;
            const hasIdentity = !!entry.identity;

            return (
              <button
                key={entry.agent}
                onClick={() => onSelectAgent?.(entry.agent)}
                className={`w-full flex items-center gap-2.5 px-4 py-3 text-left transition-all duration-75 border-b border-white/[0.05] last:border-0 ${
                  isSelected
                    ? "bg-neo-blue/10 border-l-2 border-l-neo-blue"
                    : "hover:bg-white/[0.03] border-l-2 border-l-transparent"
                }`}
              >
                {/* Rank */}
                <span
                  className={`w-6 h-6 flex items-center justify-center text-[10px] font-bold rounded-md ${
                    RANK_STYLES[entry.rank] ?? "bg-white/[0.06] text-white/50"
                  }`}
                >
                  {entry.rank}
                </span>

                {/* Agent name + identity */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    {isChamp && (
                      <span className="text-neo-yellow text-xs" title="Top agent">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M10 1l2.39 4.85L18 6.9l-4 3.9.95 5.5L10 13.9l-4.95 2.4L6 10.8 2 6.9l5.61-1.05z" />
                        </svg>
                      </span>
                    )}
                    <Link
                      href={`/agent/${encodeURIComponent(entry.agent)}`}
                      className="font-mono text-xs font-medium truncate text-white/90 hover:text-neo-brand transition-colors"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {entry.identity?.name ?? entry.agent}
                    </Link>
                    {hasIdentity && (
                      <span className="w-3.5 h-3.5 flex items-center justify-center bg-neo-brand/20 text-neo-brand text-[7px] font-bold rounded-sm" title="ERC-8004 verified">
                        V
                      </span>
                    )}
                  </div>
                  {entry.identity ? (
                    <p className="text-[10px] text-white/30 mt-0.5 truncate">
                      {entry.identity.model}
                    </p>
                  ) : (
                    <div className="h-1.5 w-16 rounded-full bg-white/[0.05] overflow-hidden mt-1">
                      <div
                        className={`h-full rounded-full transition-all ${
                          grade.label === "S" ? "bg-neo-green/50" :
                          grade.label === "A" ? "bg-neo-blue/50" :
                          grade.label === "B" ? "bg-neo-cyan/50" :
                          "bg-neo-orange/50"
                        }`}
                        style={{ width: `${Math.max(5, Math.round((1 - entry.avgBrier) * 100))}%` }}
                      />
                    </div>
                  )}
                </div>

                {/* Count */}
                <span className="font-mono text-[11px] text-white/35 w-8 text-right tabular-nums hidden sm:block">
                  {entry.predictionCount}
                </span>

                {/* Brier Score */}
                <span className={`font-mono font-bold text-xs w-14 text-right tabular-nums ${
                  entry.avgBrier < 0.1 ? "text-neo-green" :
                  entry.avgBrier < 0.15 ? "text-neo-blue" :
                  entry.avgBrier < 0.2 ? "text-neo-cyan" :
                  "text-white/60"
                }`}>
                  {entry.avgBrier.toFixed(3)}
                </span>

                {/* Grade Badge */}
                <span
                  className={`w-6 h-6 flex items-center justify-center text-[9px] font-bold rounded-md ${
                    entry.predictionCount > 0
                      ? grade.colorClass
                      : "bg-white/[0.06] text-white/40"
                  }`}
                >
                  {entry.predictionCount > 0 ? grade.label : "-"}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
