"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useAccount } from "@starknet-react/core";
import { buildResolveCalls, buildFinalizeCalls } from "@/lib/contracts";
import { getAgentVoiceByName } from "@/lib/agent-voices";
import QuickTradeButtons from "./QuickTradeButtons";
import AgentConsensusIndicator from "./AgentConsensusIndicator";
import { computeDisagreement } from "./dashboard/utils";
import type { AgentPrediction } from "./dashboard/types";

interface MarketCardProps {
  id: number;
  question: string;
  address: string;
  oracle: string;
  impliedProbYes: number;
  impliedProbNo: number;
  totalPool: string;
  status: number;
  resolutionTime: number;
  agentConsensus?: number;
  weightedProb?: number | null;
  tradeCount?: number;
  category?: string;
  latestAgentTake?: {
    agentName: string;
    probability: number;
    reasoning: string;
    timestamp: number;
  } | null;
  predictions?: AgentPrediction[];
  onAnalyze: (marketId: number) => void;
  onBet: (marketId: number, outcome?: 0 | 1) => void;
}

export default function MarketCard({
  id,
  question,
  address: marketAddress,
  oracle,
  impliedProbYes,
  totalPool,
  status,
  resolutionTime,
  agentConsensus,
  weightedProb,
  tradeCount,
  category,
  latestAgentTake,
  predictions = [],
  onAnalyze,
  onBet,
}: MarketCardProps) {
  const { address: connectedAddress, isConnected, account } = useAccount();
  const [resolving, setResolving] = useState(false);
  const [resolveResult, setResolveResult] = useState<string | null>(null);

  const yesPercent = Math.round(impliedProbYes * 100);
  const noPercent = 100 - yesPercent;

  const consensusPercent = agentConsensus
    ? Math.round(agentConsensus * 100)
    : null;
  const consensusBase =
    typeof weightedProb === "number"
      ? weightedProb
      : agentConsensus ?? impliedProbYes;
  const edge =
    consensusPercent !== null
      ? Math.abs(yesPercent - consensusPercent)
      : 0;

  const now = Date.now() / 1000;
  const daysLeft = Math.max(0, Math.floor((resolutionTime - now) / 86400));
  const hoursLeft = Math.max(0, Math.floor((resolutionTime - now) / 3600));
  const isExpired = resolutionTime <= now;

  const poolWei = safeBigInt(totalPool);
  const poolDisplay = (poolWei / 10n ** 18n).toString();

  const statusLabel = status === 0
    ? (isExpired ? "PENDING" : "LIVE")
    : (["LIVE", "CLOSED", "RESOLVED"][status] ?? "???");
  const statusColor =
    status === 0
      ? isExpired
        ? "bg-neo-orange/15 text-neo-orange border-neo-orange/30"
        : "bg-neo-green/15 text-neo-green border-neo-green/30"
      : status === 2
        ? "bg-neo-purple/15 text-neo-purple border-neo-purple/30"
        : "bg-neo-yellow/15 text-neo-yellow border-neo-yellow/30";

  const disagreement = computeDisagreement(predictions);
  const isHot = (tradeCount ?? 0) > 3;
  const isClosingSoon = !isExpired && daysLeft === 0 && hoursLeft < 24;
  const isContested = disagreement > 0.15;

  const latestVoice = getAgentVoiceByName(latestAgentTake?.agentName);

  const isOracle =
    isConnected &&
    connectedAddress &&
    oracle &&
    connectedAddress.toLowerCase() === oracle.toLowerCase();

  const handleResolve = async (outcome: 0 | 1) => {
    if (!account) return;
    setResolveResult(null);
    setResolving(true);
    try {
      const resolveCalls = buildResolveCalls(marketAddress, outcome);
      const finalizeCalls = buildFinalizeCalls(id, outcome);
      const allCalls = [...resolveCalls, ...finalizeCalls];
      const response = await account.execute(allCalls);
      setResolveResult(
        `Resolved as ${outcome === 1 ? "YES" : "NO"} - tx: ${response.transaction_hash.slice(0, 16)}...`
      );
    } catch (err: any) {
      setResolveResult(`Error: ${err.message}`);
    } finally {
      setResolving(false);
    }
  };

  return (
    <div
      className="market-card group"
      data-category={category ?? "other"}
    >
      <div className="p-4">
        {/* Top row: status + category + badges + time */}
        <div className="flex items-center gap-1.5 mb-2.5 flex-wrap">
          <span className={`neo-badge text-xs py-0.5 px-2 ${statusColor}`}>
            {statusLabel}
          </span>
          {category && (
            <span className="text-xs text-white/40 uppercase font-medium">
              {category}
            </span>
          )}
          <span className="text-xs text-white/30 ml-auto">
            {isExpired
              ? "Expired"
              : isClosingSoon
                ? `${hoursLeft}h left`
                : `${daysLeft}d left`}
          </span>
        </div>

        {/* Gamification badges */}
        {(isHot || isContested || isClosingSoon) && (
          <div className="flex items-center gap-1.5 mb-2">
            {isHot && (
              <span className="text-xs px-1.5 py-0.5 bg-neo-yellow/10 border border-neo-yellow/20 rounded text-neo-yellow font-medium">
                Hot
              </span>
            )}
            {isContested && (
              <span className="text-xs px-1.5 py-0.5 bg-neo-orange/10 border border-neo-orange/20 rounded text-neo-orange font-medium">
                Contested
              </span>
            )}
            {isClosingSoon && (
              <span className="text-xs px-1.5 py-0.5 bg-neo-red/10 border border-neo-red/20 rounded text-neo-red font-medium">
                Closing Soon
              </span>
            )}
          </div>
        )}

        {/* Question */}
        <h3 className="font-heading font-semibold text-sm sm:text-[15px] leading-snug text-balance text-white mb-3">
          <Link href={`/market/${id}`} className="hover:text-neo-brand transition-colors inline-flex items-center gap-1.5">
            {question}
            <svg className="w-3.5 h-3.5 shrink-0 text-white/20 group-hover:text-neo-brand/60 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          </Link>
        </h3>

        {/* Quick trade buttons */}
        {status === 0 && !isExpired && (
          <div className="mb-3">
            <QuickTradeButtons
              yesPercent={yesPercent}
              noPercent={noPercent}
              volume={poolDisplay}
              onYes={() => onBet(id, 1)}
              onNo={() => onBet(id, 0)}
            />
          </div>
        )}

        {/* Agent consensus */}
        {consensusPercent !== null && predictions.length > 0 && (
          <div className="mb-3">
            <AgentConsensusIndicator
              consensusPercent={consensusPercent}
              agentCount={predictions.length}
              edge={edge}
              onMore={() => onAnalyze(id)}
            />
          </div>
        )}

        {/* Latest agent one-liner */}
        {latestAgentTake?.reasoning && (
          <div className="text-xs text-white/50 line-clamp-1 mb-3">
            <span className={`font-mono ${latestVoice?.colorClass ?? "text-neo-blue"}`}>
              {latestAgentTake.agentName}:
            </span>{" "}
            {latestAgentTake.reasoning}
          </div>
        )}

        {/* Bottom: volume + analyze link */}
        <div className="flex items-center justify-between pt-2 border-t border-white/[0.05]">
          <div className="flex items-center gap-3 text-xs text-white/35">
            <span className="font-mono">{poolDisplay} STRK</span>
            {typeof tradeCount === "number" && tradeCount > 0 && (
              <span>{tradeCount} trades</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => onAnalyze(id)}
            className="text-xs text-neo-brand/70 hover:text-neo-brand font-medium transition-colors"
          >
            Analyze
          </button>
        </div>

        {/* Resolve buttons for expired, unresolved markets */}
        {status === 0 && isExpired && (
          <div className="mt-3 pt-3 border-t border-white/[0.05] space-y-2">
            {isOracle ? (
              <>
                <p className="text-xs font-mono text-neo-orange font-medium">
                  Resolution pending - you are the oracle
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleResolve(1)}
                    disabled={resolving}
                    className="flex-1 text-sm py-2 rounded-lg border border-neo-green/30 bg-neo-green/10 text-neo-green font-semibold hover:bg-neo-green/20 transition-colors disabled:opacity-50"
                  >
                    {resolving ? "..." : "Resolve YES"}
                  </button>
                  <button
                    onClick={() => handleResolve(0)}
                    disabled={resolving}
                    className="flex-1 text-sm py-2 rounded-lg border border-neo-red/30 bg-neo-red/10 text-neo-red font-semibold hover:bg-neo-red/20 transition-colors disabled:opacity-50"
                  >
                    {resolving ? "..." : "Resolve NO"}
                  </button>
                </div>
              </>
            ) : (
              <p className="text-xs font-mono text-white/40">
                Resolution pending - waiting for oracle
              </p>
            )}
            {resolveResult && (
              <p
                className={`text-xs font-mono ${
                  resolveResult.startsWith("Error") ? "text-neo-red" : "text-neo-green"
                }`}
              >
                {resolveResult}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function safeBigInt(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}
