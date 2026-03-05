"use client";

import Link from "next/link";
import { categorizeMarket } from "@/lib/categories";
import { safeBigInt } from "./dashboard/utils";
import type { AgentPrediction, LatestAgentTake, Market } from "./dashboard/types";

interface MarketRowProps {
  market: Market;
  predictions?: AgentPrediction[];
  weightedProb?: number | null;
  latestTake?: LatestAgentTake | null;
  onBet: (marketId: number, outcome?: 0 | 1) => void;
}

const CAT_STYLE: Record<string, string> = {
  sports: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  crypto: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  politics: "bg-rose-500/10 text-rose-400 border-rose-500/20",
  tech: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  other: "bg-amber-500/10 text-amber-400 border-amber-500/20",
};

function formatVolume(poolWei: bigint): string {
  const whole = poolWei / 10n ** 18n;
  const num = Number(whole);
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(1)}K`;
  if (num > 0) return `${num} STRK`;
  return "—";
}

function formatTimeLeft(resolutionTime: number): { label: string; urgent: boolean } {
  const secsLeft = resolutionTime - Date.now() / 1000;
  if (secsLeft <= 0) return { label: "Ended", urgent: true };
  const days = Math.floor(secsLeft / 86400);
  const hours = Math.floor(secsLeft / 3600);
  if (days > 30) return { label: `${Math.floor(days / 30)}mo`, urgent: false };
  if (days > 0) return { label: `${days}d`, urgent: days <= 3 };
  if (hours > 0) return { label: `${hours}h`, urgent: true };
  return { label: `${Math.floor(secsLeft / 60)}m`, urgent: true };
}

export default function MarketRow({
  market,
  predictions = [],
  weightedProb,
  onBet,
}: MarketRowProps) {
  const yesPct = Math.round(market.impliedProbYes * 100);
  const noPct = 100 - yesPct;
  const yesCents = (market.impliedProbYes * 100).toFixed(1);
  const noCents = ((1 - market.impliedProbYes) * 100).toFixed(1);

  const poolWei = safeBigInt(market.totalPool);
  const volume = formatVolume(poolWei);
  const time = formatTimeLeft(market.resolutionTime);
  const isExpired = time.label === "Ended";

  const category = categorizeMarket(market.question);
  const catStyle = CAT_STYLE[category] ?? CAT_STYLE.other;

  const aiProb =
    typeof weightedProb === "number" ? Math.round(weightedProb * 100) : null;

  return (
    <Link
      href={`/market/${market.id}`}
      className="group block no-underline animate-card-enter"
    >
      <div className="flex items-center gap-4 px-4 lg:px-5 py-4 rounded-xl border border-transparent hover:border-white/[0.06] hover:bg-white/[0.02] transition-all duration-150">
        {/* Market info — question + category */}
        <div className="flex-1 min-w-0">
          <h3 className="font-heading text-[14px] font-semibold leading-snug text-white/90 group-hover:text-white transition-colors truncate">
            {market.question}
          </h3>
          <div className="flex items-center gap-2 mt-1.5">
            <span
              className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${catStyle}`}
            >
              {category}
            </span>
            {aiProb !== null && predictions.length > 0 && (
              <span className="text-[11px] text-white/30 font-mono">
                AI&nbsp;{aiProb}%
              </span>
            )}
          </div>
        </div>

        {/* Yes price + bar */}
        <div className="w-[88px] shrink-0 text-right">
          {!isExpired ? (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onBet(market.id, 1);
              }}
              className="w-full group/yes"
            >
              <span className="block text-[15px] font-heading font-bold text-emerald-400 tabular-nums group-hover/yes:text-emerald-300 transition-colors">
                {yesCents}¢
              </span>
              <div className="mt-1 h-[3px] rounded-full bg-white/[0.04] overflow-hidden">
                <div
                  className="h-full rounded-full bg-emerald-500 prob-fill-yes"
                  style={{ width: `${yesPct}%` }}
                />
              </div>
            </button>
          ) : (
            <span className="text-[13px] text-white/20">—</span>
          )}
        </div>

        {/* No price + bar */}
        <div className="w-[88px] shrink-0 text-right">
          {!isExpired ? (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onBet(market.id, 0);
              }}
              className="w-full group/no"
            >
              <span className="block text-[15px] font-heading font-bold text-red-400 tabular-nums group-hover/no:text-red-300 transition-colors">
                {noCents}¢
              </span>
              <div className="mt-1 h-[3px] rounded-full bg-white/[0.04] overflow-hidden">
                <div
                  className="h-full rounded-full bg-red-500"
                  style={{ width: `${noPct}%` }}
                />
              </div>
            </button>
          ) : (
            <span className="text-[13px] text-orange-400/70">Ended</span>
          )}
        </div>

        {/* Volume */}
        <div className="hidden sm:block w-[80px] shrink-0 text-right">
          <span className="text-[13px] font-mono text-white/25 tabular-nums">
            {volume}
          </span>
        </div>

        {/* Time to end */}
        <div className="hidden md:block w-[48px] shrink-0 text-right">
          <span
            className={`text-[13px] font-mono tabular-nums ${
              time.urgent ? "text-orange-400/70" : "text-white/20"
            }`}
          >
            {time.label}
          </span>
        </div>

        {/* Arrow */}
        <svg
          className="w-3.5 h-3.5 text-white/10 group-hover:text-white/25 transition-colors shrink-0 hidden lg:block"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
      </div>
    </Link>
  );
}
