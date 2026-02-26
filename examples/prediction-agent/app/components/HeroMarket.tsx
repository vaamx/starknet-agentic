"use client";

import Link from "next/link";
import { categorizeMarket } from "@/lib/categories";
import { getAgentVoiceByName } from "@/lib/agent-voices";
import type { AgentPrediction, LatestAgentTake, Market } from "./dashboard/types";
import { computeDisagreement, safeBigInt } from "./dashboard/utils";
import QuickTradeButtons from "./QuickTradeButtons";
import AgentConsensusIndicator from "./AgentConsensusIndicator";

interface HeroMarketProps {
  market: Market;
  predictions: AgentPrediction[];
  weightedProb: number | null;
  latestTake: LatestAgentTake | null;
  onAnalyze: (marketId: number) => void;
  onBet: (marketId: number, outcome?: 0 | 1) => void;
}

export default function HeroMarket({
  market,
  predictions,
  weightedProb,
  latestTake,
  onAnalyze,
  onBet,
}: HeroMarketProps) {
  const yesPercent = Math.round(market.impliedProbYes * 100);
  const noPercent = 100 - yesPercent;
  const category = categorizeMarket(market.question);

  const agentConsensus =
    predictions.length > 0
      ? predictions.reduce((sum, p) => sum + p.predictedProb, 0) / predictions.length
      : null;
  const consensusPercent = agentConsensus ? Math.round(agentConsensus * 100) : null;

  const consensusBase =
    typeof weightedProb === "number"
      ? weightedProb
      : agentConsensus ?? market.impliedProbYes;
  const edge = consensusPercent !== null ? Math.abs(yesPercent - consensusPercent) : 0;

  const poolWei = safeBigInt(market.totalPool);
  const poolDisplay = (poolWei / 10n ** 18n).toString();

  const now = Date.now() / 1000;
  const daysLeft = Math.max(0, Math.floor((market.resolutionTime - now) / 86400));
  const hoursLeft = Math.max(0, Math.floor((market.resolutionTime - now) / 3600));

  const voice = getAgentVoiceByName(latestTake?.agentName);
  const disagreement = computeDisagreement(predictions);

  return (
    <div className="neo-card overflow-hidden border-neo-brand/20 bg-gradient-to-br from-white/[0.05] to-white/[0.02]">
      <div className="p-5 sm:p-6">
        {/* Top row: category + badges */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs font-medium text-neo-brand/80 uppercase tracking-wider">
            {category}
          </span>
          <span className="text-xs text-white/30">|</span>
          <span className="text-xs text-white/40">
            {daysLeft > 0 ? `${daysLeft}d left` : hoursLeft > 0 ? `${hoursLeft}h left` : "Closing"}
          </span>
          {disagreement > 0.15 && (
            <span className="text-xs text-neo-orange">Contested</span>
          )}
          {(market.tradeCount ?? 0) > 3 && (
            <span className="text-xs text-neo-yellow">Hot</span>
          )}
        </div>

        {/* Question */}
        <h2 className="font-heading font-bold text-lg sm:text-xl text-white leading-snug text-balance mb-4">
          <Link href={`/market/${market.id}`} className="hover:text-neo-brand transition-colors">
            {market.question}
          </Link>
        </h2>

        {/* Trade buttons */}
        <div className="mb-4">
          <QuickTradeButtons
            yesPercent={yesPercent}
            noPercent={noPercent}
            volume={poolDisplay}
            onYes={() => onBet(market.id, 1)}
            onNo={() => onBet(market.id, 0)}
          />
        </div>

        {/* Agent consensus */}
        {consensusPercent !== null && (
          <div className="mb-4">
            <AgentConsensusIndicator
              consensusPercent={consensusPercent}
              agentCount={predictions.length}
              edge={edge}
              onMore={() => onAnalyze(market.id)}
            />
          </div>
        )}

        {/* Latest agent reasoning */}
        {latestTake?.reasoning && (
          <div className="border-t border-white/[0.07] pt-3">
            <div className="flex items-center gap-2 mb-1.5">
              <span className={`text-xs font-mono ${voice?.colorClass ?? "text-neo-blue"}`}>
                {latestTake.agentName}
              </span>
              {voice && (
                <span className="text-xs text-white/40">{voice.signature}</span>
              )}
            </div>
            <p className="text-sm text-white/60 line-clamp-2 leading-relaxed">
              &ldquo;{latestTake.reasoning}&rdquo;
            </p>
          </div>
        )}

        {/* Bottom stats + actions */}
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-white/[0.07]">
          <div className="flex items-center gap-4 text-xs text-white/40">
            <span className="font-mono">{poolDisplay} STRK</span>
            {typeof market.tradeCount === "number" && market.tradeCount > 0 && (
              <span>{market.tradeCount} trades</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => onAnalyze(market.id)}
            className="text-xs font-medium text-neo-brand hover:text-neo-brand/80 transition-colors"
          >
            Full Analysis
          </button>
        </div>
      </div>
    </div>
  );
}
