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
import AgentSpawnerForm from "./components/AgentSpawnerForm";
import BetForm from "./components/BetForm";
import MarketCreator from "./components/MarketCreator";
import TradeLog from "./components/TradeLog";
import MarketsDomainSection from "./components/dashboard/MarketsDomainSection";
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
import { categorizeMarket, getCategoryCounts } from "@/lib/categories";

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
  const [showCreator, setShowCreator] = useState(false);
  const [showSpawner, setShowSpawner] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [autonomousMode, setAutonomousMode] = useState(false);
  const [loopToggling, setLoopToggling] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<MarketCategory>("all");
  const [sortBy, setSortBy] = useState<SortMode>("volume");
  const [nextTickAt, setNextTickAt] = useState<number | null>(null);
  const [nextTickIn, setNextTickIn] = useState<number | null>(null);
  const [showAutoBanner, setShowAutoBanner] = useState(false);
  const [loopStatus, setLoopStatus] = useState<LoopStatus | null>(null);
  const [loopActions, setLoopActions] = useState<Array<{ detail?: string }>>([]);
  const [metrics, setMetrics] = useState<AgentMetricsSnapshot | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const deferredQuery = useDeferredValue(searchQuery);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as SerializedSpawnedAgent[];
        setSpawnedAgents(parsed);
      }
    } catch {
      // localStorage unavailable or malformed
    }
  }, []);

  const fetchWithTimeout = useCallback(
    async (url: string, timeoutMs: number) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await fetch(url, {
          cache: "no-store",
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
    },
    []
  );

  const loadData = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setLoadError(null);

    try {
      const marketsRes = await fetchWithTimeout(
        "/api/markets?status=open&limit=20",
        12_000
      );
      if (!marketsRes.ok) {
        throw new Error(`Markets API failed: HTTP ${marketsRes.status}`);
      }

      const marketsData = await marketsRes.json();

      const marketList = Array.isArray(marketsData.markets)
        ? (marketsData.markets as Market[])
        : [];
      setMarkets(marketList);
      setFactoryConfigured(Boolean(marketsData.factoryConfigured));
      setFactoryAddress(marketsData.factoryAddress ?? null);
      if (showLoading) setLoading(false);

      const leaderboardPromise = fetchWithTimeout("/api/leaderboard", 8_000)
        .then(async (res) => {
          if (!res.ok) return { leaderboard: [] };
          return await res.json();
        })
        .then((data) =>
          setLeaderboard(Array.isArray(data.leaderboard) ? data.leaderboard : [])
        )
        .catch(() => {
          setLeaderboard([]);
        });

      const detailResults = await Promise.allSettled(
        marketList.map(async (market) => {
          const res = await fetchWithTimeout(`/api/markets/${market.id}`, 8_000);
          if (!res.ok) {
            return {
              id: market.id,
              predictions: [],
              weightedProbability: null,
              latestAgentTake: null,
            };
          }
          const data = await res.json();
          return {
            id: market.id,
            predictions: Array.isArray(data.predictions) ? data.predictions : [],
            weightedProbability:
              typeof data.weightedProbability === "number"
                ? data.weightedProbability
                : null,
            latestAgentTake: data.latestAgentTake ?? null,
          };
        })
      );
      await leaderboardPromise;

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
      setLastUpdatedAt(Date.now());
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

  useEffect(() => {
    loadData(true);
  }, [loadData]);

  const triggerTick = useCallback(async () => {
    try {
      const response = await fetch("/api/agent-loop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "tick" }),
      });
      if (response.ok) {
        await loadData(false);
      }
    } catch {
      // Tick failed, next cycle will retry.
    }
  }, [loadData]);

  useEffect(() => {
    if (autonomousMode) {
      const runTick = async () => {
        await triggerTick();
        setNextTickAt(Date.now() + 60_000);
      };
      runTick();
      pollingRef.current = setInterval(runTick, 60_000);
    } else {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      setNextTickAt(null);
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [autonomousMode, triggerTick]);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const [loopRes, metricsRes] = await Promise.all([
          fetch("/api/agent-loop", { cache: "no-store" }),
          fetch("/api/metrics?limit=200", { cache: "no-store" }),
        ]);

        if (loopRes.ok) {
          const loopData = await loopRes.json();
          setLoopStatus(loopData.status ?? null);
          setLoopActions(Array.isArray(loopData.actions) ? loopData.actions : []);
        }

        if (metricsRes.ok) {
          const metricsData = (await metricsRes.json()) as AgentMetricsSnapshot;
          setMetrics(metricsData);
          setMetricsError(null);
        } else {
          setMetricsError(`HTTP ${metricsRes.status}`);
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
    if (!nextTickAt) {
      setNextTickIn(null);
      return;
    }
    const update = () => {
      const diff = Math.max(0, Math.ceil((nextTickAt - Date.now()) / 1000));
      setNextTickIn(diff);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [nextTickAt]);

  useEffect(() => {
    if (!autonomousMode) return;
    try {
      const dismissed = localStorage.getItem("autonomous-banner-dismissed");
      if (!dismissed) setShowAutoBanner(true);
    } catch {
      // Ignore storage errors.
    }
  }, [autonomousMode]);

  const toggleAutonomousMode = useCallback(() => {
    setLoopToggling(true);
    setAutonomousMode((prev) => !prev);
    setLoopToggling(false);
  }, []);

  const dismissAutoBanner = useCallback(() => {
    setShowAutoBanner(false);
    try {
      localStorage.setItem("autonomous-banner-dismissed", "1");
    } catch {
      // Ignore storage errors.
    }
  }, []);

  const handleAgentSpawned = useCallback((agent: SerializedSpawnedAgent) => {
    setSpawnedAgents((prev) => [...prev, agent]);
    fetch("/api/leaderboard")
      .then((r) => r.json())
      .then((data) => setLeaderboard(Array.isArray(data.leaderboard) ? data.leaderboard : []))
      .catch(() => {});
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
      ) {
        return false;
      }
      if (activeCategory === "all") return true;
      return categorizeMarket(market.question) === activeCategory;
    });
  }, [markets, normalizedQuery, activeCategory]);

  const sortedMarkets = useMemo(() => {
    return [...filteredMarkets].sort((a, b) => {
      if (sortBy === "ending") {
        return a.resolutionTime - b.resolutionTime;
      }

      if (sortBy === "disagreement") {
        const disagreeA = computeDisagreement(predictions[a.id] ?? []);
        const disagreeB = computeDisagreement(predictions[b.id] ?? []);
        return disagreeB - disagreeA;
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
    ],
    [categoryCounts]
  );

  const analyzeMarket = markets.find((m) => m.id === analyzeMarketId);
  const betMarket = markets.find((m) => m.id === betMarketId);

  return (
    <div className="min-h-screen bg-cream bg-grid relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute -top-24 right-[-10%] w-72 h-72 rounded-full bg-neo-green/10 blur-3xl" />
        <div className="absolute top-1/3 left-[-15%] w-80 h-80 rounded-full bg-neo-purple/10 blur-3xl" />
        <div className="absolute bottom-[-15%] right-1/4 w-96 h-96 rounded-full bg-neo-pink/10 blur-3xl" />
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
        onToggleAutonomousMode={toggleAutonomousMode}
        onOpenSpawner={() => setShowSpawner(true)}
        onOpenCreator={() => setShowCreator(true)}
      />

      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6">
        {loadError && (
          <div
            className="neo-card p-4 mb-4 border border-neo-pink/40 bg-neo-pink/10"
            role="alert"
            aria-live="assertive"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-heading font-bold text-sm text-neo-pink">Data sync failed</p>
                <p className="text-[11px] text-white/70 mt-0.5">{loadError}</p>
              </div>
              <button
                type="button"
                onClick={refreshData}
                disabled={isRefreshing}
                className="neo-btn-secondary text-xs px-3 py-1.5 border-neo-pink/40 text-neo-pink disabled:opacity-60"
              >
                {isRefreshing ? "Retrying..." : "Retry"}
              </button>
            </div>
          </div>
        )}

        {showAutoBanner && (
          <div className="neo-card p-4 mb-6 flex items-start justify-between gap-4" role="status">
            <div>
              <p className="font-heading font-bold text-sm mb-1">Autonomous mode enabled</p>
              <p className="text-[11px] text-white/50">
                The agent loop will research, forecast, and place bets on your behalf.
                It can also auto-create new markets when the factory is deployed.
              </p>
            </div>
            <button
              type="button"
              onClick={dismissAutoBanner}
              className="neo-btn-secondary text-[10px] px-3 py-1"
            >
              Got it
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-6 items-start">
          <MarketsDomainSection
            loading={loading}
            markets={markets}
            sortedMarkets={sortedMarkets}
            predictions={predictions}
            weightedProbs={weightedProbs}
            latestTakes={latestTakes}
            categoryTabs={categoryTabs}
            activeCategory={activeCategory}
            searchQuery={searchQuery}
            sortBy={sortBy}
            isRefreshing={isRefreshing}
            loopActions={loopActions}
            normalizedQuery={normalizedQuery}
            factoryConfigured={factoryConfigured}
            onSetCategory={setActiveCategory}
            onSearchChange={setSearchQuery}
            onSortChange={setSortBy}
            onRefresh={refreshData}
            onAnalyze={setAnalyzeMarketId}
            onBet={setBetMarketId}
          />

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
            onSelectAgent={(agent) => setSelectedAgent(selectedAgent === agent ? null : agent)}
            onTriggerTick={triggerTick}
          />
        </div>

        <section className="mt-6" aria-labelledby="trade-log-heading">
          <h2 id="trade-log-heading" className="sr-only">
            Trade Activity Log
          </h2>
          <TradeLog isLoopRunning={autonomousMode} />
        </section>
      </main>

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
          onClose={() => setBetMarketId(null)}
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
