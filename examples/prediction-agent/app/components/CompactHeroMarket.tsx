"use client";

import Link from "next/link";
import { categorizeMarket } from "@/lib/categories";
import type { Market, AgentPrediction } from "./dashboard/types";

interface CompactHeroMarketProps {
  market: Market;
  predictions: AgentPrediction[];
}

export default function CompactHeroMarket({
  market,
  predictions,
}: CompactHeroMarketProps) {
  const yesPercent = Math.round(market.impliedProbYes * 100);
  const noPercent = 100 - yesPercent;
  const category = categorizeMarket(market.question);

  const CATEGORY_COLORS: Record<string, string> = {
    crypto: "bg-neo-yellow",
    sports: "bg-neo-green",
    politics: "bg-neo-blue",
    tech: "bg-neo-purple",
    other: "bg-neo-brand",
  };
  const accentColor = CATEGORY_COLORS[category] ?? "bg-neo-brand";

  return (
    <Link
      href={`/market/${market.id}`}
      className="neo-card block overflow-hidden border-neo-brand/20 bg-gradient-to-r from-white/[0.05] to-white/[0.02] active:scale-[0.99] transition-transform"
    >
      <div className="flex">
        <div className={`w-1 shrink-0 ${accentColor}`} />
        <div className="flex items-center gap-2 flex-1 min-w-0 px-3 py-3">
          <span className="text-[10px] font-semibold text-neo-brand/80 uppercase tracking-wider shrink-0">
            {category}
          </span>
          <p className="text-xs font-heading font-semibold text-white truncate flex-1">
            {market.question}
          </p>
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-xs font-mono font-bold text-neo-green">
              {yesPercent}%
            </span>
            <span className="text-[9px] text-white/25 mx-0.5">·</span>
            <span className="text-xs font-mono font-bold text-neo-red">
              {noPercent}%
            </span>
          </div>
          <svg className="w-4 h-4 text-white/25 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </div>
      </div>
    </Link>
  );
}
