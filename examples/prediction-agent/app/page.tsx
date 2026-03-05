"use client";

import { useState, useEffect, useCallback } from "react";
import MarketCard from "./components/MarketCard";
import AgentLeaderboard from "./components/AgentLeaderboard";
import BetForm from "./components/BetForm";
import TradeLog from "./components/TradeLog";
import AgentIdentityCard from "./components/AgentIdentityCard";
import MarketCreator from "./components/MarketCreator";
import AgentActivityFeed from "./components/AgentActivityFeed";
import AgentSpawnerForm from "./components/AgentSpawnerForm";
import AnalyzeModal from "./components/AnalyzeModal";
import WalletConnect from "./components/WalletConnect";
import MarketLifecycleModal from "./components/MarketLifecycleModal";
import QuantAnalyticsPanel from "./components/QuantAnalyticsPanel";

interface Market {
  id: number;
  question: string;
  address: string;
  impliedProbYes: number;
  impliedProbNo: number;
  totalPool: string;
  yesPool: string;
  noPool: string;
  status: number;
  resolutionTime: number;
  feeBps: number;
  collateralToken: string;
  winningOutcome?: number;
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
  } | null;
}

interface AgentPrediction {
  agent: string;
  marketId: number;
  predictedProb: number;
  brierScore: number;
  predictionCount: number;
}

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
  const [markets, setMarkets] = useState<Market[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [predictions, setPredictions] = useState<
    Record<number, AgentPrediction[]>
  >({});
  const [analyzeMarketId, setAnalyzeMarketId] = useState<number | null>(null);
  const [betMarketId, setBetMarketId] = useState<number | null>(null);
  const [showCreator, setShowCreator] = useState(false);
  const [showSpawner, setShowSpawner] = useState(false);
  const [lifecycleAction, setLifecycleAction] = useState<{
    marketId: number;
    action: "resolve" | "finalize" | "claim";
  } | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [autonomousMode, setAutonomousMode] = useState(false);
  const [loopToggling, setLoopToggling] = useState(false);
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [sessionContext, setSessionContext] = useState<SessionContext | null>(null);
  const [analytics, setAnalytics] = useState<QuantAnalytics | null>(null);
  const [calibrationByModel, setCalibrationByModel] = useState<
    ModelCalibrationComparisonRow[]
  >([]);

  const loadData = useCallback(async () => {
    try {
      const [marketsRes, leaderboardRes] = await Promise.all([
        fetch("/api/markets"),
        fetch("/api/leaderboard"),
      ]);

      if (marketsRes.status === 401 || leaderboardRes.status === 401) {
        window.location.href = "/login";
        return;
      }

      const marketsData = await marketsRes.json();
      const leaderboardData = await leaderboardRes.json();

      setMarkets(marketsData.markets ?? []);
      setLeaderboard(leaderboardData.leaderboard ?? []);

      const predsMap: Record<number, AgentPrediction[]> = {};
      for (const market of marketsData.markets ?? []) {
        try {
          const res = await fetch(`/api/markets/${market.id}`);
          const data = await res.json();
          predsMap[market.id] = data.predictions ?? [];
        } catch {
          predsMap[market.id] = [];
        }
      }
      setPredictions(predsMap);
    } catch (err) {
      console.error("Failed to load data:", err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    fetch("/api/me/context")
      .then((r) => r.json())
      .then((data) => {
        if (data?.user) {
          setSessionUser(data.user);
          setSessionContext(data);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/analytics/overview")
      .then((r) => r.json())
      .then((data) => {
        if (data?.analytics) {
          setAnalytics(data.analytics);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/analytics/calibration-models")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data?.rows)) {
          setCalibrationByModel(data.rows);
        }
      })
      .catch(() => {});
  }, []);

  // Check loop status on mount
  useEffect(() => {
    fetch("/api/agent-loop")
      .then((r) => r.json())
      .then((data) => {
        if (data.status?.isRunning) setAutonomousMode(true);
      })
      .catch(() => {});
  }, []);

  const toggleAutonomousMode = async () => {
    setLoopToggling(true);
    try {
      const action = autonomousMode ? "stop" : "start";
      const res = await fetch("/api/agent-loop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, intervalMs: 60_000 }), // 1 min for demo
      });
      const data = await res.json();
      if (data.ok) {
        setAutonomousMode(!autonomousMode);
      }
    } catch (err) {
      console.error("Failed to toggle loop:", err);
    }
    setLoopToggling(false);
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/login";
    }
  };

  const analyzeMarket = markets.find((m) => m.id === analyzeMarketId);
  const betMarket = markets.find((m) => m.id === betMarketId);
  const selectedEntry = leaderboard.find((e) => e.agent === selectedAgent);

  return (
    <div className="min-h-screen bg-cream bg-grid">
      {/* ═══ Header ═══ */}
      <header className="border-b-2 border-black bg-white sticky top-0 z-50">
        <div className="max-w-[1400px] mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Logo mark */}
            <div className="w-8 h-8 bg-neo-dark border-2 border-black flex items-center justify-center">
              <span className="text-neo-green font-mono font-black text-sm">
                AP
              </span>
            </div>
            <div>
              <h1 className="font-heading font-bold text-lg tracking-tight leading-none">
                Agentic Predictions
              </h1>
              <p className="text-[10px] font-mono text-gray-400 tracking-wider uppercase mt-0.5">
                AI Superforecasters on Starknet
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Autonomous Mode Toggle */}
            <button
              onClick={toggleAutonomousMode}
              disabled={loopToggling}
              className={`flex items-center gap-2 px-3 py-1.5 border-2 text-xs font-mono transition-colors ${
                autonomousMode
                  ? "border-neo-green bg-neo-green/10 text-neo-green"
                  : "border-gray-300 text-gray-500 hover:border-gray-400"
              } ${loopToggling ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  autonomousMode
                    ? "bg-neo-green animate-pulse"
                    : "bg-gray-300"
                }`}
              />
              {loopToggling
                ? "..."
                : autonomousMode
                  ? "Autonomous ON"
                  : "Autonomous OFF"}
            </button>

            {/* Spawn Agent */}
            <button
              onClick={() => setShowSpawner(true)}
              className="neo-btn-primary text-xs py-2 px-4 bg-neo-purple border-2 border-black text-white hover:bg-neo-purple/90"
            >
              + Spawn Agent
            </button>

            {/* Wallet */}
            <WalletConnect />

            {sessionUser && (
              <div className="hidden lg:flex items-center gap-2 border-2 border-black bg-white px-2.5 py-1.5">
                <span className="text-[11px] font-mono text-gray-500">
                  {sessionUser.name}
                </span>
                {sessionContext && (
                  <span className="text-[10px] font-mono text-gray-400">
                    {sessionContext.organization.name} ({sessionContext.role})
                  </span>
                )}
                <button
                  onClick={handleLogout}
                  className="text-[10px] font-bold uppercase tracking-wide text-neo-pink hover:underline"
                >
                  Logout
                </button>
              </div>
            )}

            {/* Network indicator */}
            <div className="neo-badge bg-cream text-[10px] py-0.5 gap-1.5">
              <span className="relative w-2 h-2 rounded-full bg-neo-green pulse-ring" />
              <span className="font-mono">Sepolia</span>
            </div>

            <button
              onClick={() => setShowCreator(true)}
              className="neo-btn-primary text-xs py-2 px-4"
            >
              + New Market
            </button>
          </div>
        </div>
      </header>

      {/* ═══ Stats Bar ═══ */}
      <div className="border-b-2 border-black bg-neo-dark text-white">
        <div className="max-w-[1400px] mx-auto px-6 py-2 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Stat label="Markets" value={markets.length.toString()} />
            <Stat
              label="Total Volume"
              value={formatVolume(markets)}
              accent
            />
            <Stat label="Active Agents" value={leaderboard.length.toString()} />
            {autonomousMode && (
              <Stat label="Mode" value="AUTONOMOUS" accent />
            )}
          </div>
          <div className="flex items-center gap-4 text-[10px] font-mono text-white/30">
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

      <main className="max-w-[1400px] mx-auto px-6 py-6">
        {/* ═══ Main Grid: Markets + Sidebar ═══ */}
        <div className="flex gap-6 items-start">
          {/* Left: Markets */}
          <div className="flex-1 min-w-0 space-y-4">
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-heading font-bold text-sm uppercase tracking-wider text-gray-500">
                Active Markets
              </h2>
              <span className="font-mono text-[10px] text-gray-400">
                {markets.length} markets
              </span>
            </div>

            {loading ? (
              <div className="neo-card p-16 text-center">
                <div className="inline-flex items-center gap-2">
                  <span className="w-2 h-2 bg-neo-dark rounded-full animate-bounce" />
                  <span className="w-2 h-2 bg-neo-dark rounded-full animate-bounce [animation-delay:0.1s]" />
                  <span className="w-2 h-2 bg-neo-dark rounded-full animate-bounce [animation-delay:0.2s]" />
                </div>
                <p className="font-mono text-xs text-gray-400 mt-3">
                  Loading markets...
                </p>
              </div>
            ) : markets.length === 0 ? (
              <div className="neo-card p-16 text-center">
                <div className="w-16 h-16 mx-auto mb-4 bg-neo-yellow border-2 border-black flex items-center justify-center">
                  <span className="text-3xl">?</span>
                </div>
                <p className="font-heading font-bold text-lg mb-1">
                  No markets yet
                </p>
                <p className="text-sm text-gray-500">
                  Deploy contracts to create your first prediction market.
                </p>
              </div>
            ) : (
              markets.map((market, i) => {
                const marketPreds = predictions[market.id] ?? [];
                const agentConsensus =
                  marketPreds.length > 0
                    ? marketPreds.reduce(
                        (sum, p) => sum + p.predictedProb,
                        0
                      ) / marketPreds.length
                    : undefined;

                return (
                  <div
                    key={market.id}
                    className={`animate-enter stagger-${Math.min(i + 1, 5)}`}
                  >
                    <MarketCard
                      id={market.id}
                      question={market.question}
                      impliedProbYes={market.impliedProbYes}
                      impliedProbNo={market.impliedProbNo}
                      totalPool={market.totalPool}
                      status={market.status}
                      resolutionTime={market.resolutionTime}
                      agentConsensus={agentConsensus}
                      predictions={marketPreds}
                      onAnalyze={(id) => setAnalyzeMarketId(id)}
                      onBet={(id) => setBetMarketId(id)}
                      onResolve={(id) =>
                        setLifecycleAction({ marketId: id, action: "resolve" })
                      }
                      onFinalize={(id) =>
                        setLifecycleAction({ marketId: id, action: "finalize" })
                      }
                      onClaim={(id) =>
                        setLifecycleAction({ marketId: id, action: "claim" })
                      }
                    />
                  </div>
                );
              })
            )}
          </div>

          {/* Right: Sidebar */}
          <div className="w-[320px] shrink-0 space-y-4 sticky top-20">
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
          </div>
        </div>

        {/* ═══ Agent Activity Feed ═══ */}
        <div className="mt-6">
          <QuantAnalyticsPanel
            analytics={analytics}
            calibrationByModel={calibrationByModel}
          />
        </div>

        {/* ═══ Agent Activity Feed ═══ */}
        <div className="mt-6">
          <AgentActivityFeed isLoopRunning={autonomousMode} />
        </div>

        {/* ═══ Trade Log ═══ */}
        <div className="mt-6">
          <TradeLog />
        </div>
      </main>

      {/* ═══ Modals ═══ */}
      {showSpawner && (
        <AgentSpawnerForm
          onClose={() => setShowSpawner(false)}
          onSpawned={() => {
            fetch("/api/leaderboard")
              .then((r) => r.json())
              .then((data) => setLeaderboard(data.leaderboard ?? []))
              .catch(() => {});
          }}
        />
      )}

      {showCreator && (
        <MarketCreator
          onClose={() => setShowCreator(false)}
          onCreated={loadData}
        />
      )}

      {betMarket && (
        <BetForm
          marketId={betMarket.id}
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

/* ═══ Helper Components ═══ */

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
      <span className="text-[10px] font-mono uppercase tracking-wider text-white/40">
        {label}
      </span>
      <span
        className={`font-mono font-bold text-sm tabular-nums ${
          accent ? "text-neo-yellow" : "text-white"
        }`}
      >
        {value}
      </span>
    </div>
  );
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
