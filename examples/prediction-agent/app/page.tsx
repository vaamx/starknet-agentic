"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import MarketCard from "./components/MarketCard";
import AgentLeaderboard from "./components/AgentLeaderboard";
import BetForm from "./components/BetForm";
import TradeLog from "./components/TradeLog";
import AgentIdentityCard from "./components/AgentIdentityCard";
import MarketCreator from "./components/MarketCreator";
import AgentSpawnerForm from "./components/AgentSpawnerForm";
import AnalyzeModal from "./components/AnalyzeModal";
import WalletConnect from "./components/WalletConnect";
import ResearchLab from "./components/ResearchLab";
import OpenClawConnections from "./components/OpenClawConnections";
import SwarmDialogue from "./components/SwarmDialogue";
import { STORAGE_KEY, type SerializedSpawnedAgent } from "@/lib/agent-spawner";
import {
  categorizeMarket,
  getCategoryCounts,
  type MarketCategory,
} from "@/lib/categories";

interface Market {
  id: number;
  question: string;
  address: string;
  oracle: string;
  impliedProbYes: number;
  impliedProbNo: number;
  totalPool: string;
  yesPool: string;
  noPool: string;
  status: number;
  resolutionTime: number;
  feeBps: number;
  collateralToken: string;
  tradeCount?: number;
}

interface LeaderboardEntry {
  agent: string;
  avgBrier: number;
  predictionCount: number;
  rank: number;
  identity?: {
    name: string;
    agentType: string;
    model: string;
    reputationScore: number;
    feedbackCount: number;
    framework?: string;
    a2aEndpoint?: string;
    moltbookId?: string;
  } | null;
}

interface AgentPrediction {
  agent: string;
  marketId: number;
  predictedProb: number;
  brierScore: number;
  predictionCount: number;
}

interface LoopStatus {
  isRunning: boolean;
  tickCount: number;
  lastTickAt: number | null;
  nextTickAt: number | null;
  activeAgentCount: number;
  intervalMs: number;
  onChainEnabled: boolean;
  aiEnabled: boolean;
  signerMode: "owner" | "session";
  sessionKeyConfigured: boolean;
  defiEnabled: boolean;
  defiAutoTrade: boolean;
  debateEnabled: boolean;
}

interface LatestAgentTake {
  agentName: string;
  probability: number;
  reasoning: string;
  timestamp: number;
}

