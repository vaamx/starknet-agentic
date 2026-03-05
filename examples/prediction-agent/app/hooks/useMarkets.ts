"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AgentPrediction,
  LatestAgentTake,
  Market,
} from "../components/dashboard/types";

const DASHBOARD_CACHE_KEY = "prediction-dashboard-cache-v1";
const MARKET_DETAIL_FETCH_LIMIT = 10;

interface CachedDashboard {
  markets?: Market[];
  predictions?: Record<number, AgentPrediction[]>;
  weightedProbs?: Record<number, number | null>;
  latestTakes?: Record<number, LatestAgentTake | null>;
  lastUpdatedAt?: number;
  stale?: boolean;
  source?: "onchain" | "cache";
}

export interface UseMarketsReturn {
  markets: Market[];
  predictions: Record<number, AgentPrediction[]>;
  weightedProbs: Record<number, number | null>;
  latestTakes: Record<number, LatestAgentTake | null>;
  loading: boolean;
  loadError: string | null;
  isRefreshing: boolean;
  refreshData: () => Promise<void>;
  marketDataSource: "onchain" | "cache" | "unknown";
  marketDataStale: boolean;
  marketDataWarning: string | null;
  survivalTier: string | null;
  agentWalletAddress: string | null;
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number
): Promise<Response | null> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    return await Promise.race([fetch(url, { cache: "no-store" }), timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export default function useMarkets(): UseMarketsReturn {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [predictions, setPredictions] = useState<
    Record<number, AgentPrediction[]>
  >({});
  const [weightedProbs, setWeightedProbs] = useState<
    Record<number, number | null>
  >({});
  const [latestTakes, setLatestTakes] = useState<
    Record<number, LatestAgentTake | null>
  >({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [marketDataSource, setMarketDataSource] = useState<
    "onchain" | "cache" | "unknown"
  >("unknown");
  const [marketDataStale, setMarketDataStale] = useState(false);
  const [marketDataWarning, setMarketDataWarning] = useState<string | null>(
    null
  );
  const [survivalTier, setSurvivalTier] = useState<string | null>(null);
  const [agentWalletAddress, setAgentWalletAddress] = useState<string | null>(
    null
  );

  const hasWarmCacheRef = useRef(false);
  const currentMarketCountRef = useRef(0);

  useEffect(() => {
    currentMarketCountRef.current = markets.length;
  }, [markets.length]);

  // Hydrate from localStorage on mount
  useEffect(() => {
    try {
      const cached = localStorage.getItem(DASHBOARD_CACHE_KEY);
      if (!cached) return;
      const parsed: CachedDashboard = JSON.parse(cached);
      if (Array.isArray(parsed.markets) && parsed.markets.length > 0) {
        hasWarmCacheRef.current = true;
        setMarkets(parsed.markets);
        setPredictions(parsed.predictions ?? {});
        setWeightedProbs(parsed.weightedProbs ?? {});
        setLatestTakes(parsed.latestTakes ?? {});
        setMarketDataSource(parsed.source ?? "cache");
        setMarketDataStale(Boolean(parsed.stale));
        setLoading(false);
      }
    } catch {}
  }, []);

  const loadData = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setLoadError(null);

    try {
      const marketsRes = await fetchWithTimeout(
        "/api/markets?status=open&limit=20&hideEmpty=true",
        8_000
      );
      if (!marketsRes)
        throw new Error("Markets request timed out — showing cached data");
      if (!marketsRes.ok)
        throw new Error(`Markets API failed: HTTP ${marketsRes.status}`);

      const marketsData = await marketsRes.json();
      const marketList = Array.isArray(marketsData.markets)
        ? (marketsData.markets as Market[])
        : [];
      setMarkets(marketList);
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

      // Fetch market details + survival in parallel
      const [detailResults, survivalRes] = await Promise.all([
        Promise.allSettled(
          marketList
            .slice(0, MARKET_DETAIL_FETCH_LIMIT)
            .map(async (market) => {
              const res = await fetchWithTimeout(
                `/api/markets/${market.id}`,
                5_000
              );
              if (!res || !res.ok) {
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
                predictions: Array.isArray(data.predictions)
                  ? data.predictions
                  : [],
                weightedProbability:
                  typeof data.weightedProbability === "number"
                    ? data.weightedProbability
                    : null,
                latestAgentTake: data.latestAgentTake ?? null,
              };
            })
        ),
        fetchWithTimeout("/api/survival", 4_000).catch(() => null),
      ]);

      // Process survival
      if (survivalRes && survivalRes.ok) {
        const survivalData = await survivalRes.json();
        setSurvivalTier(survivalData.tier ?? null);
        setAgentWalletAddress(survivalData.agentAddress ?? null);
      }

      // Process market details
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

      // Persist to cache
      try {
        localStorage.setItem(
          DASHBOARD_CACHE_KEY,
          JSON.stringify({
            markets: marketList,
            predictions: predsMap,
            weightedProbs: weightedMap,
            latestTakes: latestMap,
            lastUpdatedAt: Date.now(),
            stale: Boolean(marketsData.stale),
            source:
              marketsData.source === "onchain" || marketsData.source === "cache"
                ? marketsData.source
                : "unknown",
          })
        );
      } catch {}
    } catch (err: any) {
      const message = err?.message ?? "Failed to load dashboard data";
      const hasCachedData =
        hasWarmCacheRef.current || currentMarketCountRef.current > 0;
      if (hasCachedData) {
        setLoadError(null);
        setMarketDataStale(true);
        setMarketDataSource((prev) => (prev === "unknown" ? "cache" : prev));
        setMarketDataWarning(message);
      } else {
        setLoadError(message);
      }
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  const refreshData = useCallback(async () => {
    setIsRefreshing(true);
    await loadData(false);
  }, [loadData]);

  // Fetch fresh data on mount
  useEffect(() => {
    loadData(!hasWarmCacheRef.current);
  }, [loadData]);

  return {
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
  };
}
