"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import SimpleHeader from "../components/SimpleHeader";
import CategoryNav from "../components/CategoryNav";
import FeaturedHero from "../components/FeaturedHero";
import MarketList from "../components/MarketList";
import BetForm from "../components/BetForm";
import AnalyzeModal from "../components/AnalyzeModal";
import MarketCreator from "../components/MarketCreator";
import AuthModal, { type AuthModalMode } from "../components/AuthModal";
import Footer from "../components/Footer";
import useMarkets from "../hooks/useMarkets";
import { computeDisagreement, safeBigInt } from "../components/dashboard/utils";
import {
  categorizeMarket,
  estimateEngagementScore,
  getCategoryCounts,
} from "@/lib/categories";
import type { MarketCategory } from "../components/dashboard/types";

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

interface SessionResponse {
  configured?: boolean;
  authenticated?: boolean;
  walletAddress?: string;
  expiresAt?: number;
  scopes?: string[];
  userAuthenticated?: boolean;
  user?: SessionUser;
  organization?: SessionContext["organization"] | null;
  role?: SessionContext["role"] | null;
}

type ManualAuthScope = "spawn" | "fund" | "tick";

interface WalletSessionState {
  configured: boolean;
  authenticated: boolean;
  walletAddress: string | null;
  expiresAt: number | null;
  scopes: ManualAuthScope[];
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
  const [sessionContext, setSessionContext] = useState<SessionContext | null>(
    null
  );
  const [walletSession, setWalletSession] = useState<WalletSessionState>({
    configured: true,
    authenticated: false,
    walletAddress: null,
    expiresAt: null,
    scopes: [],
  });
  const [sessionLoading, setSessionLoading] = useState(true);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<AuthModalMode>("signin");
  const [pendingCreatorAfterAuth, setPendingCreatorAfterAuth] = useState(false);
  const [pendingBetAfterAuth, setPendingBetAfterAuth] = useState<{
    marketId: number;
    outcome?: 0 | 1;
  } | null>(null);
  const [agentSweepBusy, setAgentSweepBusy] = useState(false);
  const [agentSweepMessage, setAgentSweepMessage] = useState<string | null>(
    null
  );

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

  const parseSessionContext = useCallback((payload: SessionResponse): SessionContext | null => {
    if (!payload?.userAuthenticated || !payload.user || !payload.organization || !payload.role) {
      return null;
    }
    return {
      user: payload.user,
      organization: payload.organization,
      role: payload.role,
    };
  }, []);

  const refreshAuthSession = useCallback(async () => {
    let nextContext: SessionContext | null = null;
    try {
      const response = await fetch("/api/auth/session", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) {
        setSessionContext(null);
        setWalletSession({
          configured: true,
          authenticated: false,
          walletAddress: null,
          expiresAt: null,
          scopes: [],
        });
        return null;
      }
      const payload = (await response.json()) as SessionResponse;
      nextContext = parseSessionContext(payload);
      setSessionContext(nextContext);
      const scopes = Array.isArray(payload.scopes)
        ? payload.scopes
            .map((scope) => String(scope).trim().toLowerCase())
            .filter((scope): scope is ManualAuthScope =>
              scope === "spawn" || scope === "fund" || scope === "tick"
            )
        : [];
      setWalletSession({
        configured: payload.configured !== false,
        authenticated: payload.authenticated === true,
        walletAddress:
          typeof payload.walletAddress === "string" && payload.walletAddress.trim()
            ? payload.walletAddress.trim()
            : null,
        expiresAt:
          typeof payload.expiresAt === "number" && Number.isFinite(payload.expiresAt)
            ? payload.expiresAt
            : null,
        scopes,
      });
    } catch {
      setSessionContext(null);
      setWalletSession({
        configured: true,
        authenticated: false,
        walletAddress: null,
        expiresAt: null,
        scopes: [],
      });
      return null;
    } finally {
      setSessionLoading(false);
    }
    return nextContext;
  }, [parseSessionContext]);

