"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import AnalyzeModal from "./components/AnalyzeModal";
import AgentDebateTimeline from "./components/AgentDebateTimeline";
import AgentSpawnerForm from "./components/AgentSpawnerForm";
import BetForm from "./components/BetForm";
import CategoryNav from "./components/CategoryNav";
import CompactHeroMarket from "./components/CompactHeroMarket";
import HeroMarket from "./components/HeroMarket";
import MarketCreator from "./components/MarketCreator";
import MobileTabBar from "./components/MobileTabBar";
import TamagotchiLoader from "./components/TamagotchiLoader";
import TamagotchiEmptyState from "./components/TamagotchiEmptyState";
import TradeLog from "./components/TradeLog";
import MarketsDomainSection from "./components/dashboard/MarketsDomainSection";
import { LeftSidebar, RightSidebar } from "./components/dashboard/OperationsSidebar";
import OperationsSidebar from "./components/dashboard/OperationsSidebar";
import StatusHeader from "./components/dashboard/StatusHeader";
import { computeDisagreement, safeBigInt } from "./components/dashboard/utils";
import type {
  AgentMetricsSnapshot,
  AgentPrediction,
  LatestAgentTake,
  LeaderboardEntry,
  LoopStatus,
  Market,
  MarketCategory,
  SortMode,
} from "./components/dashboard/types";
import { STORAGE_KEY, type SerializedSpawnedAgent } from "@/lib/agent-spawner";
import {
  categorizeMarket,
  estimateEngagementScore,
  getCategoryCounts,
} from "@/lib/categories";

const DASHBOARD_CACHE_KEY = "prediction-dashboard-cache-v1";

type MobileTab = "markets" | "agents" | "activity";

