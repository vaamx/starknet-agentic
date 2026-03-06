"use client";

import { useState, useEffect } from "react";
import TierBadge from "./TierBadge";
import BrierGradeBadge from "./BrierGradeBadge";
import FleetFundForm from "./FleetFundForm";

interface AgentDetail {
  id: string;
  name: string;
  isBuiltIn: boolean;
  status: string;
  agentType: string;
  model: string;
  walletAddress?: string;
  balanceStrk: number | null;
  tier: string | null;
  brierScore?: number | null;
  preferredSources?: string[];
  budget?: {
    totalBudget: string;
    spent: string;
    maxBetSize: string;
    remainingPct: number;
  };
  stats?: { predictions: number; bets: number; pnl: string };
  recentActions?: {
    id: string;
    timestamp: number;
    type: string;
    marketId?: number;
    question?: string;
    detail: string;
    probability?: number;
    betAmount?: string;
    betOutcome?: string;
    txHash?: string;
  }[];
  marketBreakdown?: {
    marketId: number;
    question: string;
    predictions: number;
    bets: number;
  }[];
  agentId?: string;
  createdAt?: number;
}

interface FleetAgentDrawerProps {
  agentId: string;
  open: boolean;
  onClose: () => void;
  onAction: () => void;
}

const ACTION_ICONS: Record<string, string> = {
  prediction: "P",
  bet: "B",
  research: "R",
  resolution: "X",
  debate: "D",
  error: "!",
  market_creation: "+",
};

