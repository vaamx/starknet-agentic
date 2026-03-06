"use client";

import TierBadge from "./TierBadge";
import BrierGradeBadge from "./BrierGradeBadge";

interface FleetAgentSummary {
  id: string;
  name: string;
  isBuiltIn: boolean;
  status: string;
  agentType: string;
  model: string;
  walletAddress: string | null;
  balanceStrk: number | null;
  tier: string | null;
  brierScore: number | null;
  brierRank: number | null;
  stats: { predictions: number; bets: number; pnl: string };
  lastActionAt: number | null;
  activeMarkets: number;
  preferredSources: string[];
  biasFactor: number;
  confidence: number;
}

const STATUS_DOT: Record<string, string> = {
  running: "bg-neo-green",
  paused: "bg-neo-yellow",
  stopped: "bg-neo-red",
};

const SOURCE_ICONS: Record<string, { icon: string; color: string }> = {
  polymarket: { icon: "📊", color: "#8b5cf6" },
  coingecko: { icon: "🪙", color: "#f59e0b" },
  news: { icon: "📰", color: "#3b82f6" },
  web: { icon: "🌐", color: "#06b6d4" },
  tavily: { icon: "🔍", color: "#10b981" },
  social: { icon: "💬", color: "#ec4899" },
  espn: { icon: "🏈", color: "#ef4444" },
  github: { icon: "⌨️", color: "#a3a3a3" },
  onchain: { icon: "⛓", color: "#f97316" },
  rss: { icon: "📡", color: "#6366f1" },
  x: { icon: "𝕏", color: "#a3a3a3" },
  telegram: { icon: "✈️", color: "#0ea5e9" },
};

function timeAgo(ts: number | null): string {
  if (!ts) return "never";
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

export default function FleetAgentCard({
  agent,
  onSelect,
  onPause,
  onResume,
  onFund,
}: {
  agent: FleetAgentSummary;
  onSelect: () => void;
  onPause: () => void;
  onResume: () => void;
  onFund: () => void;
}) {
  const pnlWei = BigInt(agent.stats.pnl || "0");
  const pnlStrk = Number(pnlWei) / 1e18;
  const pnlSign = pnlStrk >= 0 ? "+" : "";
  const pnlColor = pnlStrk >= 0 ? "text-neo-green" : "text-neo-red";
  const walletLabel = agent.walletAddress
    ? agent.balanceStrk !== null
      ? `${agent.balanceStrk.toFixed(1)} STRK`
      : "checking balance..."
    : agent.isBuiltIn
      ? "template agent"
      : "wallet required";

  return (
    <div
      className="neo-card-hover group cursor-pointer p-4 transition-all"
      onClick={onSelect}
    >
      {/* Header row */}
      <div className="mb-3 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${STATUS_DOT[agent.status] ?? "bg-white/20"}`}
          />
          <h3 className="font-heading text-sm font-bold text-white">
            {agent.name}
          </h3>
          {agent.isBuiltIn && (
            <span className="neo-badge border border-white/[0.1] bg-white/[0.06] text-[9px] text-muted">
              SYSTEM
            </span>
          )}
        </div>
        <BrierGradeBadge score={agent.brierScore} />
      </div>

      {/* Tier + balance */}
      <div className="mb-3 flex items-center gap-2">
        <TierBadge tier={agent.tier} />
        <span className="font-mono text-xs text-white/70">
          {walletLabel}
        </span>
      </div>

      {/* Balance bar (visual) */}
      {agent.balanceStrk !== null && agent.balanceStrk > 0 && (
        <div className="mb-3 h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className={`h-full rounded-full transition-all ${
              agent.tier === "thriving"
                ? "bg-neo-purple"
                : agent.tier === "healthy"
                  ? "bg-neo-green"
                  : agent.tier === "low"
                    ? "bg-neo-yellow"
                    : "bg-neo-red"
            }`}
            style={{
              width: `${Math.min(100, (agent.balanceStrk / 1000) * 100)}%`,
            }}
          />
        </div>
      )}

      {/* Stats */}
      <div className="mb-3 grid grid-cols-3 gap-2">
        <div>
          <span className="block text-[10px] text-muted">Predictions</span>
          <span className="font-mono text-xs font-bold text-white">
            {agent.stats.predictions}
          </span>
        </div>
        <div>
          <span className="block text-[10px] text-muted">Markets</span>
          <span className="font-mono text-xs font-bold text-white">
            {agent.activeMarkets}
          </span>
        </div>
        <div>
          <span className="block text-[10px] text-muted">P&L</span>
          <span className={`font-mono text-xs font-bold ${pnlColor}`}>
            {pnlSign}{Math.abs(pnlStrk).toFixed(1)}
          </span>
        </div>
      </div>

      {/* Data sources + confidence */}
      {agent.preferredSources.length > 0 && (
        <div className="mb-3 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {agent.preferredSources.slice(0, 6).map((src) => {
              const meta = SOURCE_ICONS[src];
              return (
                <span
                  key={src}
                  className="inline-flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-white/60"
                >
                  {meta && (
                    <span
                      className="inline-block h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: meta.color }}
                    />
                  )}
                  {src}
                </span>
              );
            })}
            {agent.preferredSources.length > 6 && (
              <span className="rounded-md border border-white/[0.06] bg-white/[0.02] px-1.5 py-0.5 text-[9px] text-white/30">
                +{agent.preferredSources.length - 6}
              </span>
            )}
          </div>

          {/* Confidence + bias bar */}
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[9px] text-white/30">Confidence</span>
                <span className="text-[9px] font-mono text-white/50">
                  {Math.round(agent.confidence * 100)}%
                </span>
              </div>
              <div className="h-1 w-full rounded-full bg-white/[0.06] overflow-hidden">
                <div
                  className="h-full rounded-full bg-neo-brand/60 transition-all"
                  style={{ width: `${Math.round(agent.confidence * 100)}%` }}
                />
              </div>
            </div>
            {agent.biasFactor !== 0 && (
              <span
                className={`text-[9px] font-mono ${
                  agent.biasFactor > 0 ? "text-neo-green/70" : "text-neo-red/70"
                }`}
                title="Bias factor"
              >
                {agent.biasFactor > 0 ? "+" : ""}{agent.biasFactor.toFixed(2)} bias
              </span>
            )}
          </div>
        </div>
      )}

      {/* Footer: last action + quick actions */}
      <div className="flex items-center justify-between border-t border-white/[0.05] pt-2">
        <span className="text-[10px] text-muted">
          {timeAgo(agent.lastActionAt)}
        </span>
        <div
          className="flex items-center gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          {!agent.isBuiltIn && agent.walletAddress && (
            <button
              onClick={onFund}
              className="rounded px-2 py-0.5 text-[10px] font-medium text-neo-brand hover:bg-neo-brand/10"
            >
              Fund
            </button>
          )}
          {!agent.isBuiltIn && agent.status === "running" && (
            <button
              onClick={onPause}
              className="rounded px-2 py-0.5 text-[10px] font-medium text-neo-yellow hover:bg-neo-yellow/10"
            >
              Pause
            </button>
          )}
          {!agent.isBuiltIn && agent.status === "paused" && (
            <button
              onClick={onResume}
              className="rounded px-2 py-0.5 text-[10px] font-medium text-neo-green hover:bg-neo-green/10"
            >
              Resume
            </button>
          )}
          <button className="rounded px-2 py-0.5 text-[10px] font-medium text-muted hover:bg-white/[0.05] hover:text-white group-hover:text-white/60">
            Details &rsaquo;
          </button>
        </div>
      </div>
    </div>
  );
}

export type { FleetAgentSummary };
