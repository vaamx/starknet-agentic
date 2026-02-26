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
        <h3 className="font-heading font-bold text-sm text-white">
          Breaking Markets
        </h3>
      </div>
      <div className="divide-y divide-white/[0.05]">
        {topMarkets.map((market) => {
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

          return (
            <button
              key={market.id}
              type="button"
              onClick={() => onAnalyze(market.id)}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.04] transition-colors text-left"
            >
              <div className="flex-1 min-w-0">
                <p className="text-xs text-white/80 truncate leading-snug">
                  {market.question}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="font-mono text-sm font-bold text-white">
                  {yesPercent}%
                </span>
                {change !== null && change !== 0 && (
                  <span
                    className={`text-xs font-mono font-bold ${
                      change > 0 ? "text-neo-green" : "text-neo-red"
                    }`}
                  >
                    {change > 0 ? "+" : ""}
                    {change}
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
