"use client";

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
  bg: string;
  text: string;
} {
  if (score < 0.1)
    return { label: "S", bg: "bg-neo-green", text: "text-neo-dark" };
  if (score < 0.15)
    return { label: "A", bg: "bg-neo-blue", text: "text-white" };
  if (score < 0.2)
    return { label: "B", bg: "bg-neo-cyan", text: "text-neo-dark" };
  if (score < 0.3)
    return { label: "C", bg: "bg-neo-orange", text: "text-neo-dark" };
  return { label: "D", bg: "bg-neo-pink", text: "text-neo-dark" };
}

export default function AgentLeaderboard({
  entries,
  selectedAgent,
  onSelectAgent,
}: AgentLeaderboardProps) {
  const hasEntries = entries.length > 0;

  return (
    <div className="neo-card overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3.5 border-b border-white/10 bg-white/5">
        <div className="flex items-center justify-between">
          <h2 className="font-heading font-bold text-white text-sm tracking-tight">
            Swarm Rankings
          </h2>
          <span className="font-mono text-[10px] text-neo-green/70 tracking-wider">
            BRIER SCORE
          </span>
        </div>
      </div>

      {/* Table Header */}
      <div className="flex items-center px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/40 border-b border-white/10 bg-white/5">
        <span className="w-7">#</span>
        <span className="flex-1">Agent</span>
        <span className="w-10 text-right">N</span>
        <span className="w-16 text-right">Score</span>
        <span className="w-8 text-center">Gr</span>
      </div>

      {/* Rows */}
      <div>
        {!hasEntries ? (
          <div className="px-4 py-6 text-center text-xs font-mono text-white/50">
            No on-chain predictions yet
          </div>
        ) : (
          entries.map((entry, i) => {
            const grade = brierGrade(entry.avgBrier);
            const isSelected = selectedAgent === entry.agent;

            return (
              <button
                key={entry.agent}
                onClick={() => onSelectAgent?.(entry.agent)}
                className={`w-full flex items-center px-4 py-2.5 text-left transition-all duration-100 animate-enter border-b border-white/10 last:border-0 ${
                  isSelected
                    ? "bg-neo-blue/10 border-l-4 border-l-neo-blue pl-3"
                    : "hover:bg-white/5 border-l-4 border-l-transparent pl-3"
                }`}
                style={{ animationDelay: `${i * 50}ms` }}
              >
                {/* Rank */}
                <span
                  className={`w-5 h-5 flex items-center justify-center text-[10px] font-black border border-white/10 rounded ${
                    RANK_STYLES[entry.rank] ?? "bg-white/10 text-white/50"
                  }`}
                >
                  {entry.rank}
                </span>

                {/* Agent */}
                <div className="flex-1 min-w-0 ml-2.5">
                  <div className="flex items-center gap-1.5">
                    <p className="font-mono text-xs font-medium truncate leading-none text-white/90">
                      {entry.identity?.name ?? entry.agent}
                    </p>
                  </div>
                  {entry.identity && (
                    <p className="text-[9px] text-white/40 mt-0.5 truncate">
                      {entry.identity.agentType} · {entry.identity.model}
                    </p>
                  )}
                </div>

                {/* Count */}
                <span className="font-mono text-[11px] text-white/40 w-10 text-right">
                  {entry.predictionCount}
                </span>

                {/* Brier Score */}
                <span className="font-mono font-bold text-[13px] w-16 text-right tabular-nums">
                  {entry.avgBrier.toFixed(3)}
                </span>

                {/* Grade */}
                <span
                  className={`w-5 h-5 flex items-center justify-center text-[9px] font-black border border-white/10 ml-2 rounded ${
                    entry.predictionCount > 0
                      ? `${grade.bg} ${grade.text}`
                      : "bg-white/10 text-white/40"
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