export default function Dashboard() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [predictions, setPredictions] = useState<
    Record<number, AgentPrediction[]>
  >({});
  const [weightedProbs, setWeightedProbs] = useState<
    Record<number, number | null>
  >({});
  const [latestTakes, setLatestTakes] = useState<
    Record<number, LatestAgentTake | null>
  >({});
  const [factoryConfigured, setFactoryConfigured] = useState(false);
  const [factoryAddress, setFactoryAddress] = useState<string | null>(null);
  const [spawnedAgents, setSpawnedAgents] = useState<SerializedSpawnedAgent[]>([]);
  const [analyzeMarketId, setAnalyzeMarketId] = useState<number | null>(null);
  const [betMarketId, setBetMarketId] = useState<number | null>(null);
  const [showCreator, setShowCreator] = useState(false);
  const [showSpawner, setShowSpawner] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [autonomousMode, setAutonomousMode] = useState(false);
  const [loopToggling, setLoopToggling] = useState(false);
  const [activeCategory, setActiveCategory] = useState<MarketCategory>("all");
  const [sortBy, setSortBy] = useState<
    "volume" | "ending" | "disagreement"
  >("volume");
  const [nextTickAt, setNextTickAt] = useState<number | null>(null);
  const [nextTickIn, setNextTickIn] = useState<number | null>(null);
  const [showAutoBanner, setShowAutoBanner] = useState(false);
  const [loopStatus, setLoopStatus] = useState<LoopStatus | null>(null);
  const [loopActions, setLoopActions] = useState<any[]>([]);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load spawned agents from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as SerializedSpawnedAgent[];
        setSpawnedAgents(parsed);
      }
    } catch {
      // localStorage unavailable or corrupted
    }
  }, []);

  useEffect(() => {
    async function loadData() {
      try {
        const [marketsRes, leaderboardRes] = await Promise.all([
          fetch("/api/markets"),
          fetch("/api/leaderboard"),
        ]);

        const marketsData = await marketsRes.json();
        const leaderboardData = await leaderboardRes.json();

        setMarkets(marketsData.markets ?? []);
        setFactoryConfigured(Boolean(marketsData.factoryConfigured));
        setFactoryAddress(marketsData.factoryAddress ?? null);
        setLeaderboard(leaderboardData.leaderboard ?? []);

        const predsMap: Record<number, AgentPrediction[]> = {};
        const weightedMap: Record<number, number> = {};
        const latestMap: Record<number, LatestAgentTake | null> = {};
        for (const market of marketsData.markets ?? []) {
          try {
            const res = await fetch(`/api/markets/${market.id}`);
            const data = await res.json();
            predsMap[market.id] = data.predictions ?? [];
            weightedMap[market.id] =
              typeof data.weightedProbability === "number"
                ? data.weightedProbability
                : null;
            latestMap[market.id] = data.latestAgentTake ?? null;
          } catch {
            predsMap[market.id] = [];
            latestMap[market.id] = null;
          }
        }
        setPredictions(predsMap);
        setWeightedProbs(weightedMap);
        setLatestTakes(latestMap);
      } catch (err) {
        console.error("Failed to load data:", err);
      }
      setLoading(false);
    }

    loadData();
  }, []);

  // Client-driven polling: trigger agent loop tick every 60s when autonomous
  const triggerTick = useCallback(async () => {
    try {
      await fetch("/api/agent-loop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "tick" }),
      });
    } catch {
      // Tick failed, will retry next interval
    }
  }, []);

  useEffect(() => {
    if (autonomousMode) {
      const runTick = async () => {
        await triggerTick();
        setNextTickAt(Date.now() + 60_000);
      };
      // Run first tick immediately
      runTick();
      // Then poll every 60s
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
        const res = await fetch("/api/agent-loop");
        const data = await res.json();
        setLoopStatus(data.status ?? null);
        setLoopActions(data.actions ?? []);
      } catch {
        // Ignore status errors
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
      // Ignore storage errors
    }
  }, [autonomousMode]);

  const toggleAutonomousMode = () => {
    setLoopToggling(true);
    setAutonomousMode((prev) => !prev);
    setLoopToggling(false);
  };

  const dismissAutoBanner = () => {
    setShowAutoBanner(false);
    try {
      localStorage.setItem("autonomous-banner-dismissed", "1");
    } catch {
      // Ignore storage errors
    }
  };

  const handleAgentSpawned = (agent: SerializedSpawnedAgent) => {
    setSpawnedAgents((prev) => [...prev, agent]);
    // Refresh leaderboard
    fetch("/api/leaderboard")
      .then((r) => r.json())
      .then((data) => setLeaderboard(data.leaderboard ?? []))
      .catch(() => {});
  };

  const analyzeMarket = markets.find((m) => m.id === analyzeMarketId);
  const betMarket = markets.find((m) => m.id === betMarketId);
  const selectedEntry = leaderboard.find((e) => e.agent === selectedAgent);
  const categoryCounts = getCategoryCounts(markets);
  const activeAgents = loopStatus?.activeAgentCount ?? leaderboard.length;

  const filteredMarkets = markets.filter((market) => {
    if (activeCategory === "all") return true;
    return categorizeMarket(market.question) === activeCategory;
  });

  const sortedMarkets = [...filteredMarkets].sort((a, b) => {
    if (sortBy === "ending") {
      return a.resolutionTime - b.resolutionTime;
    }
    if (sortBy === "disagreement") {
      const predsA = predictions[a.id] ?? [];
      const predsB = predictions[b.id] ?? [];
      const disagreeA = computeDisagreement(predsA);
      const disagreeB = computeDisagreement(predsB);
      return disagreeB - disagreeA;
    }
    const poolA = safeBigInt(a.totalPool);
    const poolB = safeBigInt(b.totalPool);
    if (poolA === poolB) return 0;
    return poolB > poolA ? 1 : -1;
  });

  return (
    <div className="min-h-screen bg-cream bg-grid relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 right-[-10%] w-72 h-72 rounded-full bg-neo-green/10 blur-3xl" />
        <div className="absolute top-1/3 left-[-15%] w-80 h-80 rounded-full bg-neo-purple/10 blur-3xl" />
        <div className="absolute bottom-[-15%] right-1/4 w-96 h-96 rounded-full bg-neo-pink/10 blur-3xl" />
      </div>
      {/* Header */}
      <header className="border-b border-white/10 bg-neo-dark/70 backdrop-blur sticky top-0 z-50">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3 sm:gap-4">
            {/* Logo mark */}
            <div className="w-9 h-9 bg-neo-green/15 border border-neo-green/30 flex items-center justify-center shrink-0 rounded-lg glow-ring">
              <span className="text-neo-green font-mono font-black text-sm">
                BS
              </span>
            </div>
            <div>
              <h1 className="font-heading font-bold text-base sm:text-lg tracking-tight leading-none text-white">
                BitSage Swarm
              </h1>
              <p className="text-[10px] font-mono text-white/40 tracking-wider uppercase mt-0.5 hidden sm:block">
                Superforecasting mesh for real on-chain markets
              </p>
            </div>
          </div>

          <div className="flex items-center flex-wrap gap-2 sm:gap-3 justify-end">
            {/* Autonomous Mode Toggle */}
            <div className="relative group flex items-center gap-2">
              <button
                onClick={toggleAutonomousMode}
                disabled={loopToggling}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-mono transition-colors ${
                  autonomousMode
                    ? "border-neo-green/50 bg-neo-green/10 text-neo-green"
                    : "border-white/20 text-white/50 hover:border-white/40"
                } ${loopToggling ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    autonomousMode
                      ? "bg-neo-green animate-pulse"
                      : "bg-white/30"
                  }`}
                />
                {loopToggling
                  ? "..."
                  : autonomousMode
                    ? "Autonomous ON"
                    : "Autonomous OFF"}
              </button>
              <span className="w-5 h-5 flex items-center justify-center border border-white/20 text-[10px] font-mono text-white/50 bg-white/5 rounded-full">
                ?
              </span>
              <div className="absolute right-0 top-full mt-2 w-64 text-[10px] text-white/70 bg-neo-dark/90 border border-white/10 p-2 shadow-neo hidden group-hover:block rounded-lg">
                Runs the agent loop every 60s to research markets, record
                predictions, place bets, and auto-create new markets when
                configured.
              </div>
            </div>
            {autonomousMode && nextTickIn !== null && (
              <span className="text-[10px] font-mono text-white/50">
                Next tick in {nextTickIn}s
              </span>
            )}

            {/* Spawn Agent */}
            <button
              onClick={() => setShowSpawner(true)}
              className="neo-btn-secondary text-xs py-2 px-4 border-neo-purple/30 text-neo-purple hidden sm:flex"
            >
              + Spawn Agent
            </button>

            {/* Wallet */}
            <div>
              <WalletConnect />
            </div>

            {/* Network indicator */}
            <div className="neo-badge bg-white/5 text-[10px] py-0.5 gap-1.5">
              <span className="relative w-2 h-2 rounded-full bg-neo-green pulse-ring" />
              <span className="font-mono">Sepolia</span>
            </div>

            <button
              onClick={() => setShowCreator(true)}
              className="neo-btn-primary text-xs py-2 px-4 hidden sm:flex"
            >
              + New Market
            </button>
          </div>
        </div>
      </header>

      {/* Stats Bar */}
      <div className="border-b border-white/10 bg-neo-dark/60 text-white">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-2 flex items-center justify-between">
          <div className="flex flex-wrap items-center gap-3 sm:gap-6">
            <Stat label="Markets" value={markets.length.toString()} />
            <Stat
              label="Total Volume"
              value={formatVolume(markets)}
              accent
            />
            <Stat label="Agents" value={activeAgents.toString()} />
            {spawnedAgents.length > 0 && (
              <Stat label="Custom Agents" value={spawnedAgents.length.toString()} />
            )}
            {autonomousMode && (
              <Stat label="Mode" value="AUTONOMOUS" accent />
            )}
          </div>
          <div className="hidden md:flex items-center gap-4 text-[10px] font-mono text-white/30">
            <span>ERC-8004</span>
            <span>|</span>
            <span>Agent Account</span>
            <span>|</span>
            <span>MCP</span>
            <span>|</span>
            <span>Data Sources</span>
          </div>
        </div>
      </div>

      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6">
        {showAutoBanner && (
          <div className="neo-card p-4 mb-6 flex items-start justify-between gap-4">
            <div>
              <p className="font-heading font-bold text-sm mb-1">
                Autonomous mode enabled
              </p>
              <p className="text-[11px] text-white/50">
                The agent loop will research, forecast, and place bets on your
                behalf. It can also auto-create new markets when the factory is
                deployed.
              </p>
            </div>
            <button
              onClick={dismissAutoBanner}
              className="neo-btn-secondary text-[10px] px-3 py-1"
            >
              Got it
            </button>
          </div>
        )}
        {/* Main Grid: Markets + Sidebar */}
        <div className="flex flex-col lg:flex-row gap-6 items-start">
          {/* Left: Markets */}
          <div className="flex-1 min-w-0 space-y-4">
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-heading font-bold text-sm uppercase tracking-wider text-white/50">
                Active Markets
              </h2>
              <span className="font-mono text-[10px] text-white/40">
                {markets.length} markets
              </span>
            </div>

            {loopActions.length > 0 && (
              <div className="neo-card px-4 py-3 mb-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-neo-green animate-pulse" />
                      <p className="text-[10px] font-mono uppercase tracking-widest text-white/40">
                        Swarm Pulse
                      </p>
                    </div>
                    <p className="text-xs text-white/80 mt-0.5">
                      {loopActions.slice(-1)[0]?.detail ?? ""}
                    </p>
                  </div>
                  <span className="text-[10px] font-mono text-neo-green/80">
                    LIVE
                  </span>
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                {[
                  { id: "all", label: "All", count: categoryCounts.all },
                  { id: "sports", label: "Sports", count: categoryCounts.sports },
                  { id: "crypto", label: "Crypto", count: categoryCounts.crypto },
                  { id: "politics", label: "Politics", count: categoryCounts.politics },
                  { id: "tech", label: "Tech", count: categoryCounts.tech },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveCategory(tab.id as MarketCategory)}
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

              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-white/40 uppercase tracking-wider">
                  Sort
                </span>
                <select
                  value={sortBy}
                  onChange={(e) =>
                    setSortBy(e.target.value as "volume" | "ending" | "disagreement")
                  }
                  className="neo-input text-[10px] py-1.5 px-2"
                >
                  <option value="volume">Volume</option>
                  <option value="ending">Ending Soon</option>
                  <option value="disagreement">Agent Disagreement</option>
                </select>
              </div>
            </div>

            {loading ? (
              <div className="neo-card p-16 text-center">
                <div className="inline-flex items-center gap-2">
                  <span className="w-2 h-2 bg-neo-green rounded-full animate-bounce" />
                  <span className="w-2 h-2 bg-neo-green rounded-full animate-bounce [animation-delay:0.1s]" />
                  <span className="w-2 h-2 bg-neo-green rounded-full animate-bounce [animation-delay:0.2s]" />
                </div>
                <p className="font-mono text-xs text-white/50 mt-3">
                  Loading markets...
                </p>
              </div>
            ) : markets.length === 0 ? (
              <div className="neo-card p-16 text-center">
                <div className="w-16 h-16 mx-auto mb-4 bg-neo-yellow/20 border border-neo-yellow/30 flex items-center justify-center rounded-2xl text-neo-yellow">
                  <span className="text-3xl">?</span>
                </div>
                <p className="font-heading font-bold text-lg mb-1">
                  No markets yet
                </p>
                <p className="text-sm text-white/50">
                  {factoryConfigured
                    ? "Autonomous mode can auto-create the first market once the factory is live."
                    : "Market factory not configured — deploy contracts to begin."}
                </p>
              </div>
            ) : sortedMarkets.length === 0 ? (
              <div className="neo-card p-12 text-center">
                <p className="font-heading font-bold text-base mb-1">
                  No markets in this category
                </p>
                <p className="text-sm text-white/50">
                  Try a different category or create a new market.
                </p>
              </div>
            ) : (
              sortedMarkets.map((market, i) => {
                const marketPreds = predictions[market.id] ?? [];
                const agentConsensus =
                  marketPreds.length > 0
                    ? marketPreds.reduce(
                        (sum, p) => sum + p.predictedProb,
                        0
                      ) / marketPreds.length
                    : undefined;
                const category = categorizeMarket(market.question);

                return (
                  <div
                    key={market.id}
                    className={`animate-enter stagger-${Math.min(i + 1, 5)}`}
                  >
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
                      onAnalyze={(id) => setAnalyzeMarketId(id)}
                      onBet={(id) => setBetMarketId(id)}
                    />
                  </div>
                );
              })
            )}
          </div>

          {/* Right: Sidebar */}
          <div className="w-full lg:w-[320px] lg:shrink-0 space-y-4 lg:sticky lg:top-20">
            <div className="neo-card overflow-hidden">
              <div className="bg-white/5 px-4 py-3.5 border-b border-white/10">
                <div className="flex items-center justify-between">
                  <h2 className="font-heading font-bold text-white text-sm tracking-tight">
                    Autonomous Engine
                  </h2>
                  <span className="font-mono text-[10px] text-neo-green/70 tracking-wider">
                    PULSE
                  </span>
                </div>
              </div>
              <div className="p-4 text-[11px] text-white/60 space-y-2">
                <div className="flex items-center justify-between">
                  <span>On-chain</span>
                  <span className={`font-mono ${loopStatus?.onChainEnabled ? "text-neo-green" : "text-neo-pink"}`}>
                    {loopStatus?.onChainEnabled ? "ENABLED" : "OFFLINE"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Factory</span>
                  <span className={`font-mono ${factoryConfigured ? "text-neo-green" : "text-neo-pink"}`}>
                    {factoryConfigured ? "READY" : "MISSING"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>AI Model</span>
                  <span className={`font-mono ${loopStatus?.aiEnabled ? "text-neo-green" : "text-neo-pink"}`}>
                    {loopStatus?.aiEnabled ? "ENABLED" : "MISSING KEY"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Signer</span>
                  <span className="font-mono text-white/80">
                    {loopStatus?.signerMode?.toUpperCase() ?? "--"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Session Key</span>
                  <span className={`font-mono ${loopStatus?.sessionKeyConfigured ? "text-neo-green" : "text-neo-pink"}`}>
                    {loopStatus?.sessionKeyConfigured ? "READY" : "MISSING"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>DeFi Pulse</span>
                  <span className={`font-mono ${loopStatus?.defiEnabled ? "text-neo-green" : "text-white/40"}`}>
                    {loopStatus?.defiEnabled ? (loopStatus?.defiAutoTrade ? "AUTO" : "OBSERVE") : "OFF"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Debate Mode</span>
                  <span className={`font-mono ${loopStatus?.debateEnabled ? "text-neo-green" : "text-white/40"}`}>
                    {loopStatus?.debateEnabled ? "LIVE" : "OFF"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Last tick</span>
                  <span className="font-mono">
                    {loopStatus?.lastTickAt ? timeAgo(loopStatus.lastTickAt) : "--"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Next tick</span>
                  <span className="font-mono">
                    {autonomousMode && nextTickIn !== null ? `${nextTickIn}s` : "--"}
                  </span>
                </div>
                <div className="pt-2 border-t border-white/10">
                  <p className="text-[10px] text-white/40">
                    Runs research → forecasts → on-chain predictions/bets and auto-creates new markets every 5 ticks.
                  </p>
                </div>
                <button
                  onClick={triggerTick}
                  className="neo-btn-secondary w-full text-xs mt-2"
                >
                  Run One Tick
                </button>
                {factoryAddress && (
                  <p className="text-[9px] text-white/30 mt-1 truncate">
                    Factory: {factoryAddress}
                  </p>
                )}
                {loopActions.length > 0 && (
                  <div className="pt-2 border-t border-white/10">
                    <p className="text-[10px] text-white/40 mb-1">Last action</p>
                    <p className="font-mono text-[11px] text-white/70">
                      {loopActions.slice(-1)[0]?.detail ?? "—"}
                    </p>
                  </div>
                )}
              </div>
            </div>

            <SwarmDialogue isLoopRunning={autonomousMode} />

            <ResearchLab />

            <OpenClawConnections />

            <AgentLeaderboard
              entries={leaderboard}
              selectedAgent={selectedAgent}
              onSelectAgent={(agent) =>
                setSelectedAgent(
                  selectedAgent === agent ? null : agent
                )
              }
            />

            {selectedEntry && (
              <AgentIdentityCard
                agent={selectedEntry.agent}
                avgBrier={selectedEntry.avgBrier}
                predictionCount={selectedEntry.predictionCount}
                rank={selectedEntry.rank}
                identity={selectedEntry.identity}
              />
            )}

            {/* Spawned Agents Summary */}
            {spawnedAgents.length > 0 && (
              <div className="neo-card overflow-hidden">
                <div className="bg-white/5 px-4 py-2.5 border-b border-white/10">
                  <h3 className="font-heading font-bold text-white text-xs uppercase tracking-wider">
                    Your Custom Agents
                  </h3>
                </div>
                <div className="divide-y divide-white/10">
                  {spawnedAgents.map((agent) => (
                    <div
                      key={agent.id}
                      className="px-4 py-2.5 flex items-center justify-between"
                    >
                      <div>
                        <p className="font-mono text-xs font-medium text-white/90">
                          {agent.name}
                        </p>
                        <p className="text-[9px] text-white/40">
                          {agent.agentType} · {agent.budgetStrk} STRK
                        </p>
                      </div>
                      <span
                        className={`text-[9px] font-mono px-1.5 py-0.5 border ${
                          agent.status === "running"
                            ? "border-neo-green/30 text-neo-green bg-neo-green/10"
                            : "border-white/10 text-white/40"
                        }`}
                      >
                        {agent.status.toUpperCase()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Activity Feed */}
        <div className="mt-6">
          <TradeLog isLoopRunning={autonomousMode} />
        </div>
      </main>

      {/* Modals */}
      {showSpawner && (
        <AgentSpawnerForm
          onClose={() => setShowSpawner(false)}
          onSpawned={handleAgentSpawned}
        />
      )}

      {showCreator && (
        <MarketCreator onClose={() => setShowCreator(false)} />
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

/* Helper Components */

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-mono uppercase tracking-wider text-white/50">
        {label}
      </span>
      <span
        className={`font-mono font-bold text-sm tabular-nums ${
          accent ? "text-neo-green" : "text-white"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function safeBigInt(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function computeDisagreement(preds: AgentPrediction[]): number {
  if (preds.length === 0) return 0;
  const mean =
    preds.reduce((sum, p) => sum + p.predictedProb, 0) / preds.length;
  const variance =
    preds.reduce((sum, p) => sum + (p.predictedProb - mean) ** 2, 0) /
    preds.length;
  return Math.sqrt(variance);
}

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function formatVolume(markets: { totalPool: string }[]): string {
  const total = markets.reduce((sum, m) => {
    try {
      return sum + Number(BigInt(m.totalPool)) / 1e18;
    } catch {
      return sum;
    }
  }, 0);
  if (total >= 1000) return `${(total / 1000).toFixed(1)}K STRK`;
  return `${total.toLocaleString(undefined, { maximumFractionDigits: 0 })} STRK`;
}
