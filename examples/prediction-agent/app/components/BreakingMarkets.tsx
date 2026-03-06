"use client";

import type { AgentPrediction, Market } from "./dashboard/types";
import { safeBigInt } from "./dashboard/utils";

interface BreakingMarketsProps {
  markets: Market[];
  predictions: Record<number, AgentPrediction[]>;
  onAnalyze: (marketId: number) => void;
  onBet: (marketId: number) => void;
}

export default function BreakingMarkets({
  markets,
  predictions,
  onAnalyze,
  onBet,
}: BreakingMarketsProps) {
  // Take top 5 by volume
  const topMarkets = [...markets]
    .sort((a, b) => {
      const poolA = safeBigInt(a.totalPool);
      const poolB = safeBigInt(b.totalPool);
      if (poolA === poolB) return 0;
      return poolB > poolA ? 1 : -1;
    })
    .slice(0, 5);

  if (topMarkets.length === 0) return null;

  return (
    <div className="neo-card overflow-hidden">
      <div className="px-4 py-3 border-b border-white/[0.07] bg-white/[0.03]">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-md bg-neo-orange/10 border border-neo-orange/20 flex items-center justify-center">
            <svg className="w-2.5 h-2.5 text-neo-orange" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
            </svg>
          </div>
          <h3 className="font-heading font-bold text-sm text-white">
            Breaking Markets
          </h3>
        </div>
      </div>
      <div className="divide-y divide-white/[0.05]">
        {topMarkets.map((market, idx) => {
          const yesPercent = Math.round(market.impliedProbYes * 100);
          const preds = predictions[market.id] ?? [];
          const agentConsensus =
            preds.length > 0
              ? Math.round(
                  (preds.reduce((sum, p) => sum + p.predictedProb, 0) / preds.length) * 100
                )
              : null;
          const change =
            agentConsensus !== null ? agentConsensus - yesPercent : null;
          const rankColors = [
            "bg-neo-yellow/15 text-neo-yellow border-neo-yellow/25",
            "bg-white/[0.06] text-white/60 border-white/[0.1]",
            "bg-white/[0.04] text-white/45 border-white/[0.08]",
            "bg-white/[0.04] text-white/40 border-white/[0.06]",
            "bg-white/[0.04] text-white/35 border-white/[0.06]",
          ];

          return (
            <button
              key={market.id}
              type="button"
              onClick={() => onAnalyze(market.id)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.04] transition-colors text-left"
            >
              <span className={`w-5 h-5 rounded-md border text-[10px] font-bold flex items-center justify-center shrink-0 ${rankColors[idx] ?? rankColors[4]}`}>
                {idx + 1}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-white/80 truncate leading-snug">
                  {market.question}
                </p>
                <div className="mt-1.5 h-1 w-full rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-neo-green to-neo-green/60"
                    style={{ width: `${yesPercent}%` }}
                  />
                </div>
              </div>
              <div className="flex flex-col items-end gap-0.5 shrink-0">
                <span className="font-mono text-sm font-bold text-white">
                  {yesPercent}%
                </span>
                {change !== null && change !== 0 && (
                  <span
                    className={`text-[10px] font-mono font-bold ${
                      change > 0 ? "text-neo-green" : "text-neo-red"
                    }`}
                  >
                    {change > 0 ? "↑" : "↓"}{Math.abs(change)}pt
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
