"use client";

import { useCallback, useDeferredValue, useMemo, useState } from "react";
import SimpleHeader from "./components/SimpleHeader";
import CategoryNav from "./components/CategoryNav";
import FeaturedHero from "./components/FeaturedHero";
import MarketList from "./components/MarketList";
import BetForm from "./components/BetForm";
import AnalyzeModal from "./components/AnalyzeModal";
import MarketCreator from "./components/MarketCreator";
import useMarkets from "./hooks/useMarkets";
import { computeDisagreement, safeBigInt } from "./components/dashboard/utils";
import {
  categorizeMarket,
  estimateEngagementScore,
  getCategoryCounts,
} from "@/lib/categories";
import type { MarketCategory } from "./components/dashboard/types";

interface SessionUser {
  id: string;
  email: string;
  name: string;
}

interface SessionContext {
  user: SessionUser;
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  role: "owner" | "admin" | "analyst" | "viewer";
}

interface QuantAnalytics {
  calibration: Array<{
    binStart: number;
    binEnd: number;
    avgPredicted: number;
    observedRate: number;
    count: number;
  }>;
  brierTimeline: Array<{
    day: string;
    brier: number;
    count: number;
  }>;
  sourceAttribution: Array<{
    source: string;
    count: number;
  }>;
  sourceReliability: Array<{
    source: string;
    samples: number;
    markets: number;
    avgBrier: number;
    calibrationBias: number;
    reliabilityScore: number;
    confidence: number;
  }>;
  agentCalibration: Array<{
    agentId: string;
    samples: number;
    avgBrier: number;
    calibrationBias: number;
    reliabilityScore: number;
    confidence: number;
    memoryStrength: number;
  }>;
  forecastQuality: {
    avgBrier: number;
    avgLogLoss: number;
    sharpness: number;
    calibrationGap: number;
    brierSkillScore: number;
  };
  strategy: {
    totalExecutions: number;
    successRate: number;
    deployedCapitalStrk: number;
    realizedPnlStrk: number;
    bySurface: Array<{
      executionSurface: string;
      executions: number;
      successRate: number;
    }>;
  };
}

interface ModelCalibrationComparisonRow {
  modelName: string;
  agentId: string;
  forecasts: number;
  brier: number;
  calibrationGap: number;
}

