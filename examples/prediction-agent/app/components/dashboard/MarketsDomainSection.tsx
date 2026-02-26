"use client";

import MarketCard from "../MarketCard";
import { categorizeMarket } from "@/lib/categories";
import type {
  AgentPrediction,
  LatestAgentTake,
  Market,
  MarketCategory,
} from "./types";

interface MarketsDomainSectionProps {
  loading: boolean;
  markets: Market[];
  sortedMarkets: Market[];
  predictions: Record<number, AgentPrediction[]>;
  weightedProbs: Record<number, number | null>;
  latestTakes: Record<number, LatestAgentTake | null>;
  normalizedQuery: string;
  activeCategory: MarketCategory;
  factoryConfigured: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
  onAnalyze: (marketId: number) => void;
  onBet: (marketId: number, outcome?: 0 | 1) => void;
}

export default function MarketsDomainSection({
  loading,
  markets,
  sortedMarkets,
  predictions,
  weightedProbs,
  latestTakes,
  normalizedQuery,
  activeCategory,
  factoryConfigured,
  isRefreshing,
  onRefresh,
  onAnalyze,
  onBet,
}: MarketsDomainSectionProps) {
  if (loading) {
    return (
      <section className="flex-1 min-w-0" aria-labelledby="markets-heading">
        <div className="neo-card p-10 sm:p-16 text-center">
          <div className="inline-flex items-center gap-2">
            <span className="w-2 h-2 bg-neo-brand rounded-full animate-bounce" />
            <span className="w-2 h-2 bg-neo-brand rounded-full animate-bounce [animation-delay:0.1s]" />
            <span className="w-2 h-2 bg-neo-brand rounded-full animate-bounce [animation-delay:0.2s]" />
          </div>
          <p className="font-mono text-sm text-white/50 mt-3">Loading markets...</p>
        </div>
      </section>
    );
  }

  if (markets.length === 0) {
    return (
      <section className="flex-1 min-w-0" aria-labelledby="markets-heading">
        <div className="neo-card p-10 sm:p-16 text-center">
          <div className="w-14 h-14 mx-auto mb-4 bg-neo-yellow/15 border border-neo-yellow/25 flex items-center justify-center rounded-xl text-neo-yellow">
            <span className="text-2xl">?</span>
          </div>
          <p className="font-heading font-bold text-lg mb-1">No open markets</p>
          <p className="text-sm text-white/50">
            {factoryConfigured
              ? "Autonomous mode can auto-create markets on the next tick."
              : "Market factory not configured."}
          </p>
        </div>
      </section>
    );
  }

  if (sortedMarkets.length === 0) {
    return (
      <section className="flex-1 min-w-0" aria-labelledby="markets-heading">
        <div className="neo-card p-8 sm:p-12 text-center">
          <p className="font-heading font-bold text-base mb-1">
            {normalizedQuery ? "No markets match your search" : "No markets in this category"}
          </p>
          <p className="text-sm text-white/50">
            {normalizedQuery
              ? "Try a different keyword or clear filters."
              : "Try a different category."}
          </p>
        </div>
      </section>
    );
  }

  const renderMarketCard = (market: Market, i: number) => {
    const marketPreds = predictions[market.id] ?? [];
    const agentConsensus =
      marketPreds.length > 0
        ? marketPreds.reduce((sum, p) => sum + p.predictedProb, 0) /
          marketPreds.length
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
  };

  const renderGrid = (items: Market[]) => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {items.map((market, i) => renderMarketCard(market, i))}
    </div>
  );

  if (activeCategory === "all" && !normalizedQuery) {
    const sectionOrder: Array<{ id: MarketCategory; label: string }> = [
      { id: "politics", label: "Politics" },
      { id: "sports", label: "Sports" },
      { id: "tech", label: "Tech" },
      { id: "crypto", label: "Crypto" },
      { id: "other", label: "World" },
    ];
    const sections = sectionOrder
      .map((section) => ({
        ...section,
        items: sortedMarkets
          .filter((market) => categorizeMarket(market.question) === section.id)
          .slice(0, 6),
      }))
      .filter((section) => section.items.length > 0);

    return (
      <section className="flex-1 min-w-0" aria-labelledby="markets-heading">
        <div className="flex items-center justify-between mb-3">
          <h2
            id="markets-heading"
            className="font-heading font-bold text-sm text-white/50 uppercase tracking-wider"
          >
            Domain Sections
          </h2>
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="text-xs text-white/40 hover:text-white/60 font-mono transition-colors disabled:opacity-50"
          >
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        <div className="space-y-5">
          {sections.map((section) => (
            <section key={section.id} aria-label={`${section.label} markets`}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-heading font-bold text-xs uppercase tracking-wider text-white/55">
                  {section.label}
                </h3>
                <span className="text-[10px] font-mono text-white/35">
                  {section.items.length} shown
                </span>
              </div>
              {renderGrid(section.items)}
            </section>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="flex-1 min-w-0" aria-labelledby="markets-heading">
      <div className="flex items-center justify-between mb-3">
        <h2
          id="markets-heading"
          className="font-heading font-bold text-sm text-white/50 uppercase tracking-wider"
        >
          {sortedMarkets.length} Markets
        </h2>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="text-xs text-white/40 hover:text-white/60 font-mono transition-colors disabled:opacity-50"
        >
          {isRefreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>
      {renderGrid(sortedMarkets)}
    </section>
  );
}
