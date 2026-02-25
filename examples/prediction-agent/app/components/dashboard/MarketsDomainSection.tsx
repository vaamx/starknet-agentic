"use client";

import MarketCard from "../MarketCard";
import { categorizeMarket } from "@/lib/categories";
import type {
  AgentPrediction,
  CategoryTab,
  LatestAgentTake,
  Market,
  MarketCategory,
  SortMode,
} from "./types";

interface MarketsDomainSectionProps {
  loading: boolean;
  markets: Market[];
  sortedMarkets: Market[];
  predictions: Record<number, AgentPrediction[]>;
  weightedProbs: Record<number, number | null>;
  latestTakes: Record<number, LatestAgentTake | null>;
  categoryTabs: CategoryTab[];
  activeCategory: MarketCategory;
  searchQuery: string;
  sortBy: SortMode;
  isRefreshing: boolean;
  loopActions: Array<{ detail?: string }>;
  normalizedQuery: string;
  factoryConfigured: boolean;
  marketDataSource: "onchain" | "cache" | "unknown";
  marketDataStale: boolean;
  onSetCategory: (category: MarketCategory) => void;
  onSearchChange: (value: string) => void;
  onSortChange: (mode: SortMode) => void;
  onRefresh: () => void;
  onAnalyze: (marketId: number) => void;
  onBet: (marketId: number) => void;
}