export default function Dashboard() {
  const {
    markets,
    predictions,
    weightedProbs,
    latestTakes,
    loading,
    loadError,
    isRefreshing,
    refreshData,
    marketDataSource,
    marketDataStale,
    marketDataWarning,
    survivalTier,
    agentWalletAddress,
  } = useMarkets();

  // UI state
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<MarketCategory>("all");
  const [betMarketId, setBetMarketId] = useState<number | null>(null);
  const [betPreselectedOutcome, setBetPreselectedOutcome] = useState<
    0 | 1 | undefined
  >(undefined);
  const [analyzeMarketId, setAnalyzeMarketId] = useState<number | null>(null);
  const [showCreator, setShowCreator] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");

  const deferredQuery = useDeferredValue(searchQuery);
  const normalizedQuery = deferredQuery.trim().toLowerCase();

  const categoryCounts = useMemo(
    () => getCategoryCounts(markets),
    [markets]
  );

  const categoryTabs = useMemo(
    () => [
      { id: "all" as MarketCategory, label: "All", count: categoryCounts.all },
      {
        id: "sports" as MarketCategory,
        label: "Sports",
        count: categoryCounts.sports,
      },
      {
        id: "crypto" as MarketCategory,
        label: "Crypto",
        count: categoryCounts.crypto,
      },
      {
        id: "politics" as MarketCategory,
        label: "Politics",
        count: categoryCounts.politics,
      },
      {
        id: "tech" as MarketCategory,
        label: "Tech",
        count: categoryCounts.tech,
      },
      {
        id: "other" as MarketCategory,
        label: "World",
        count: categoryCounts.other,
      },
    ],
    [categoryCounts]
  );

  const filteredMarkets = useMemo(() => {
    return markets.filter((market) => {
      if (
        normalizedQuery &&
        !market.question.toLowerCase().includes(normalizedQuery) &&
        !String(market.id).includes(normalizedQuery)
      )
        return false;
      if (activeCategory === "all") return true;
      return categorizeMarket(market.question) === activeCategory;
    });
  }, [markets, normalizedQuery, activeCategory]);

  const sortedMarkets = useMemo(() => {
    return [...filteredMarkets].sort((a, b) => {
      const disagreeA = computeDisagreement(predictions[a.id] ?? []);
      const disagreeB = computeDisagreement(predictions[b.id] ?? []);
      const engA =
        estimateEngagementScore(a.question, a.resolutionTime) +
        disagreeA * 0.35;
      const engB =
        estimateEngagementScore(b.question, b.resolutionTime) +
        disagreeB * 0.35;
      if (engA !== engB) return engB - engA;
      const poolA = safeBigInt(a.totalPool);
      const poolB = safeBigInt(b.totalPool);
      if (poolA === poolB) return 0;
      return poolB > poolA ? 1 : -1;
    });
  }, [filteredMarkets, predictions]);

  const handleBet = useCallback((marketId: number, outcome?: 0 | 1) => {
    setBetMarketId(marketId);
    setBetPreselectedOutcome(outcome);
  }, []);

  const betMarket = markets.find((m) => m.id === betMarketId);
  const analyzeMarket = markets.find((m) => m.id === analyzeMarketId);

  const activeLabel =
    activeCategory === "all"
      ? "All Markets"
      : categoryTabs.find((t) => t.id === activeCategory)?.label ?? "Markets";

  return (
    <div className="min-h-screen bg-cream">
      <SimpleHeader
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onOpenCreator={() => setShowCreator(true)}
        marketDataSource={marketDataSource}
        marketDataStale={marketDataStale}
      />

      {/* Horizontal category nav */}
      <CategoryNav
        tabs={categoryTabs}
        activeCategory={activeCategory}
        onSetCategory={setActiveCategory}
      />

      {/* Main content */}
      <main className="max-w-[1400px] mx-auto px-3 sm:px-4 lg:px-5 py-4">
          {/* Featured hero section — only on "all" category */}
          {activeCategory === "all" && !loading && sortedMarkets.length > 0 && (
            <FeaturedHero
              markets={sortedMarkets}
              predictions={predictions}
              weightedProbs={weightedProbs}
              latestTakes={latestTakes}
              onBet={handleBet}
            />
          )}

          {/* Section heading with view toggle */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-1 h-6 rounded-full bg-neo-brand/60" />
              <div>
                <h2 className="font-heading text-[18px] font-bold text-white tracking-tight">
                  {activeCategory === "all" ? "All markets" : activeLabel}
                </h2>
                <p className="text-[11px] text-white/25 mt-0.5 font-mono tabular-nums">
                  {filteredMarkets.length} market{filteredMarkets.length !== 1 ? "s" : ""}
                  {activeCategory !== "all" && ` in ${activeLabel}`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-0.5 bg-white/[0.03] border border-white/[0.06] rounded-lg p-0.5">
                <button
                  type="button"
                  onClick={() => setViewMode("grid")}
                  className={`p-1.5 rounded-md transition-colors ${viewMode === "grid" ? "bg-white/[0.08] text-white" : "text-white/25 hover:text-white/50"}`}
                  aria-label="Grid view"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("table")}
                  className={`p-1.5 rounded-md transition-colors ${viewMode === "table" ? "bg-white/[0.08] text-white" : "text-white/25 hover:text-white/50"}`}
                  aria-label="Table view"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 5.25h16.5m-16.5 4.5h16.5m-16.5 4.5h16.5m-16.5 4.5h16.5" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          {/* Error banner */}
          {loadError && (
            <div
              className="rounded-xl border border-red-500/20 bg-red-500/[0.06] p-4 mb-4"
              role="alert"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center shrink-0">
                    <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-heading font-semibold text-sm text-red-400">
                      Data sync failed
                    </p>
                    <p className="text-xs text-white/50 mt-0.5">{loadError}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={refreshData}
                  disabled={isRefreshing}
                  className="shrink-0 px-4 py-2 rounded-xl text-xs font-semibold text-red-400 bg-red-500/10 border border-red-500/20 hover:bg-red-500/15 disabled:opacity-50 transition-all"
                >
                  {isRefreshing ? "Retrying..." : "Retry"}
                </button>
              </div>
            </div>
          )}

          {/* Warning banner */}
          {!loadError && marketDataWarning && (
            <div
              className="rounded-xl border border-amber-500/15 bg-amber-500/[0.04] px-4 py-3 mb-4 flex items-center gap-3"
              role="status"
            >
              <svg className="w-4 h-4 text-amber-400/60 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <p className="text-xs text-amber-400/70">
                {marketDataWarning}
              </p>
            </div>
          )}

          {/* Agent wallet unfunded banner */}
          {survivalTier === "dead" && agentWalletAddress && (
            <div
              className="rounded-xl border border-amber-500/15 bg-amber-500/[0.04] p-5 mb-4"
              role="status"
            >
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0">
                    <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-heading font-semibold text-sm text-amber-300">
                      Agent wallet is unfunded
                    </p>
                    <p className="text-xs text-white/50 mt-1">
                      Predictions and bets are paused. Send Sepolia STRK to activate.
                    </p>
                    <p className="text-[11px] text-white/30 mt-1.5 font-mono break-all leading-relaxed">
                      {agentWalletAddress}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(agentWalletAddress)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/15 transition-all"
                  >
                    Copy
                  </button>
                  <a
                    href="https://starknet-faucet.vercel.app/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/15 transition-all no-underline"
                  >
                    Faucet &rarr;
                  </a>
                </div>
              </div>
            </div>
          )}

          {/* Market grid */}
          <MarketList
            markets={sortedMarkets}
            predictions={predictions}
            weightedProbs={weightedProbs}
            latestTakes={latestTakes}
            loading={loading}
            isRefreshing={isRefreshing}
            onRefresh={refreshData}
            onBet={handleBet}
            viewMode={viewMode}
          />
      </main>

      {/* Modals */}
      {showCreator && (
        <MarketCreator
          onClose={() => setShowCreator(false)}
          onCreated={loadData}
        />
      )}

      {betMarket && (
        <BetForm
          marketId={betMarket.id}
          marketAddress={betMarket.address}
          question={betMarket.question}
          yesPool={betMarket.yesPool}
          noPool={betMarket.noPool}
          totalPool={betMarket.totalPool}
          feeBps={betMarket.feeBps}
          impliedProbYes={betMarket.impliedProbYes}
          preselectedOutcome={betPreselectedOutcome}
          onClose={() => {
            setBetMarketId(null);
            setBetPreselectedOutcome(undefined);
          }}
        />
      )}

      {analyzeMarket && (
        <AnalyzeModal
          marketId={analyzeMarket.id}
          question={analyzeMarket.question}
          onClose={() => setAnalyzeMarketId(null)}
        />
      )}

      {lifecycleAction && (
        <MarketLifecycleModal
          marketId={lifecycleAction.marketId}
          question={
            markets.find((m) => m.id === lifecycleAction.marketId)?.question ??
            `Market #${lifecycleAction.marketId}`
          }
          action={lifecycleAction.action}
          onClose={() => setLifecycleAction(null)}
          onSuccess={loadData}
        />
      )}
    </div>
  );
}
