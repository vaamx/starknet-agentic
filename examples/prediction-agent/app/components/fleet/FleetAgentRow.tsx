"use client";

import TierBadge from "./TierBadge";
import BrierGradeBadge from "./BrierGradeBadge";
import type { FleetAgentSummary } from "./FleetAgentCard";

const STATUS_DOT: Record<string, string> = {
  running: "bg-green-400",
  paused: "bg-yellow-400",
  stopped: "bg-red-400",
};

function timeAgo(ts: number | null): string {
  if (!ts) return "–";
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  return `${Math.floor(secs / 86400)}d`;
}

export default function FleetAgentRow({
  agent,
  onSelect,
  onPause,
  onResume,
}: {
  agent: FleetAgentSummary;
  onSelect: () => void;
  onPause: () => void;
  onResume: () => void;
}) {
  const pnlWei = BigInt(agent.stats.pnl || "0");
  const pnlStrk = Number(pnlWei) / 1e18;
  const pnlColor = pnlStrk >= 0 ? "text-green-400" : "text-red-400";

  return (
    <tr
      className="cursor-pointer border-b border-white/[0.04] transition-colors hover:bg-white/[0.03]"
      onClick={onSelect}
    >
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${STATUS_DOT[agent.status] ?? "bg-white/20"}`}
          />
          <span className="font-heading text-xs font-bold text-white">
            {agent.name}
          </span>
          {agent.isBuiltIn && (
            <span className="neo-badge border border-white/[0.08] bg-white/[0.04] text-[8px] text-muted">
              SYS
            </span>
          )}
        </div>
      </td>
      <td className="px-3 py-2">
        <TierBadge tier={agent.tier} />
      </td>
      <td className="px-3 py-2 font-mono text-xs text-white/70">
        {agent.balanceStrk !== null ? `${agent.balanceStrk.toFixed(1)}` : "–"}
      </td>
      <td className="px-3 py-2">
        <BrierGradeBadge score={agent.brierScore} />
      </td>
      <td className="px-3 py-2 font-mono text-xs text-white/70">
        {agent.stats.predictions}
      </td>
      <td className={`px-3 py-2 font-mono text-xs ${pnlColor}`}>
        {pnlStrk >= 0 ? "+" : ""}{pnlStrk.toFixed(1)}
      </td>
      <td className="px-3 py-2 text-[10px] text-muted">
        {timeAgo(agent.lastActionAt)}
      </td>
      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
        {!agent.isBuiltIn && agent.status === "running" && (
          <button
            onClick={onPause}
            className="rounded px-2 py-0.5 text-[10px] text-yellow-400 hover:bg-yellow-400/10"
          >
            Pause
          </button>
        )}
        {!agent.isBuiltIn && agent.status === "paused" && (
          <button
            onClick={onResume}
            className="rounded px-2 py-0.5 text-[10px] text-green-400 hover:bg-green-400/10"
          >
            Resume
          </button>
        )}
      </td>
    </tr>
  );
}
