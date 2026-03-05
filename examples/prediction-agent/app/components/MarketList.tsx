"use client";

import MarketGridCard from "./MarketGridCard";
import MarketRow from "./MarketRow";
import type {
  AgentPrediction,
  LatestAgentTake,
  Market,
} from "./dashboard/types";

type ViewMode = "grid" | "table";

interface MarketListProps {
  markets: Market[];
  predictions: Record<number, AgentPrediction[]>;
  weightedProbs: Record<number, number | null>;
  latestTakes: Record<number, LatestAgentTake | null>;
  loading: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
  onBet: (marketId: number, outcome?: 0 | 1) => void;
  viewMode?: ViewMode;
}

function SkeletonCard() {
  return (
    <div className="market-card animate-pulse">
      <div className="h-[2px] w-full bg-white/[0.03]" />
      <div className="p-5 pb-3">
        <div className="flex items-center gap-2 mb-3.5">
          <div className="h-5 bg-white/[0.04] rounded-md w-16" />
          <div className="h-5 bg-white/[0.03] rounded-md w-10" />
        </div>
        <div className="space-y-2 mb-4">
          <div className="h-4 bg-white/[0.05] rounded w-[90%]" />
          <div className="h-4 bg-white/[0.04] rounded w-[65%]" />
        </div>
        <div className="h-[80px] bg-white/[0.02] rounded-lg mb-3" />
        <div className="flex items-end justify-between mb-2">
          <div className="h-8 bg-white/[0.04] rounded w-20" />
          <div className="h-5 bg-white/[0.03] rounded w-14" />
        </div>
        <div className="h-1.5 bg-white/[0.03] rounded-full mb-1" />
        <div className="flex justify-between">
          <div className="h-2.5 bg-white/[0.02] rounded w-10" />
          <div className="h-2.5 bg-white/[0.02] rounded w-10" />
        </div>
      </div>
      <div className="px-5 pb-4 flex gap-2.5">
        <div className="flex-1 h-[44px] rounded-xl bg-emerald-500/[0.04]" />
        <div className="flex-1 h-[44px] rounded-xl bg-red-500/[0.04]" />
      </div>
      <div className="px-5 py-3 border-t border-white/[0.04] flex items-center gap-3">
        <div className="flex -space-x-1">
          <div className="w-5 h-5 rounded-full bg-white/[0.04]" />
          <div className="w-5 h-5 rounded-full bg-white/[0.03]" />
        </div>
        <div className="flex-1" />
        <div className="h-3 bg-white/[0.03] rounded w-12" />
        <div className="h-3 bg-white/[0.03] rounded w-10" />
      </div>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 px-4 lg:px-5 py-4 animate-pulse">
      <div className="flex-1 min-w-0 space-y-2">
        <div className="h-4 bg-white/[0.05] rounded w-3/4" />
        <div className="h-3 bg-white/[0.03] rounded w-20" />
      </div>
      <div className="w-[88px] shrink-0 space-y-1.5">
        <div className="h-4 bg-emerald-500/[0.06] rounded w-14 ml-auto" />
        <div className="h-[3px] bg-white/[0.03] rounded-full" />
      </div>
      <div className="w-[88px] shrink-0 space-y-1.5">
        <div className="h-4 bg-red-500/[0.06] rounded w-14 ml-auto" />
        <div className="h-[3px] bg-white/[0.03] rounded-full" />
      </div>
      <div className="hidden sm:block w-[80px] shrink-0">
        <div className="h-3 bg-white/[0.03] rounded w-12 ml-auto" />
      </div>
      <div className="hidden md:block w-[48px] shrink-0">
        <div className="h-3 bg-white/[0.03] rounded w-8 ml-auto" />
      </div>
    </div>
  );
}

export default function MarketList({
  markets,
  predictions,
  weightedProbs,
  latestTakes,
  loading,
  isRefreshing,
  onRefresh,
  onBet,
  viewMode = "grid",
}: MarketListProps) {
  if (loading) {
    return viewMode === "grid" ? (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    ) : (
      <div className="rounded-xl border border-white/[0.04] bg-white/[0.01] overflow-hidden">
        <div className="flex items-center gap-4 px-4 lg:px-5 py-3 border-b border-white/[0.04]">
          <div className="flex-1 min-w-0"><div className="h-3 bg-white/[0.04] rounded w-12" /></div>
          <div className="w-[88px] shrink-0"><div className="h-3 bg-white/[0.04] rounded w-6 ml-auto" /></div>
          <div className="w-[88px] shrink-0"><div className="h-3 bg-white/[0.04] rounded w-6 ml-auto" /></div>
          <div className="hidden sm:block w-[80px] shrink-0"><div className="h-3 bg-white/[0.04] rounded w-10 ml-auto" /></div>
          <div className="hidden md:block w-[48px] shrink-0"><div className="h-3 bg-white/[0.04] rounded w-6 ml-auto" /></div>
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={i > 0 ? "border-t border-white/[0.03]" : ""}><SkeletonRow /></div>
        ))}
      </div>
    );
  }

  if (markets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 rounded-xl border border-white/[0.04] bg-white/[0.01]">
        <div className="w-14 h-14 rounded-2xl bg-white/[0.03] border border-white/[0.05] flex items-center justify-center mb-4">
          <svg className="w-6 h-6 text-white/15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
          </svg>
        </div>
        <p className="text-sm text-white/35 mb-1 font-heading font-semibold">No markets found</p>
        <p className="text-xs text-white/20 mb-5">Try a different category or create a new market</p>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-semibold font-heading text-white/60 bg-white/[0.05] border border-white/[0.06] hover:bg-white/[0.08] disabled:opacity-40 transition-all"
        >
          <svg className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
          </svg>
          {isRefreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>
    );
  }

  // Grid view — Polymarket-style cards
  if (viewMode === "grid") {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3.5">
        {markets.map((market, i) => (
          <MarketGridCard
            key={market.id}
            market={market}
            predictions={predictions[market.id]}
            weightedProb={weightedProbs[market.id]}
            latestTake={latestTakes[market.id]}
            onBet={onBet}
            index={i}
          />
        ))}
      </div>
    );
  }

  // Table view — ProbTrade-style rows
  return (
    <div className="rounded-xl border border-white/[0.04] bg-white/[0.01] overflow-hidden">
      {/* Column headers */}
      <div className="flex items-center gap-4 px-4 lg:px-5 py-3 border-b border-white/[0.04] bg-white/[0.01]">
        <div className="flex-1 min-w-0">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-white/25">Market</span>
        </div>
        <div className="w-[88px] shrink-0 text-right">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400/40">Yes</span>
        </div>
        <div className="w-[88px] shrink-0 text-right">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-red-400/40">No</span>
        </div>
        <div className="hidden sm:block w-[80px] shrink-0 text-right">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-white/25">Volume</span>
        </div>
        <div className="hidden md:block w-[48px] shrink-0 text-right">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-white/25">Ends</span>
        </div>
        <div className="w-3.5 shrink-0 hidden lg:block" />
      </div>
      {markets.map((market, i) => (
        <div key={market.id} className={i > 0 ? "border-t border-white/[0.03]" : ""} style={{ animationDelay: `${Math.min(i * 0.03, 0.3)}s` }}>
          <MarketRow market={market} predictions={predictions[market.id]} weightedProb={weightedProbs[market.id]} latestTake={latestTakes[market.id]} onBet={onBet} />
        </div>
      ))}
    </div>
  );
}