export default function MarketsDomainSection({
  loading,
  markets,
  sortedMarkets,
  predictions,
  weightedProbs,
  latestTakes,
  categoryTabs,
  activeCategory,
  searchQuery,
  sortBy,
  isRefreshing,
  loopActions,
  normalizedQuery,
  factoryConfigured,
  marketDataSource,
  marketDataStale,
  onSetCategory,
  onSearchChange,
  onSortChange,
  onRefresh,
  onAnalyze,
  onBet,
}: MarketsDomainSectionProps) {
  const pulseText = loopActions.slice(-1)[0]?.detail ?? "";
  const featuredMarkets = sortedMarkets.slice(0, 3);

  const renderFeaturedCard = (market: Market) => {
    const cardCategory = categorizeMarket(market.question).toUpperCase();
    const yesPct = Math.round(market.impliedProbYes * 100);
    return (
      <article
        key={`featured-${market.id}`}
        className="neo-card p-4 border-white/15 bg-gradient-to-b from-white/[0.08] to-white/[0.02]"
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-mono text-neo-green/80">{cardCategory}</span>
          <span className="text-[10px] font-mono text-white/45">#{market.id}</span>
        </div>
        <p className="font-heading font-semibold text-sm text-white/90 line-clamp-2 min-h-[2.6rem]">
          {market.question}
        </p>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-[10px] text-white/50">Market YES</span>
          <span className="font-mono text-neo-green">{yesPct}%</span>
        </div>
        <button
          type="button"
          className="neo-btn-secondary w-full mt-3 text-xs py-2"
          onClick={() => onAnalyze(market.id)}
        >
          Analyze Now
        </button>
      </article>
    );
  };

  return (
    <section className="flex-1 min-w-0 space-y-4" aria-labelledby="markets-heading">
      <div className="flex items-center justify-between mb-1">
        <h2
          id="markets-heading"
          className="font-heading font-bold text-sm uppercase tracking-wider text-white/50"
        >
          Active Markets
        </h2>
        <span className="font-mono text-[10px] text-white/40">
          {sortedMarkets.length} shown
        </span>
      </div>

      {loopActions.length > 0 && (
        <div className="neo-card px-4 py-3 mb-3" aria-live="polite">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-neo-green animate-pulse" />
                <p className="text-[10px] font-mono uppercase tracking-widest text-white/40">
                  Swarm Pulse
                </p>
              </div>
              <p className="text-xs text-white/80 mt-0.5 line-clamp-2 sm:line-clamp-1">
                {pulseText}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span
                className={`text-[10px] font-mono ${
                  marketDataStale ? "text-neo-yellow" : "text-neo-green/80"
                }`}
              >
                {marketDataSource.toUpperCase()}
              </span>
              <span className="text-[10px] font-mono text-neo-green/80">LIVE</span>
            </div>
          </div>
        </div>
      )}

      {!loading && featuredMarkets.length > 0 && (
        <>
          <div className="sm:hidden -mx-4 px-4 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex gap-3 snap-x snap-mandatory">
              {featuredMarkets.map((market) => (
                <div
                  key={`featured-mobile-${market.id}`}
                  className="min-w-[82%] snap-start"
                >
                  {renderFeaturedCard(market)}
                </div>
              ))}
            </div>
          </div>

          <div className="hidden sm:grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {featuredMarkets.map((market) => renderFeaturedCard(market))}
          </div>
        </>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div
          className="flex items-center gap-2 overflow-x-auto whitespace-nowrap pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="tablist"
          aria-label="Market categories"
        >
          {categoryTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeCategory === tab.id}
              onClick={() => onSetCategory(tab.id)}
              className={`px-3 py-1.5 rounded-full border text-[10px] font-mono uppercase tracking-wider transition-colors ${
                activeCategory === tab.id
                  ? "border-neo-green/50 bg-neo-green/10 text-neo-green"
                  : "border-white/10 text-white/50 hover:border-white/30"
              }`}
            >
              {tab.label} ({tab.count})
            </button>
          ))}
        </div>

        <div className="w-full sm:w-auto">
          <div className="space-y-2 sm:space-y-0 sm:flex sm:items-center sm:gap-2">
            <label className="sr-only" htmlFor="market-search">
              Search markets
            </label>
            <input
              id="market-search"
              type="search"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search market, topic, or ID..."
              className="neo-input text-[10px] py-2 sm:py-1.5 px-2 w-full sm:w-52"
              aria-label="Search markets"
            />

            <div className="flex items-center gap-2">
              <label
                className="hidden sm:block text-[10px] font-mono text-white/40 uppercase tracking-wider"
                htmlFor="market-sort"
              >
                Sort
              </label>
              <select
                id="market-sort"
                value={sortBy}
                onChange={(e) => onSortChange(e.target.value as SortMode)}
                className="neo-input text-[10px] py-2 sm:py-1.5 px-2 flex-1 sm:flex-none"
                aria-label="Sort markets"
              >
                <option value="engagement">Engagement</option>
                <option value="volume">Volume</option>
                <option value="ending">Ending Soon</option>
                <option value="disagreement">Agent Disagreement</option>
              </select>
              <button
                type="button"
                onClick={onRefresh}
                disabled={isRefreshing || loading}
                className="neo-btn-secondary text-[10px] px-3 py-2 sm:py-1.5 disabled:opacity-60 whitespace-nowrap"
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
        </div>
      </div>
      {loading ? (
        <div className="neo-card p-10 sm:p-16 text-center">
          <div className="inline-flex items-center gap-2">
            <span className="w-2 h-2 bg-neo-green rounded-full animate-bounce" />
            <span className="w-2 h-2 bg-neo-green rounded-full animate-bounce [animation-delay:0.1s]" />
            <span className="w-2 h-2 bg-neo-green rounded-full animate-bounce [animation-delay:0.2s]" />
          </div>
          <p className="font-mono text-xs text-white/50 mt-3">Loading markets...</p>
        </div>
      ) : markets.length === 0 ? (
        <div className="neo-card p-10 sm:p-16 text-center">
          <div className="w-16 h-16 mx-auto mb-4 bg-neo-yellow/20 border border-neo-yellow/30 flex items-center justify-center rounded-2xl text-neo-yellow">
            <span className="text-3xl">?</span>
          </div>
          <p className="font-heading font-bold text-lg mb-1">No open markets right now</p>
          <p className="text-sm text-white/50">
            {factoryConfigured
              ? "Factory is live. Autonomous mode can auto-create markets on the next tick, or use Run One Tick now."
              : "Market factory not configured — deploy contracts to begin."}
          </p>
        </div>
      ) : sortedMarkets.length === 0 ? (
        <div className="neo-card p-8 sm:p-12 text-center">
          <p className="font-heading font-bold text-base mb-1">
            {normalizedQuery ? "No markets match your search" : "No markets in this category"}
          </p>
          <p className="text-sm text-white/50">
            {normalizedQuery
              ? "Try a different keyword or clear filters."
              : "Try a different category or create a new market."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 2xl:grid-cols-2 gap-4">
          {sortedMarkets.map((market, i) => {
            const marketPreds = predictions[market.id] ?? [];
            const agentConsensus =
              marketPreds.length > 0
                ? marketPreds.reduce((sum, p) => sum + p.predictedProb, 0) / marketPreds.length
                : undefined;
            const category = categorizeMarket(market.question);

            return (
              <div key={market.id} className={`animate-enter stagger-${Math.min(i + 1, 5)}`}>
                <MarketCard
                  id={market.id}
                  question={market.question}
                  address={market.address}
                  oracle={market.oracle}
                  impliedProbYes={market.impliedProbYes}
                  impliedProbNo={market.impliedProbNo}
                  totalPool={market.totalPool}
                  status={market.status}
                  resolutionTime={market.resolutionTime}
                  agentConsensus={agentConsensus}
                  weightedProb={weightedProbs[market.id]}
                  tradeCount={market.tradeCount}
                  category={category}
                  latestAgentTake={latestTakes[market.id]}
                  predictions={marketPreds}
                  onAnalyze={onAnalyze}
                  onBet={onBet}
                />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
