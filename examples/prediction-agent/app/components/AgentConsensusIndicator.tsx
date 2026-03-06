"use client";

interface AgentConsensusIndicatorProps {
  consensusPercent: number;
  agentCount: number;
  edge: number;
  onMore?: () => void;
}

export default function AgentConsensusIndicator({
  consensusPercent,
  agentCount,
  edge,
  onMore,
}: AgentConsensusIndicatorProps) {
  return (
    <div className="flex items-center gap-2 text-xs text-white/60">
      <span className="w-4 h-4 bg-neo-purple/15 border border-neo-purple/25 rounded flex items-center justify-center text-[8px] font-black text-neo-purple">
        AI
      </span>
      <span className="font-medium text-white/70">
        Hive consensus:{" "}
        <span className="font-mono font-bold text-neo-blue">{consensusPercent}%</span>
      </span>
      {edge > 5 && (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-neo-yellow/10 border border-neo-yellow/25 rounded-md text-neo-yellow text-[10px] font-mono font-bold">
          <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25" />
          </svg>
          {edge}pt
        </span>
      )}
      <span className="text-[10px] text-white/35 font-mono">
        {agentCount} agent{agentCount !== 1 ? "s" : ""}
      </span>
      {onMore && (
        <button
          type="button"
          onClick={onMore}
          className="text-[10px] font-semibold text-neo-blue/80 hover:text-neo-blue transition-colors"
        >
          details →
        </button>
      )}
    </div>
  );
}