function timeAgo(ts: number): string {
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

export default function FleetAgentDrawer({
  agentId,
  open,
  onClose,
  onAction,
}: FleetAgentDrawerProps) {
  const [detail, setDetail] = useState<AgentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [showFund, setShowFund] = useState(false);
  const [controlLoading, setControlLoading] = useState(false);

  useEffect(() => {
    if (!open || !agentId) return;
    setLoading(true);
    setShowFund(false);
    fetch(`/api/fleet/${agentId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) setDetail(data.agent);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, agentId]);

  async function handleControl(action: "pause" | "resume" | "stop") {
    setControlLoading(true);
    try {
      const res = await fetch(`/api/fleet/${agentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (data.ok && data.agent) {
        setDetail((prev) =>
          prev ? { ...prev, status: data.agent.status } : prev
        );
        onAction();
      }
    } catch {
      // ignore
    } finally {
      setControlLoading(false);
    }
  }

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-white/[0.07] bg-[#0d111c] shadow-2xl sm:max-w-lg animate-modal-in">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-neo-purple/10 border border-neo-purple/20 flex items-center justify-center">
              <svg className="w-3 h-3 text-neo-purple" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
            </div>
            <h2 className="font-heading text-sm font-bold text-white">
              Agent Detail
            </h2>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg border border-white/15 bg-white/[0.04] px-2.5 py-1.5 text-[12px] font-semibold text-white/60 transition-colors hover:bg-white/[0.09] hover:text-white/80"
          >
            Close
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {loading ? (
            <div className="space-y-3">
              <div className="h-10 rounded-xl bg-white/[0.04] animate-[shimmer_2s_infinite] bg-[length:200%_100%] bg-gradient-to-r from-white/[0.04] via-white/[0.08] to-white/[0.04]" />
              <div className="h-20 rounded-xl bg-white/[0.04] animate-[shimmer_2s_infinite] bg-[length:200%_100%] bg-gradient-to-r from-white/[0.04] via-white/[0.08] to-white/[0.04]" />
              <div className="grid grid-cols-3 gap-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-14 rounded-xl bg-white/[0.04] animate-[shimmer_2s_infinite] bg-[length:200%_100%] bg-gradient-to-r from-white/[0.04] via-white/[0.08] to-white/[0.04]" />
                ))}
              </div>
              <div className="h-6 w-24 rounded-lg bg-white/[0.04] animate-[shimmer_2s_infinite] bg-[length:200%_100%] bg-gradient-to-r from-white/[0.04] via-white/[0.08] to-white/[0.04]" />
              <div className="space-y-1.5">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-8 rounded-lg bg-white/[0.04] animate-[shimmer_2s_infinite] bg-[length:200%_100%] bg-gradient-to-r from-white/[0.04] via-white/[0.08] to-white/[0.04]" />
                ))}
              </div>
            </div>
          ) : detail ? (
            <div className="space-y-5">
              {/* Agent header */}
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-heading text-base font-bold text-white">
                    {detail.name}
                  </h3>
                  <p className="text-[10px] text-muted">
                    {detail.agentType} &middot; {detail.model}
                  </p>
                  {detail.isBuiltIn && (
                    <span className="neo-badge mt-1 border border-white/[0.1] bg-white/[0.06] text-[9px] text-muted">
                      SYSTEM AGENT
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <TierBadge tier={detail.tier} />
                  <BrierGradeBadge score={detail.brierScore ?? null} />
                </div>
              </div>

              {/* Balance */}
              <div className="neo-card p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="block text-[10px] text-muted">
                      Balance
                    </span>
                    <span className="font-heading text-lg font-bold text-white">
                      {detail.balanceStrk !== null
                        ? `${detail.balanceStrk.toFixed(2)} STRK`
                        : "No wallet"}
                    </span>
                  </div>
                  {!detail.isBuiltIn && detail.walletAddress && (
                    <button
                      onClick={() => setShowFund(!showFund)}
                      className="neo-btn-primary text-xs"
                    >
                      {showFund ? "Cancel" : "Fund"}
                    </button>
                  )}
                </div>
                {detail.walletAddress && (
                  <p className="mt-1 truncate font-mono text-[10px] text-muted">
                    {detail.walletAddress}
                  </p>
                )}
                {showFund && (
                  <div className="mt-3 border-t border-white/[0.07] pt-3">
                    <FleetFundForm
                      agentId={agentId}
                      agentName={detail.name}
                      currentBalance={detail.balanceStrk}
                      onSuccess={() => {
                        setShowFund(false);
                        onAction();
                      }}
                      onCancel={() => setShowFund(false)}
                    />
                  </div>
                )}
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-3 gap-2">
                <div className="neo-card p-2 text-center">
                  <span className="block text-[10px] text-muted">Predictions</span>
                  <span className="font-mono text-sm font-bold text-white">
                    {detail.stats?.predictions ?? 0}
                  </span>
                </div>
                <div className="neo-card p-2 text-center">
                  <span className="block text-[10px] text-muted">Bets</span>
                  <span className="font-mono text-sm font-bold text-white">
                    {detail.stats?.bets ?? 0}
                  </span>
                </div>
                <div className="neo-card p-2 text-center">
                  <span className="block text-[10px] text-muted">P&L</span>
                  <span className="font-mono text-sm font-bold text-white">
                    {detail.stats
                      ? `${(Number(BigInt(detail.stats.pnl || "0")) / 1e18).toFixed(1)}`
                      : "0"}
                  </span>
                </div>
              </div>

              {/* Preferred sources */}
              {detail.preferredSources && detail.preferredSources.length > 0 && (() => {
                const SOURCE_COLORS: Record<string, string> = {
                  polymarket: "bg-[#8b5cf6]",
                  coingecko: "bg-[#f59e0b]",
                  news: "bg-[#3b82f6]",
                  social: "bg-[#ec4899]",
                  tavily: "bg-[#06b6d4]",
                  espn: "bg-[#ef4444]",
                };
                return (
                  <div>
                    <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                      Data Sources
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {detail.preferredSources.map((src) => (
                        <span
                          key={src}
                          className="inline-flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/60"
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${SOURCE_COLORS[src] ?? "bg-white/30"}`} />
                          {src}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Controls */}
              {!detail.isBuiltIn && (
                <div className="flex gap-2">
                  {detail.status === "running" && (
                    <button
                      onClick={() => handleControl("pause")}
                      disabled={controlLoading}
                      className="flex-1 rounded-xl border border-neo-yellow/30 bg-neo-yellow/10 px-3 py-2 text-xs font-semibold text-neo-yellow transition-colors hover:bg-neo-yellow/20 disabled:opacity-40"
                    >
                      Pause
                    </button>
                  )}
                  {detail.status === "paused" && (
                    <button
                      onClick={() => handleControl("resume")}
                      disabled={controlLoading}
                      className="flex-1 rounded-xl border border-neo-green/30 bg-neo-green/10 px-3 py-2 text-xs font-semibold text-neo-green transition-colors hover:bg-neo-green/20 disabled:opacity-40"
                    >
                      Resume
                    </button>
                  )}
                  {detail.status !== "stopped" && (
                    <button
                      onClick={() => handleControl("stop")}
                      disabled={controlLoading}
                      className="flex-1 rounded-xl border border-neo-red/30 bg-neo-red/10 px-3 py-2 text-xs font-semibold text-neo-red transition-colors hover:bg-neo-red/20 disabled:opacity-40"
                    >
                      Stop
                    </button>
                  )}
                </div>
              )}

              {/* Market breakdown */}
              {detail.marketBreakdown && detail.marketBreakdown.length > 0 && (
                <div>
                  <h4 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted">
                    Market Activity
                  </h4>
                  <div className="space-y-1">
                    {detail.marketBreakdown.map((m) => (
                      <div
                        key={m.marketId}
                        className="flex items-center justify-between rounded-md bg-white/[0.03] px-2 py-1.5"
                      >
                        <span className="max-w-[200px] truncate text-[10px] text-white/70">
                          {m.question}
                        </span>
                        <span className="text-[10px] text-muted">
                          {m.predictions}P / {m.bets}B
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recent actions timeline */}
              {detail.recentActions && detail.recentActions.length > 0 && (
                <div>
                  <h4 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted">
                    Recent Actions
                  </h4>
                  <div className="space-y-1">
                    {detail.recentActions
                      .slice()
                      .reverse()
                      .slice(0, 20)
                      .map((action) => (
                        <div
                          key={action.id}
                          className="flex items-start gap-2 rounded-md bg-white/[0.02] px-2 py-1.5"
                        >
                          <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded bg-white/[0.08] text-[8px] font-bold text-muted">
                            {ACTION_ICONS[action.type] ?? "?"}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[10px] text-white/70">
                              {action.detail}
                            </p>
                            <div className="flex items-center gap-2 text-[9px] text-muted">
                              <span>{timeAgo(action.timestamp)}</span>
                              {action.probability !== undefined && (
                                <span>{(action.probability * 100).toFixed(0)}%</span>
                              )}
                              {action.betAmount && (
                                <span>{action.betAmount} STRK</span>
                              )}
                              {action.txHash && (
                                <a
                                  href={`https://sepolia.starkscan.co/tx/${action.txHash}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-neo-brand hover:underline"
                                >
                                  tx
                                </a>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted">Agent not found.</p>
          )}
        </div>
      </div>
    </>
  );
}
