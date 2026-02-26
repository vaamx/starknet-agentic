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
      <span className="w-4 h-4 bg-neo-blue/20 border border-neo-blue/30 rounded flex items-center justify-center text-[9px] font-bold text-neo-blue">
        AI
      </span>
      <span className="font-medium">
        Hive:{" "}
        <span className="font-mono font-bold text-neo-blue">{consensusPercent}%</span>
      </span>
      {edge > 5 && (
        <span className="px-1.5 py-0.5 bg-neo-yellow/15 border border-neo-yellow/30 rounded text-neo-yellow text-xs font-mono font-bold">
          {edge}pt edge
        </span>
      )}
      <span className="text-white/40">
        {agentCount} agent{agentCount !== 1 ? "s" : ""}
      </span>
      {onMore && (
        <button
          type="button"
          onClick={onMore}
          className="text-neo-blue text-xs font-mono hover:underline"
        >
          more
        </button>
      )}
    </div>
  );
}
