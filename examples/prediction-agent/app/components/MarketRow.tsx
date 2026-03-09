"use client";

import Link from "next/link";
import { categorizeMarket } from "@/lib/categories";
import { safeBigInt } from "./dashboard/utils";
import type { AgentPrediction, LatestAgentTake, Market } from "./dashboard/types";

export type SortField = "market" | "category" | "yes" | "no" | "volume" | "ends";
export type SortDir = "asc" | "desc";

interface MarketRowProps {
  market: Market;
  predictions?: AgentPrediction[];
  weightedProb?: number | null;
  latestTake?: LatestAgentTake | null;
  onBet: (marketId: number, outcome?: 0 | 1) => void;
}

const CAT_STYLE: Record<string, { bg: string; text: string; border: string }> = {
  sports:      { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/20" },
  crypto:      { bg: "bg-amber-500/10",   text: "text-amber-400",   border: "border-amber-500/20" },
  politics:    { bg: "bg-indigo-500/10",   text: "text-indigo-400",  border: "border-indigo-500/20" },
  elections:   { bg: "bg-rose-500/10",     text: "text-rose-400",    border: "border-rose-500/20" },
  geopolitics: { bg: "bg-red-500/10",      text: "text-red-400",     border: "border-red-500/20" },
  tech:        { bg: "bg-violet-500/10",   text: "text-violet-400",  border: "border-violet-500/20" },
  finance:     { bg: "bg-sky-500/10",      text: "text-sky-400",     border: "border-sky-500/20" },
  earnings:    { bg: "bg-teal-500/10",     text: "text-teal-400",    border: "border-teal-500/20" },
  economy:     { bg: "bg-cyan-500/10",     text: "text-cyan-400",    border: "border-cyan-500/20" },
  culture:     { bg: "bg-pink-500/10",     text: "text-pink-400",    border: "border-pink-500/20" },
  world:       { bg: "bg-fuchsia-500/10",  text: "text-fuchsia-400", border: "border-fuchsia-500/20" },
  climate:     { bg: "bg-lime-500/10",     text: "text-lime-400",    border: "border-lime-500/20" },
  other:       { bg: "bg-orange-500/10",   text: "text-orange-400",  border: "border-orange-500/20" },
};

export function formatVolume(poolWei: bigint): string {
  const whole = poolWei / 10n ** 18n;
  const num = Number(whole);
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(1)}K`;
  if (num > 0) return `${num} STRK`;
  return "—";
}

export function formatTimeLeft(resolutionTime: number): { label: string; urgent: boolean } {
  const secsLeft = resolutionTime - Date.now() / 1000;
  if (secsLeft <= 0) return { label: "Ended", urgent: true };
  const days = Math.floor(secsLeft / 86400);
  const hours = Math.floor(secsLeft / 3600);
  if (days > 30) return { label: `${Math.floor(days / 30)}mo`, urgent: false };
  if (days > 0) return { label: `${days}d`, urgent: days <= 3 };
  if (hours > 0) return { label: `${hours}h`, urgent: true };
  return { label: `${Math.floor(secsLeft / 60)}m`, urgent: true };
}

/** Sortable column header for table view */
export function SortableHeader({
  label,
  field,
  activeField,
  activeDir,
  onSort,
  align = "left",
  className = "",
  colorClass,
}: {
  label: string;
  field: SortField;
  activeField: SortField;
  activeDir: SortDir;
  onSort: (field: SortField) => void;
  align?: "left" | "right";
  className?: string;
  colorClass?: string;
}) {
  const isActive = activeField === field;
  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider transition-colors ${
        align === "right" ? "ml-auto flex-row-reverse" : ""
      } ${isActive ? (colorClass ?? "text-white/60") : (colorClass ?? "text-white/25")} hover:text-white/50 ${className}`}
    >
      {label}
      <svg className={`w-3 h-3 shrink-0 transition-transform ${isActive ? "opacity-100" : "opacity-0"} ${isActive && activeDir === "asc" ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
      </svg>
    </button>
  );
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
  const isResolved = market.status === 2;
  const time = formatTimeLeft(market.resolutionTime);
  const isExpired = time.label === "Ended" || isResolved;
  const winOutcome = market.winningOutcome;
  const winLabel = isResolved ? (winOutcome === 1 ? "YES Won" : winOutcome === 0 ? "NO Won" : "Resolved") : null;

  const category = categorizeMarket(market.question);
  const cs = CAT_STYLE[category] ?? CAT_STYLE.other;

  const aiProb =
    typeof weightedProb === "number" ? Math.round(weightedProb * 100) : null;

  return (
    <Link
      href={`/market/${market.id}`}
      className="group block no-underline animate-card-enter"
    >
      <div className="flex items-center gap-4 px-4 lg:px-5 py-3.5 rounded-xl border border-transparent hover:border-white/[0.06] hover:bg-white/[0.02] transition-all duration-150">
        {/* Market info — question + category */}
        <div className="flex-1 min-w-0">
          <h3 className="font-heading text-[14px] font-semibold leading-snug text-white/90 group-hover:text-white transition-colors truncate">
            {market.question}
          </h3>
          <div className="flex items-center gap-2 mt-1">
            <span
              className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${cs.bg} ${cs.text} ${cs.border}`}
            >
              {category}
            </span>
            {isResolved && winLabel && (
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                winOutcome === 1
                  ? "bg-neo-green/[0.06] text-neo-green border-neo-green/20"
                  : winOutcome === 0
                    ? "bg-neo-red/[0.06] text-neo-red border-neo-red/20"
                    : "bg-sky-400/[0.06] text-sky-300 border-sky-300/20"
              }`}>
                {winLabel}
              </span>
            )}
            {aiProb !== null && predictions.length > 0 && (
              <span className="text-[11px] text-white/30 font-mono">
                AI&nbsp;{aiProb}%
              </span>
            )}
          </div>
        </div>

        {/* Yes price + bar */}
        <div className="w-[80px] shrink-0 text-right">
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
              <span className="block text-[15px] font-heading font-bold text-neo-green tabular-nums group-hover/yes:text-neo-green/80 transition-colors">
                {yesCents}¢
              </span>
              <div className="mt-1 h-[3px] rounded-full bg-white/[0.04] overflow-hidden">
                <div
                  className="h-full rounded-full bg-neo-green"
                  style={{ width: `${yesPct}%` }}
                />
              </div>
            </button>
          ) : (
            <span className="text-[13px] text-white/20">—</span>
          )}
        </div>

        {/* No price + bar */}
        <div className="w-[80px] shrink-0 text-right">
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
              <span className="block text-[15px] font-heading font-bold text-neo-red tabular-nums group-hover/no:text-neo-red/80 transition-colors">
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
            <span className={`text-[13px] ${
              isResolved
                ? winOutcome === 1 ? "text-neo-green/70" : winOutcome === 0 ? "text-neo-red/70" : "text-sky-300/70"
                : "text-orange-400/70"
            }`}>
              {winLabel ?? "Ended"}
            </span>
          )}
        </div>

        {/* Volume */}
        <div className="hidden sm:block w-[80px] shrink-0 text-right">
          <span className="text-[13px] font-mono text-white/30 tabular-nums">
            {volume}
          </span>
        </div>

        {/* Time to end */}
        <div className="hidden md:block w-[56px] shrink-0 text-right">
          <span
            className={`text-[13px] font-mono tabular-nums ${
              time.urgent ? "text-orange-400/70" : "text-white/25"
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