export default function Dashboard() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [predictions, setPredictions] = useState<Record<number, AgentPrediction[]>>({});
  const [weightedProbs, setWeightedProbs] = useState<Record<number, number | null>>({});
  const [latestTakes, setLatestTakes] = useState<Record<number, LatestAgentTake | null>>({});
  const [factoryConfigured, setFactoryConfigured] = useState(false);
  const [factoryAddress, setFactoryAddress] = useState<string | null>(null);
  const [spawnedAgents, setSpawnedAgents] = useState<SerializedSpawnedAgent[]>([]);
  const [analyzeMarketId, setAnalyzeMarketId] = useState<number | null>(null);
  const [betMarketId, setBetMarketId] = useState<number | null>(null);
  const [betPreselectedOutcome, setBetPreselectedOutcome] = useState<0 | 1 | undefined>(undefined);
  const [showCreator, setShowCreator] = useState(false);
  const [showSpawner, setShowSpawner] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [autonomousMode, setAutonomousMode] = useState(true);
  const [loopToggling, setLoopToggling] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<MarketCategory>("all");
  const [sortBy, setSortBy] = useState<SortMode>("engagement");
  const [nextTickAt, setNextTickAt] = useState<number | null>(null);
  const [nextTickIn, setNextTickIn] = useState<number | null>(null);
  const [loopStatus, setLoopStatus] = useState<LoopStatus | null>(null);
  const [loopActions, setLoopActions] = useState<Array<{ detail?: string }>>([]);
  const [metrics, setMetrics] = useState<AgentMetricsSnapshot | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [marketDataSource, setMarketDataSource] = useState<
    "onchain" | "cache" | "unknown"
  >("unknown");
  const [marketDataStale, setMarketDataStale] = useState(false);
  const [marketDataWarning, setMarketDataWarning] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<MobileTab>("markets");
  const [survivalTier, setSurvivalTier] = useState<string | null>(null);
  const [agentWalletAddress, setAgentWalletAddress] = useState<string | null>(null);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasWarmCacheRef = useRef(false);
  const deferredQuery = useDeferredValue(searchQuery);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as SerializedSpawnedAgent[];
        setSpawnedAgents(parsed);
      }
    } catch {}

    try {
      const cached = localStorage.getItem(DASHBOARD_CACHE_KEY);
      if (!cached) return;
      const parsed = JSON.parse(cached) as {
        markets?: Market[];
        leaderboard?: LeaderboardEntry[];
        predictions?: Record<number, AgentPrediction[]>;
        weightedProbs?: Record<number, number | null>;
        latestTakes?: Record<number, LatestAgentTake | null>;
        factoryConfigured?: boolean;
        factoryAddress?: string | null;
        lastUpdatedAt?: number;
        stale?: boolean;
        source?: "onchain" | "cache";
      };
      if (Array.isArray(parsed.markets) && parsed.markets.length > 0) {
        hasWarmCacheRef.current = true;
        setMarkets(parsed.markets);
        setLeaderboard(Array.isArray(parsed.leaderboard) ? parsed.leaderboard : []);
        setPredictions(parsed.predictions ?? {});
        setWeightedProbs(parsed.weightedProbs ?? {});
        setLatestTakes(parsed.latestTakes ?? {});
        setFactoryConfigured(Boolean(parsed.factoryConfigured));
        setFactoryAddress(parsed.factoryAddress ?? null);
        setLastUpdatedAt(parsed.lastUpdatedAt ?? Date.now());
        setMarketDataSource(parsed.source ?? "cache");
        setMarketDataStale(Boolean(parsed.stale));
        setLoading(false);
      }
    } catch {}
  }, []);

  /**
   * Fetch with a timeout that never aborts the underlying request.
   * If the timeout fires, resolves to null — callers should treat null
   * as "no response yet" and fall back to cached data.
   */
  const fetchWithTimeout = useCallback(
    async (url: string, timeoutMs: number): Promise<Response | null> => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<null>((resolve) => {
        timeoutId = setTimeout(() => resolve(null), timeoutMs);
      });
      try {
        const result = await Promise.race([
          fetch(url, { cache: "no-store" }),
          timeout,
        ]);
        return result;
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    },
    []
  );

  const loadData = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setLoadError(null);

    try {
      const marketsRes = await fetchWithTimeout("/api/markets?status=open&limit=20&hideEmpty=true", 8_000);
      if (!marketsRes) throw new Error("Markets request timed out — showing cached data");
      if (!marketsRes.ok) throw new Error(`Markets API failed: HTTP ${marketsRes.status}`);

      const marketsData = await marketsRes.json();
      const marketList = Array.isArray(marketsData.markets)
        ? (marketsData.markets as Market[])
        : [];
      setMarkets(marketList);
      setFactoryConfigured(Boolean(marketsData.factoryConfigured));
      setFactoryAddress(marketsData.factoryAddress ?? null);
      setMarketDataSource(
        marketsData.source === "onchain" || marketsData.source === "cache"
          ? marketsData.source
          : "unknown"
      );
      setMarketDataStale(Boolean(marketsData.stale));
      setMarketDataWarning(
        typeof marketsData.warning === "string" ? marketsData.warning : null
      );
      if (showLoading) setLoading(false);

      const leaderboardPromise: Promise<LeaderboardEntry[]> = fetchWithTimeout("/api/leaderboard", 5_000)
        .then(async (res) => {
          if (!res || !res.ok) return [];
          const payload = await res.json();
          return Array.isArray(payload.leaderboard) ? payload.leaderboard : [];
        })
        .catch(() => []);

      const detailResults = await Promise.allSettled(
        marketList.map(async (market) => {
          const res = await fetchWithTimeout(`/api/markets/${market.id}`, 5_000);
          if (!res || !res.ok) {
            return { id: market.id, predictions: [], weightedProbability: null, latestAgentTake: null };
          }
          const data = await res.json();
          return {
            id: market.id,
            predictions: Array.isArray(data.predictions) ? data.predictions : [],
            weightedProbability:
              typeof data.weightedProbability === "number" ? data.weightedProbability : null,
            latestAgentTake: data.latestAgentTake ?? null,
          };
        })
      );
      const leaderboardData = await leaderboardPromise;
      setLeaderboard(leaderboardData);

      const predsMap: Record<number, AgentPrediction[]> = {};
      const weightedMap: Record<number, number | null> = {};
      const latestMap: Record<number, LatestAgentTake | null> = {};
      for (const settled of detailResults) {
        if (settled.status !== "fulfilled") continue;
        const detail = settled.value;
        predsMap[detail.id] = detail.predictions;
        weightedMap[detail.id] = detail.weightedProbability;
        latestMap[detail.id] = detail.latestAgentTake;
      }

      setPredictions(predsMap);
      setWeightedProbs(weightedMap);
      setLatestTakes(latestMap);
      const refreshedAt = Date.now();
      setLastUpdatedAt(refreshedAt);

      try {
        localStorage.setItem(
          DASHBOARD_CACHE_KEY,
          JSON.stringify({
            markets: marketList,
            leaderboard: leaderboardData,
            predictions: predsMap,
            weightedProbs: weightedMap,
            latestTakes: latestMap,
            factoryConfigured: Boolean(marketsData.factoryConfigured),
            factoryAddress: marketsData.factoryAddress ?? null,
            lastUpdatedAt: refreshedAt,
            stale: Boolean(marketsData.stale),
            source:
              marketsData.source === "onchain" || marketsData.source === "cache"
                ? marketsData.source
                : "unknown",
          })
        );
      } catch {}
    } catch (err: any) {
      setLoadError(err?.message ?? "Failed to load dashboard data");
      console.error("Failed to load data:", err);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [fetchWithTimeout]);

  const refreshData = useCallback(async () => {
    setIsRefreshing(true);
    await loadData(false);
  }, [loadData]);

  // Fetch fresh data on mount; if we restored cache, refresh in background.
  useEffect(() => {
    loadData(!hasWarmCacheRef.current);
  }, [loadData]);

  const triggerTick = useCallback(async () => {
    try {
      const response = await fetch("/api/agent-loop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "tick" }),
      });
      if (response.ok) await loadData(false);
    } catch {}
  }, [loadData]);

  useEffect(() => {
    let firstTickTimeout: ReturnType<typeof setTimeout> | undefined;
    if (autonomousMode) {
      const runTick = async () => {
        await triggerTick();
        setNextTickAt(Date.now() + 60_000);
      };
      // Delay first tick so dashboard data loads without RPC contention
      firstTickTimeout = setTimeout(runTick, 15_000);
      pollingRef.current = setInterval(runTick, 60_000);
    } else {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      setNextTickAt(null);
    }
    return () => {
      if (firstTickTimeout) clearTimeout(firstTickTimeout);
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [autonomousMode, triggerTick]);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const [loopRes, metricsRes, survivalRes] = await Promise.all([
          fetch("/api/agent-loop", { cache: "no-store" }),
          fetch("/api/metrics?limit=200", { cache: "no-store" }),
          fetch("/api/survival", { cache: "no-store" }).catch(() => null),
        ]);
        if (loopRes.ok) {
          const loopData = await loopRes.json();
          setLoopStatus(loopData.status ?? null);
          setLoopActions(Array.isArray(loopData.actions) ? loopData.actions : []);
        }
        if (metricsRes.ok) {
          setMetrics((await metricsRes.json()) as AgentMetricsSnapshot);
          setMetricsError(null);
        } else {
          setMetricsError(`HTTP ${metricsRes.status}`);
        }
        if (survivalRes && survivalRes.ok) {
          const survivalData = await survivalRes.json();
          setSurvivalTier(survivalData.tier ?? null);
          setAgentWalletAddress(survivalData.agentAddress ?? null);
        }
      } catch (err: any) {
        setMetricsError(err?.message ?? "failed");
      }
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 15_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!nextTickAt) { setNextTickIn(null); return; }
    const update = () => {
      setNextTickIn(Math.max(0, Math.ceil((nextTickAt - Date.now()) / 1000)));
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [nextTickAt]);

  const toggleAutonomousMode = useCallback(() => {
    setLoopToggling(true);
    setAutonomousMode((prev) => !prev);
    setLoopToggling(false);
  }, []);

  const handleAgentSpawned = useCallback((agent: SerializedSpawnedAgent) => {
    setSpawnedAgents((prev) => [...prev, agent]);
    fetch("/api/leaderboard")
      .then((r) => r.json())
      .then((data) => setLeaderboard(Array.isArray(data.leaderboard) ? data.leaderboard : []))
      .catch(() => {});
  }, []);

  const handleBet = useCallback((marketId: number, outcome?: 0 | 1) => {
    setBetMarketId(marketId);
    setBetPreselectedOutcome(outcome);
  }, []);

  const selectedEntry = useMemo(
    () => leaderboard.find((entry) => entry.agent === selectedAgent),
    [leaderboard, selectedAgent]
  );
  const categoryCounts = useMemo(() => getCategoryCounts(markets), [markets]);
  const activeAgents = loopStatus?.activeAgentCount ?? leaderboard.length;
  const normalizedQuery = deferredQuery.trim().toLowerCase();

  const filteredMarkets = useMemo(() => {
    return markets.filter((market) => {
      if (
        normalizedQuery &&
        !market.question.toLowerCase().includes(normalizedQuery) &&
        !String(market.id).includes(normalizedQuery)
      ) return false;
      if (activeCategory === "all") return true;
      return categorizeMarket(market.question) === activeCategory;
    });
  }, [markets, normalizedQuery, activeCategory]);

  const sortedMarkets = useMemo(() => {
    return [...filteredMarkets].sort((a, b) => {
      if (sortBy === "ending") return a.resolutionTime - b.resolutionTime;
      if (sortBy === "disagreement") {
        return computeDisagreement(predictions[b.id] ?? []) - computeDisagreement(predictions[a.id] ?? []);
      }
      if (sortBy === "engagement") {
        const disagreeA = computeDisagreement(predictions[a.id] ?? []);
        const disagreeB = computeDisagreement(predictions[b.id] ?? []);
        const engA = estimateEngagementScore(a.question, a.resolutionTime) + disagreeA * 0.35;
        const engB = estimateEngagementScore(b.question, b.resolutionTime) + disagreeB * 0.35;
        if (engA !== engB) return engB - engA;
      }
      const poolA = safeBigInt(a.totalPool);
      const poolB = safeBigInt(b.totalPool);
      if (poolA === poolB) return 0;
      return poolB > poolA ? 1 : -1;
    });
  }, [filteredMarkets, sortBy, predictions]);

  const categoryTabs = useMemo(
    () => [
      { id: "all" as MarketCategory, label: "All", count: categoryCounts.all },
      { id: "sports" as MarketCategory, label: "Sports", count: categoryCounts.sports },
      { id: "crypto" as MarketCategory, label: "Crypto", count: categoryCounts.crypto },
      { id: "politics" as MarketCategory, label: "Politics", count: categoryCounts.politics },
      { id: "tech" as MarketCategory, label: "Tech", count: categoryCounts.tech },
      { id: "other" as MarketCategory, label: "World", count: categoryCounts.other },
    ],
    [categoryCounts]
  );

  // Hero market: top engagement-scored market
  const heroMarket = sortedMarkets.length > 0 ? sortedMarkets[0] : null;
  const gridMarkets = sortedMarkets.length > 1 ? sortedMarkets.slice(1) : [];

  const analyzeMarket = markets.find((m) => m.id === analyzeMarketId);
  const betMarket = markets.find((m) => m.id === betMarketId);

  return (
    <div className="min-h-screen bg-cream relative overflow-hidden">
      {/* Subtle ambient glow */}
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute -top-32 right-[-8%] w-64 h-64 rounded-full bg-neo-brand/[0.06] blur-3xl" />
        <div className="absolute top-1/3 left-[-12%] w-72 h-72 rounded-full bg-neo-purple/[0.06] blur-3xl" />
      </div>

      <StatusHeader
        markets={markets}
        filteredCount={filteredMarkets.length}
        activeAgents={activeAgents}
        customAgentCount={spawnedAgents.length}
        autonomousMode={autonomousMode}
        loopToggling={loopToggling}
        nextTickIn={nextTickIn}
        lastUpdatedAt={lastUpdatedAt}
        marketDataSource={marketDataSource}
        marketDataStale={marketDataStale}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onToggleAutonomousMode={toggleAutonomousMode}
        onOpenSpawner={() => setShowSpawner(true)}
        onOpenCreator={() => setShowCreator(true)}
      />

      <CategoryNav
        tabs={categoryTabs}
        activeCategory={activeCategory}
        sortBy={sortBy}
        onSetCategory={setActiveCategory}
        onSortChange={setSortBy}
      />

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-4 pb-20 lg:pb-4">
        {/* Error / Warning banners */}
        {loadError && (
          <div className="neo-card p-4 mb-4 border border-neo-red/30 bg-neo-red/10" role="alert">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-heading font-bold text-sm text-neo-red">Data sync failed</p>
                <p className="text-xs text-white/70 mt-0.5">{loadError}</p>
              </div>
              <button
                type="button"
                onClick={refreshData}
                disabled={isRefreshing}
                className="neo-btn-secondary text-xs px-3 py-1.5 border-neo-red/30 text-neo-red disabled:opacity-60"
              >
                {isRefreshing ? "Retrying..." : "Retry"}
              </button>
            </div>
          </div>
        )}
        {!loadError && marketDataWarning && (
          <div className="neo-card p-3 mb-4 border border-neo-yellow/30 bg-neo-yellow/10" role="status">
            <p className="text-xs text-neo-yellow">Feed fallback: {marketDataWarning}</p>
          </div>
        )}
        {survivalTier === "dead" && agentWalletAddress && (
          <div className="neo-card p-4 mb-4 border border-neo-yellow/40 bg-neo-yellow/10" role="status">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <p className="font-heading font-bold text-sm text-neo-yellow">
                  Agent wallet is unfunded
                </p>
                <p className="text-xs text-white/70 mt-0.5">
                  Predictions and bets are paused. Send Sepolia STRK to activate the hive.
                </p>
                <p className="text-xs text-white/50 mt-1 font-mono break-all">
                  {agentWalletAddress}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(agentWalletAddress);
                  }}
                  className="neo-btn-secondary text-xs px-3 py-1.5 border-neo-yellow/30 text-neo-yellow"
                >
                  Copy Address
                </button>
                <a
                  href="https://starknet-faucet.vercel.app/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="neo-btn-secondary text-xs px-3 py-1.5 border-neo-yellow/30 text-neo-yellow"
                >
                  Sepolia Faucet &rarr;
                </a>
              </div>
            </div>
          </div>
        )}

        {/* 3-column layout: xl = left+main+right, lg = main+right, <lg = single */}
        <div className="flex gap-4 items-start">
          {/* Left sidebar — xl only */}
          <LeftSidebar
            loopStatus={loopStatus}
            factoryConfigured={factoryConfigured}
            factoryAddress={factoryAddress}
            autonomousMode={autonomousMode}
            nextTickIn={nextTickIn}
            loopActions={loopActions}
            spawnedAgents={spawnedAgents}
            selectedEntry={selectedEntry}
            onTriggerTick={triggerTick}
          />

          {/* Main content */}
          <div className="flex-1 min-w-0 space-y-4">
            {/* Hero Market */}
            {heroMarket && !loading && (
              <>
                {/* Compact hero — mobile only */}
                <div className="sm:hidden">
                  <CompactHeroMarket
                    market={heroMarket}
                    predictions={predictions[heroMarket.id] ?? []}
                  />
                </div>
                {/* Full hero — desktop */}
                <div className="hidden sm:block">
                  <HeroMarket
                    market={heroMarket}
                    predictions={predictions[heroMarket.id] ?? []}
                    weightedProb={weightedProbs[heroMarket.id]}
                    latestTake={latestTakes[heroMarket.id]}
                    onAnalyze={setAnalyzeMarketId}
                    onBet={handleBet}
                  />
                </div>
              </>
            )}

            {/* Market Grid — visible when Markets tab active (mobile) or always (desktop) */}
            <div className={`${mobileTab !== "markets" ? "hidden lg:block" : ""}`}>
              <div className="mb-4">
                <AgentDebateTimeline />
              </div>
              <MarketsDomainSection
                loading={loading}
                markets={markets}
                sortedMarkets={gridMarkets.length > 0 ? gridMarkets : sortedMarkets}
                predictions={predictions}
                weightedProbs={weightedProbs}
                latestTakes={latestTakes}
                normalizedQuery={normalizedQuery}
                activeCategory={activeCategory}
                factoryConfigured={factoryConfigured}
                isRefreshing={isRefreshing}
                onRefresh={refreshData}
                onAnalyze={setAnalyzeMarketId}
                onBet={handleBet}
              />
            </div>

            {/* Mobile: Agents tab */}
            <div className={`lg:hidden ${mobileTab !== "agents" ? "hidden" : ""}`}>
              <OperationsSidebar
                loopStatus={loopStatus}
                factoryConfigured={factoryConfigured}
                factoryAddress={factoryAddress}
                autonomousMode={autonomousMode}
                nextTickIn={nextTickIn}
                loopActions={loopActions}
                metrics={metrics}
                metricsError={metricsError}
                leaderboard={leaderboard}
                selectedAgent={selectedAgent}
                selectedEntry={selectedEntry}
                spawnedAgents={spawnedAgents}
                markets={markets}
                predictions={predictions}
                onSelectAgent={(agent) =>
                  setSelectedAgent(selectedAgent === agent ? null : agent)
                }
                onTriggerTick={triggerTick}
                onAnalyze={setAnalyzeMarketId}
                onBet={(id) => handleBet(id)}
              />
            </div>

            {/* Mobile: Activity tab */}
            <div className={`lg:hidden ${mobileTab !== "activity" ? "hidden" : ""}`}>
              <TradeLog isLoopRunning={autonomousMode} />
            </div>

            {/* Desktop: Trade log */}
            <div className="hidden lg:block mt-4">
              <TradeLog isLoopRunning={autonomousMode} />
            </div>
          </div>

          {/* Right sidebar — lg+ */}
          <RightSidebar
            autonomousMode={autonomousMode}
            leaderboard={leaderboard}
            selectedAgent={selectedAgent}
            markets={markets}
            predictions={predictions}
            onSelectAgent={(agent) =>
              setSelectedAgent(selectedAgent === agent ? null : agent)
            }
            onAnalyze={setAnalyzeMarketId}
            onBet={(id) => handleBet(id)}
          />
        </div>
      </main>

      {/* Mobile bottom tab bar */}
      <MobileTabBar
        activeTab={mobileTab}
        onTabChange={setMobileTab}
        autonomousMode={autonomousMode}
        marketDataSource={marketDataSource}
        marketDataStale={marketDataStale}
        activeAgents={activeAgents}
        nextTickIn={nextTickIn}
      />

      {/* Modals */}
      {showSpawner && (
        <AgentSpawnerForm onClose={() => setShowSpawner(false)} onSpawned={handleAgentSpawned} />
      )}

      {showCreator && <MarketCreator onClose={() => setShowCreator(false)} />}

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
    </div>
  );
}