  const clearAuthIntentQuery = useCallback(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has("auth")) return;
    params.delete("auth");
    const query = params.toString();
    const nextPath = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    window.history.replaceState({}, "", nextPath);
  }, []);

  const openAuthModal = useCallback((mode: AuthModalMode) => {
    setAuthModalMode(mode);
    setAuthModalOpen(true);
  }, []);

  const handleHeaderAuthOpen = useCallback((mode: AuthModalMode) => {
    setPendingCreatorAfterAuth(false);
    setPendingBetAfterAuth(null);
    openAuthModal(mode);
  }, [openAuthModal]);

  const handleCloseAuthModal = useCallback(() => {
    setAuthModalOpen(false);
    setPendingCreatorAfterAuth(false);
    setPendingBetAfterAuth(null);
    clearAuthIntentQuery();
  }, [clearAuthIntentQuery]);

  const handleAuthSuccess = useCallback(async () => {
    const creatorIntent = pendingCreatorAfterAuth;
    const betIntent = pendingBetAfterAuth;
    setAuthModalOpen(false);
    setPendingCreatorAfterAuth(false);
    setPendingBetAfterAuth(null);
    clearAuthIntentQuery();
    const authed = await refreshAuthSession();
    if (!authed) return;
    if (creatorIntent) {
      setShowCreator(true);
    }
    if (betIntent) {
      setBetMarketId(betIntent.marketId);
      setBetPreselectedOutcome(betIntent.outcome);
    }
  }, [
    clearAuthIntentQuery,
    pendingBetAfterAuth,
    pendingCreatorAfterAuth,
    refreshAuthSession,
  ]);

  const handleLogout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout?scope=all", {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // Ignore transient logout network errors.
    }
    setSessionContext(null);
    setPendingCreatorAfterAuth(false);
    setPendingBetAfterAuth(null);
    void refreshAuthSession();
  }, [refreshAuthSession]);

  const handleOpenCreator = useCallback(() => {
    if (!sessionContext) {
      setPendingCreatorAfterAuth(true);
      setPendingBetAfterAuth(null);
      openAuthModal("signup");
      return;
    }
    setShowCreator(true);
  }, [openAuthModal, sessionContext]);

  const handleBet = useCallback((marketId: number, outcome?: 0 | 1) => {
    if (!sessionContext) {
      setPendingBetAfterAuth({ marketId, outcome });
      setPendingCreatorAfterAuth(false);
      openAuthModal("signin");
      return;
    }
    setBetMarketId(marketId);
    setBetPreselectedOutcome(outcome);
  }, [openAuthModal, sessionContext]);

  const handleAnalyze = useCallback((marketId: number) => {
    setAnalyzeMarketId(marketId);
  }, []);

  const handleRunAgentSweep = useCallback(async () => {
    if (!sessionContext) {
      setPendingCreatorAfterAuth(false);
      setPendingBetAfterAuth(null);
      openAuthModal("signin");
      return;
    }
    if (walletSession.configured === false) {
      setAgentSweepMessage("Manual wallet auth is not configured on server.");
      return;
    }
    if (!walletSession.authenticated || !walletSession.scopes.includes("tick")) {
      setAgentSweepMessage(
        "Wallet signature with tick scope is required before running agent sweep."
      );
      return;
    }
    if (survivalTier === "dead") {
      setAgentSweepMessage("Agent wallet is unfunded. Fund wallet before running sweep.");
      return;
    }

    setAgentSweepBusy(true);
    setAgentSweepMessage(null);
    try {
      const response = await fetch("/api/agent-loop", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "tick" }),
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            partial?: boolean;
            message?: string;
            error?: string;
            actions?: unknown[];
          }
        | null;

      if (!response.ok || payload?.ok === false) {
        throw new Error(
          payload?.error ??
            payload?.message ??
            `Agent sweep failed (HTTP ${response.status})`
        );
      }

      const actionCount = Array.isArray(payload?.actions)
        ? payload.actions.length
        : 0;
      const prefix = payload?.partial ? "Partial sweep" : "Sweep complete";
      setAgentSweepMessage(`${prefix}: ${actionCount} actions processed.`);
      void refreshData();
    } catch (err: any) {
      setAgentSweepMessage(err?.message ?? "Agent sweep failed.");
    } finally {
      setAgentSweepBusy(false);
    }
  }, [
    openAuthModal,
    refreshData,
    sessionContext,
    survivalTier,
    walletSession.authenticated,
    walletSession.configured,
    walletSession.scopes,
  ]);

  useEffect(() => {
    if (!agentSweepMessage) return;
    const id = window.setTimeout(() => setAgentSweepMessage(null), 9000);
    return () => window.clearTimeout(id);
  }, [agentSweepMessage]);

  useEffect(() => {
    void refreshAuthSession();
  }, [refreshAuthSession]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const authIntent = new URLSearchParams(window.location.search).get("auth");
    if (authIntent !== "signin" && authIntent !== "signup") return;
    setPendingCreatorAfterAuth(false);
    setPendingBetAfterAuth(null);
    openAuthModal(authIntent);
  }, [openAuthModal]);

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
        onOpenCreator={handleOpenCreator}
        marketDataSource={marketDataSource}
        marketDataStale={marketDataStale}
        authUser={sessionContext?.user ?? null}
        authRole={sessionContext?.role ?? null}
        authLoading={sessionLoading}
        onOpenAuth={handleHeaderAuthOpen}
        onLogout={handleLogout}
      />

      {/* Horizontal category nav */}
      <CategoryNav
        tabs={categoryTabs}
        activeCategory={activeCategory}
        onSetCategory={setActiveCategory}
      />

      {/* Main content */}
      <main className="max-w-[1400px] mx-auto px-3 sm:px-4 lg:px-5 py-4">
          {/* Agent status bar */}
          {!loading && !sessionLoading && (
            <div className="mb-4 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 flex flex-wrap items-center gap-3 sm:gap-4">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${
                  survivalTier === "dead" ? "bg-red-400" :
                  survivalTier === "critical" ? "bg-orange-400 animate-pulse" :
                  survivalTier === "low" ? "bg-neo-yellow" :
                  survivalTier === "healthy" ? "bg-neo-green" :
                  survivalTier === "thriving" ? "bg-neo-brand" : "bg-white/20"
                }`} />
                <span className="text-[11px] font-semibold text-white/60 uppercase tracking-wider">
                  {survivalTier ?? "offline"}
                </span>
              </div>
              <span className="hidden sm:inline text-white/10">|</span>
              <span className="text-[11px] text-white/40 font-mono tabular-nums">
                {markets.length} markets
              </span>
              <span className="hidden sm:inline text-white/10">|</span>
              <span className="text-[11px] text-white/40">
                {Object.values(predictions).filter((p) => p.length > 0).length} with forecasts
              </span>
              <div className="flex-1" />
              <div className="flex items-center gap-2">
                {sessionContext && (
                  <button
                    type="button"
                    onClick={handleRunAgentSweep}
                    disabled={agentSweepBusy || survivalTier === "dead"}
                    className="rounded-lg border border-neo-brand/25 bg-neo-brand/10 px-3 py-1.5 text-[11px] font-semibold text-neo-brand hover:bg-neo-brand/18 disabled:opacity-40 transition-all"
                  >
                    {agentSweepBusy ? "Sweeping..." : "Run Agent Sweep"}
                  </button>
                )}
                <Link
                  href="/fleet"
                  className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-white/60 hover:bg-white/[0.08] transition-colors no-underline"
                >
                  Fleet
                </Link>
              </div>
            </div>
          )}

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
              className="rounded-xl border border-neo-yellow/15 bg-neo-yellow/[0.04] px-4 py-3 mb-4 flex items-center gap-3"
              role="status"
            >
              <svg className="w-4 h-4 text-neo-yellow/60 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <p className="text-xs text-neo-yellow/70">
                {marketDataWarning}
              </p>
            </div>
          )}

          {/* Agent wallet unfunded banner */}
          {survivalTier === "dead" && agentWalletAddress && (
            <div
              className="rounded-xl border border-neo-yellow/15 bg-neo-yellow/[0.04] p-5 mb-4"
              role="status"
            >
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex gap-3">
                  <div className="w-10 h-10 rounded-xl bg-neo-yellow/10 flex items-center justify-center shrink-0">
                    <svg className="w-5 h-5 text-neo-yellow" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-heading font-semibold text-sm text-neo-yellow">
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
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-neo-yellow bg-neo-yellow/10 border border-neo-yellow/20 hover:bg-neo-yellow/15 transition-all"
                  >
                    Copy
                  </button>
                  <a
                    href="https://starknet-faucet.vercel.app/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-neo-yellow bg-neo-yellow/10 border border-neo-yellow/20 hover:bg-neo-yellow/15 transition-all no-underline"
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
            onAnalyze={(marketId) => handleAnalyze(marketId)}
            onRunAgentSweep={handleRunAgentSweep}
            agentSweepBusy={agentSweepBusy}
            agentSweepMessage={agentSweepMessage}
            isAuthenticated={Boolean(sessionContext)}
            walletSession={walletSession}
            fundingReady={survivalTier !== "dead"}
            viewMode={viewMode}
          />
      </main>

      {/* Modals */}
      <AuthModal
        open={authModalOpen}
        initialMode={authModalMode}
        onClose={handleCloseAuthModal}
        onAuthenticated={handleAuthSuccess}
      />

      {showCreator && (
        <MarketCreator
          onClose={() => setShowCreator(false)}
          onCreated={refreshData}
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

      <Footer />
    </div>
  );
}
