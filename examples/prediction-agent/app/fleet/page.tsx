"use client";

import {
  useState,
  useEffect,
  useMemo,
  useDeferredValue,
  useCallback,
} from "react";
import SiteHeader from "../components/SiteHeader";
import Footer from "../components/Footer";
import FleetStatsHeader from "../components/fleet/FleetStatsHeader";
import FleetToolbar, {
  type FilterStatus,
  type ViewMode,
  type SortBy,
} from "../components/fleet/FleetToolbar";
import FleetAgentCard, {
  type FleetAgentSummary,
} from "../components/fleet/FleetAgentCard";
import FleetAgentRow from "../components/fleet/FleetAgentRow";
import FleetAgentDrawer from "../components/fleet/FleetAgentDrawer";
import DeployWizard from "../components/fleet/DeployWizard";
import AutonomousEngineCard from "../components/dashboard/AutonomousEngineCard";
import SwarmDialogue from "../components/SwarmDialogue";
import SpawnedAgentsCard from "../components/dashboard/SpawnedAgentsCard";
import TradeLog from "../components/TradeLog";
import SurvivalDashboard from "../components/SurvivalDashboard";
import OpenClawConnections from "../components/OpenClawConnections";
import type { LoopStatus } from "../components/dashboard/types";
import { STORAGE_KEY, type SerializedSpawnedAgent } from "@/lib/agent-spawner";

// ── Types ────────────────────────────────────────────────────────────────────

interface FleetStats {
  totalAgents: number;
  runningAgents: number;
  totalStrkHuman: number;
  avgBrierScore: number | null;
  tierDistribution: Record<string, number>;
  fleetPnl: string;
  readiness?: {
    walletLinkedAgents: number;
    fundedAgents: number;
    executableAgents: number;
    runtimeOnlineAgents: number;
    activeAgents1h: number;
    sourceCoverage: string[];
    sourceHeartbeat?: {
      evaluatedAt: number;
      trackedSources: Array<"x" | "espn" | "rss" | "onchain">;
      sourceStatus: Record<
        "x" | "espn" | "rss" | "onchain",
        {
          lastSeenAt: number | null;
          freshness: "fresh" | "stale" | "missing";
          staleAfterSecs: number;
          coverageMarkets: number;
          sampleCount: number;
        }
      >;
      markets: Array<{
        marketId: number;
        lastSeenAt: number | null;
        freshness: "fresh" | "stale" | "missing";
        sources: Record<
          "x" | "espn" | "rss" | "onchain",
          {
            lastSeenAt: number | null;
            freshness: "fresh" | "stale" | "missing";
          }
        >;
      }>;
    } | null;
  };
}

interface FleetData {
  fleet: FleetStats;
  agents: FleetAgentSummary[];
}

type ManualAuthScope = "spawn" | "fund" | "tick";

interface WalletSessionState {
  configured: boolean;
  authenticated: boolean;
  walletAddress: string | null;
  expiresAt: number | null;
  scopes: ManualAuthScope[];
}

type FleetTab = "agents" | "engine" | "activity" | "survival" | "network";

// ── Cache ────────────────────────────────────────────────────────────────────

const CACHE_KEY = "fleet-dashboard-cache-v1";
const POLL_INTERVAL = 15_000;

function getCachedData(): FleetData | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function setCachedData(data: FleetData): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch {
    // ignore quota errors
  }
}

// ── Fetch helper ─────────────────────────────────────────────────────────────

function fetchWithTimeout(
  url: string,
  timeoutMs: number
): Promise<Response | null> {
  return Promise.race([
    fetch(url),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
}

// ── Tab Bar ──────────────────────────────────────────────────────────────────

const TABS: { id: FleetTab; label: string }[] = [
  { id: "agents", label: "Agents" },
  { id: "engine", label: "Engine" },
  { id: "activity", label: "Activity" },
  { id: "survival", label: "Survival" },
  { id: "network", label: "Network" },
];

function sourceLabel(source: string): string {
  return source
    .split(/[-_\s]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatRelativeAge(timestampSec: number | null): string {
  if (!timestampSec) return "no signal";
  const delta = Math.max(0, Math.floor(Date.now() / 1000) - timestampSec);
  if (delta < 60) return `${delta}s`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m`;
  if (delta < 86_400) return `${Math.floor(delta / 3600)}h`;
  return `${Math.floor(delta / 86_400)}d`;
}

function freshnessTone(freshness: "fresh" | "stale" | "missing"): string {
  if (freshness === "fresh") {
    return "border-neo-green/35 bg-neo-green/15 text-neo-green";
  }
  if (freshness === "stale") {
    return "border-neo-yellow/35 bg-neo-yellow/15 text-neo-yellow";
  }
  return "border-white/20 bg-white/[0.08] text-white/70";
}

const TAB_ICONS: Record<FleetTab, string> = {
  agents: "M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z",
  engine: "M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
  activity: "M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5",
  survival: "M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z",
  network: "M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z",
};

function FleetTabBar({
  activeTab,
  onTabChange,
}: {
  activeTab: FleetTab;
  onTabChange: (tab: FleetTab) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 mb-5 border-b border-white/[0.07]">
      {TABS.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            className={`relative flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold transition-all ${
              isActive
                ? "text-neo-brand"
                : "text-white/45 hover:text-white/75"
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d={TAB_ICONS[tab.id]} />
            </svg>
            {tab.label}
            {isActive && (
              <span className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-neo-brand" />
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function FleetPage() {
  const [agents, setAgents] = useState<FleetAgentSummary[]>([]);
  const [fleetStats, setFleetStats] = useState<FleetStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);
  const [walletSession, setWalletSession] = useState<WalletSessionState>({
    configured: true,
    authenticated: false,
    walletAddress: null,
    expiresAt: null,
    scopes: [],
  });

  // Fleet tab
  const [activeTab, setActiveTab] = useState<FleetTab>("agents");

  // UI state
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearch = useDeferredValue(searchQuery);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sortBy, setSortBy] = useState<SortBy>("name");

  // Drawer
  const [drawerAgentId, setDrawerAgentId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Deploy wizard
  const [wizardOpen, setWizardOpen] = useState(false);

  // Engine tab state
  const [autonomousMode, setAutonomousMode] = useState(true);
  const [loopStatus, setLoopStatus] = useState<LoopStatus | null>(null);
  const [loopActions, setLoopActions] = useState<Array<{ detail?: string }>>(
    []
  );
  const [nextTickIn, setNextTickIn] = useState<number | null>(null);
  const [spawnedAgents, setSpawnedAgents] = useState<SerializedSpawnedAgent[]>(
    []
  );

  // ── Data loading ─────────────────────────────────────────────────────────

  const loadData = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);

    try {
      const [res, sessionRes] = await Promise.all([
        fetchWithTimeout("/api/fleet", 5_000),
        fetchWithTimeout("/api/auth/session", 4_500),
      ]);
      if (!res) {
        setStale(true);
        return;
      }

      const data: FleetData = await res.json();
      if (data.fleet && data.agents) {
        setFleetStats(data.fleet);
        setAgents(data.agents);
        setStale(false);
        setCachedData(data);
      }
      if (sessionRes?.ok) {
        const payload = (await sessionRes.json()) as {
          configured?: boolean;
          authenticated?: boolean;
          walletAddress?: string;
          expiresAt?: number;
          scopes?: string[];
        };
        const scopes = Array.isArray(payload.scopes)
          ? payload.scopes
              .map((scope) => String(scope).trim().toLowerCase())
              .filter(
                (scope): scope is ManualAuthScope =>
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
      }
    } catch {
      setStale(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load from cache then fetch fresh
  useEffect(() => {
    const cached = getCachedData();
    if (cached) {
      setFleetStats(cached.fleet);
      setAgents(cached.agents);
      setLoading(false);
      setStale(true);
    }
    loadData(true);
  }, [loadData]);

  // Poll every 15s
  useEffect(() => {
    const timer = setInterval(() => loadData(false), POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [loadData]);

  // Load engine data when engine tab is active
  useEffect(() => {
    if (activeTab !== "engine") return;

    // Load spawned agents from localStorage
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setSpawnedAgents(JSON.parse(stored) as SerializedSpawnedAgent[]);
      }
    } catch {}

    // Load loop status
    const fetchLoopStatus = async () => {
      try {
        const res = await fetch("/api/agent-loop", { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          setLoopStatus(data.status ?? null);
          setLoopActions(
            Array.isArray(data.actions) ? data.actions : []
          );
          if (data.status?.nextTickAt) {
            const secsLeft = Math.max(
              0,
              Math.ceil((data.status.nextTickAt - Date.now()) / 1000)
            );
            setNextTickIn(secsLeft);
          }
        }
      } catch {}
    };
    fetchLoopStatus();
    const interval = setInterval(fetchLoopStatus, 10_000);
    return () => clearInterval(interval);
  }, [activeTab]);

  // Countdown timer for nextTickIn
  useEffect(() => {
    if (activeTab !== "engine" || nextTickIn === null) return;
    const interval = setInterval(() => {
      setNextTickIn((prev) => (prev !== null && prev > 0 ? prev - 1 : prev));
    }, 1000);
    return () => clearInterval(interval);
  }, [activeTab, nextTickIn]);

  const toggleAutonomousMode = useCallback(async () => {
    try {
      const action = autonomousMode ? "stop" : "start";
      await fetch("/api/agent-loop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      setAutonomousMode(!autonomousMode);
    } catch {}
  }, [autonomousMode]);

  const triggerTick = useCallback(async () => {
    if (walletSession.configured === false) return;
    if (!walletSession.authenticated || !walletSession.scopes.includes("tick")) return;
    if ((fleetStats?.readiness?.fundedAgents ?? 0) <= 0) return;
    if ((fleetStats?.readiness?.executableAgents ?? 0) <= 0) return;
    try {
      await fetch("/api/agent-loop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "tick" }),
      });
    } catch {}
  }, [fleetStats?.readiness?.executableAgents, fleetStats?.readiness?.fundedAgents, walletSession]);

  // ── Agent controls ───────────────────────────────────────────────────────

  async function handlePause(agentId: string) {
    try {
      await fetch(`/api/fleet/${agentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "pause" }),
      });
      loadData(false);
    } catch {
      // ignore
    }
  }

  async function handleResume(agentId: string) {
    try {
      await fetch(`/api/fleet/${agentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "resume" }),
      });
      loadData(false);
    } catch {
      // ignore
    }
  }

  function handleSelect(agentId: string) {
    setDrawerAgentId(agentId);
    setDrawerOpen(true);
  }

  function handleFund(agentId: string) {
    setDrawerAgentId(agentId);
    setDrawerOpen(true);
  }

  // ── Filter/sort ──────────────────────────────────────────────────────────

  const filteredAgents = useMemo(() => {
    let result = agents;

    // Search
    if (deferredSearch.trim()) {
      const q = deferredSearch.toLowerCase();
      result = result.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.agentType.toLowerCase().includes(q) ||
          a.id.toLowerCase().includes(q)
      );
    }

    // Filter
    if (filterStatus === "running") {
      result = result.filter((a) => a.status === "running");
    } else if (filterStatus === "paused") {
      result = result.filter(
        (a) => a.status === "paused" || a.status === "stopped"
      );
    } else if (filterStatus === "critical") {
      result = result.filter(
        (a) => a.tier === "critical" || a.tier === "dead"
      );
    }

    // Sort
    result = [...result].sort((a, b) => {
      switch (sortBy) {
        case "name":
          return a.name.localeCompare(b.name);
        case "brier":
          if (a.brierScore === null && b.brierScore === null) return 0;
          if (a.brierScore === null) return 1;
          if (b.brierScore === null) return -1;
          return a.brierScore - b.brierScore;
        case "balance":
          return (b.balanceStrk ?? 0) - (a.balanceStrk ?? 0);
        case "activity":
          return (b.lastActionAt ?? 0) - (a.lastActionAt ?? 0);
        default:
          return 0;
      }
    });

    return result;
  }, [agents, deferredSearch, filterStatus, sortBy]);

  const readiness = fleetStats?.readiness ?? null;
  const readinessState = useMemo(() => {
    if (!readiness) return "unknown";
    if (readiness.executableAgents <= 0 || readiness.fundedAgents <= 0) return "setup";
    if (readiness.runtimeOnlineAgents <= 0 || readiness.activeAgents1h <= 0) return "warming";
    return "live";
  }, [readiness]);

  const readinessMessage =
    readinessState === "live"
      ? "Fleet is actively executing: agents are funded, signing-enabled, and producing recent actions."
      : readinessState === "warming"
        ? "Execution path is configured but activity is still warming up. Trigger a manual tick or wait for next cycle."
        : readinessState === "setup"
          ? "Fleet has templates but execution is not fully armed yet. Deploy with wallet keys and fund at least one agent."
          : "Readiness is loading.";

  const deployBlockers = useMemo(() => {
    const blockers: string[] = [];
    if (walletSession.configured === false) {
      blockers.push("Manual wallet auth is not configured.");
      return blockers;
    }
    if (!walletSession.authenticated) {
      blockers.push("Wallet signature session is required.");
    }
    if (!walletSession.scopes.includes("spawn")) {
      blockers.push("Spawn scope is missing in wallet session.");
    }
    if ((readiness?.fundedAgents ?? 0) <= 0) {
      blockers.push("No funded agent wallet is available.");
    }
    if ((readiness?.executableAgents ?? 0) <= 0) {
      blockers.push("No signing-enabled agent is available.");
    }
    return blockers;
  }, [readiness, walletSession]);

  const tickBlockers = useMemo(() => {
    const blockers: string[] = [];
    if (walletSession.configured === false) {
      blockers.push("Manual wallet auth is not configured.");
      return blockers;
    }
    if (!walletSession.authenticated) {
      blockers.push("Wallet signature session is required.");
    }
    if (!walletSession.scopes.includes("tick")) {
      blockers.push("Tick scope is missing in wallet session.");
    }
    if ((readiness?.fundedAgents ?? 0) <= 0) {
      blockers.push("No funded agent wallet is available.");
    }
    if ((readiness?.executableAgents ?? 0) <= 0) {
      blockers.push("No signing-enabled agent is available.");
    }
    return blockers;
  }, [readiness, walletSession]);

  const canDeployAgent = deployBlockers.length === 0;
  const canTriggerTick = tickBlockers.length === 0;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-cream flex flex-col">
    <SiteHeader />
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="font-heading text-xl font-bold text-white">
          Fleet Command Center
        </h1>
        <p className="text-xs text-muted">
          Deploy, monitor, and orchestrate your AI prediction agents.
          {stale && (
            <span className="ml-2 text-neo-yellow">(cached)</span>
          )}
        </p>
      </div>

      {/* Stats header */}
      <div className="mb-5">
        <FleetStatsHeader stats={fleetStats} />
      </div>

      {readiness && (
        <section className="mb-5 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-heading text-sm font-bold text-white">
              Execution Readiness
            </h2>
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                readinessState === "live"
                  ? "border-neo-green/35 bg-neo-green/15 text-neo-green"
                  : readinessState === "warming"
                    ? "border-sky-300/35 bg-sky-300/15 text-sky-100"
                    : readinessState === "setup"
                      ? "border-neo-yellow/35 bg-neo-yellow/15 text-neo-yellow"
                      : "border-white/20 bg-white/10 text-white/75"
              }`}
            >
              {readinessState}
            </span>
          </div>

          <p className="mt-2 text-xs text-white/70">{readinessMessage}</p>
          {(deployBlockers.length > 0 || tickBlockers.length > 0) && (
            <div className="mt-2 rounded-lg border border-neo-yellow/25 bg-neo-yellow/10 px-3 py-2 text-[11px] text-neo-yellow/95">
              <p className="font-semibold">Hard blockers</p>
              <p className="mt-1">
                Deploy: {deployBlockers[0] ?? "ready"} · Run: {tickBlockers[0] ?? "ready"}
              </p>
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[10px]">
            <span
              className={`rounded-full border px-2 py-0.5 ${
                walletSession.configured
                  ? "border-white/20 bg-white/[0.08] text-white/75"
                  : "border-neo-yellow/35 bg-neo-yellow/15 text-neo-yellow"
              }`}
            >
              auth {walletSession.configured ? "configured" : "missing"}
            </span>
            <span
              className={`rounded-full border px-2 py-0.5 ${
                walletSession.authenticated
                  ? "border-neo-green/35 bg-neo-green/15 text-neo-green"
                  : "border-white/20 bg-white/[0.08] text-white/70"
              }`}
            >
              session {walletSession.authenticated ? "verified" : "not-signed"}
            </span>
            {(["spawn", "tick"] as const).map((scope) => (
              <span
                key={scope}
                className={`rounded-full border px-2 py-0.5 ${
                  walletSession.scopes.includes(scope)
                    ? "border-neo-green/35 bg-neo-green/15 text-neo-green"
                    : "border-white/20 bg-white/[0.08] text-white/65"
                }`}
              >
                {scope}
              </span>
            ))}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3 lg:grid-cols-5">
            <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-white/45">Wallets</p>
              <p className="mt-1 font-mono text-white/90">
                {readiness.walletLinkedAgents}/{fleetStats?.totalAgents ?? 0}
              </p>
            </div>
            <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-white/45">Funded</p>
              <p className="mt-1 font-mono text-white/90">{readiness.fundedAgents}</p>
            </div>
            <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-white/45">Signing Ready</p>
              <p className="mt-1 font-mono text-white/90">{readiness.executableAgents}</p>
            </div>
            <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-white/45">Runtime Online</p>
              <p className="mt-1 font-mono text-white/90">{readiness.runtimeOnlineAgents}</p>
            </div>
            <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-white/45">Active (1h)</p>
              <p className="mt-1 font-mono text-white/90">{readiness.activeAgents1h}</p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {(readiness.sourceCoverage.length > 0
              ? readiness.sourceCoverage
              : ["none configured"]
            )
              .slice(0, 12)
              .map((source) => (
                <span
                  key={source}
                  className="rounded-full border border-white/[0.1] bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/75"
                >
                  {sourceLabel(source)}
                </span>
              ))}
          </div>

          {readiness.sourceHeartbeat && (
            <div className="mt-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">
                External Source Heartbeat
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {readiness.sourceHeartbeat.trackedSources.map((source) => {
                  const status = readiness.sourceHeartbeat!.sourceStatus[source];
                  return (
                    <span
                      key={source}
                      className={`rounded-full border px-2 py-0.5 text-[10px] ${freshnessTone(
                        status.freshness
                      )}`}
                    >
                      {source.toUpperCase()} · {status.freshness} · {formatRelativeAge(status.lastSeenAt)}
                    </span>
                  );
                })}
              </div>
              {readiness.sourceHeartbeat.markets.length > 0 && (
                <div className="mt-3 space-y-1.5 text-[11px]">
                  {readiness.sourceHeartbeat.markets.slice(0, 6).map((market) => (
                    <div
                      key={market.marketId}
                      className="flex flex-wrap items-center gap-1.5 rounded-lg border border-white/[0.07] bg-white/[0.03] px-2.5 py-1.5"
                    >
                      <span className="font-mono text-white/70">MKT {market.marketId}</span>
                      {readiness.sourceHeartbeat!.trackedSources.map((source) => (
                        <span
                          key={`${market.marketId}-${source}`}
                          className={`rounded-full border px-1.5 py-0.5 text-[10px] ${freshnessTone(
                            market.sources[source].freshness
                          )}`}
                        >
                          {source.toUpperCase()} {formatRelativeAge(market.sources[source].lastSeenAt)}
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* Tab bar */}
      <FleetTabBar activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Agents tab */}
      {activeTab === "agents" && (
        <>
          {/* Toolbar */}
          <div className="mb-4">
            <FleetToolbar
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              filterStatus={filterStatus}
              onFilterChange={setFilterStatus}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              sortBy={sortBy}
              onSortChange={setSortBy}
              onDeployClick={() => {
                if (canDeployAgent) {
                  setWizardOpen(true);
                }
              }}
              deployDisabled={!canDeployAgent}
              deployDisabledReason={deployBlockers[0] ?? null}
            />
            {!canDeployAgent && (
              <p className="mt-2 text-[11px] text-neo-yellow/90">
                Deploy blocked: {deployBlockers[0]}
              </p>
            )}
          </div>

          {/* Agent grid/list */}
          {loading && agents.length === 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="neo-card p-4 relative overflow-hidden">
                  <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/[0.03] to-transparent" />
                  <div className="flex items-center gap-2 mb-3">
                    <div className="h-2 w-2 rounded-full bg-white/[0.08] animate-pulse" />
                    <div className="h-4 w-24 rounded bg-white/[0.06] animate-pulse" />
                    <div className="ml-auto h-5 w-8 rounded-md bg-white/[0.04] animate-pulse" />
                  </div>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="h-5 w-16 rounded-full bg-white/[0.05] animate-pulse" />
                    <div className="h-3 w-20 rounded bg-white/[0.04] animate-pulse" />
                  </div>
                  <div className="h-1 w-full rounded-full bg-white/[0.04] mb-3 animate-pulse" />
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    {[0, 1, 2].map((j) => (
                      <div key={j} className="space-y-1">
                        <div className="h-2 w-12 rounded bg-white/[0.03] animate-pulse" />
                        <div className="h-3 w-8 rounded bg-white/[0.05] animate-pulse" />
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-1.5 mb-3">
                    {[0, 1, 2].map((j) => (
                      <div key={j} className="h-4 w-14 rounded-md bg-white/[0.04] animate-pulse" style={{ animationDelay: `${j * 0.1}s` }} />
                    ))}
                  </div>
                  <div className="border-t border-white/[0.05] pt-2 flex justify-between">
                    <div className="h-3 w-12 rounded bg-white/[0.03] animate-pulse" />
                    <div className="h-3 w-16 rounded bg-white/[0.03] animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredAgents.length === 0 && agents.length === 0 ? (
            <div className="neo-card p-8 text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-neo-brand/10 border border-neo-brand/20 flex items-center justify-center">
                <svg className="w-8 h-8 text-neo-brand/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
                </svg>
              </div>
              <h3 className="font-heading text-base font-bold text-white mb-2">Deploy Your First Agent</h3>
              <p className="text-sm text-white/45 max-w-md mx-auto mb-6">
                Agents autonomously research markets, debate forecasts, and place on-chain bets.
                Choose a persona, fund a wallet, and let the swarm work for you.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-lg mx-auto mb-6 text-left">
                <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
                  <p className="text-[10px] font-semibold text-neo-green uppercase tracking-wider mb-1">Step 1</p>
                  <p className="text-xs text-white/60">Pick a persona template or build custom</p>
                </div>
                <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
                  <p className="text-[10px] font-semibold text-neo-blue uppercase tracking-wider mb-1">Step 2</p>
                  <p className="text-xs text-white/60">Set budget, max bet, and data sources</p>
                </div>
                <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
                  <p className="text-[10px] font-semibold text-neo-brand uppercase tracking-wider mb-1">Step 3</p>
                  <p className="text-xs text-white/60">Fund wallet and activate in fleet rotation</p>
                </div>
              </div>
              {canDeployAgent ? (
                <button
                  type="button"
                  onClick={() => setWizardOpen(true)}
                  className="neo-btn-primary px-6 py-2.5 text-sm"
                >
                  Deploy Agent
                </button>
              ) : (
                <p className="text-xs text-neo-yellow/70">
                  {deployBlockers[0] ?? "Connect wallet to deploy"}
                </p>
              )}
            </div>
          ) : filteredAgents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20">
              <p className="text-sm text-muted">
                No agents match your filters.
              </p>
              <button
                onClick={() => {
                  setSearchQuery("");
                  setFilterStatus("all");
                }}
                className="mt-2 text-xs text-neo-brand hover:underline"
              >
                Clear filters
              </button>
            </div>
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filteredAgents.map((agent) => (
                <FleetAgentCard
                  key={agent.id}
                  agent={agent}
                  onSelect={() => handleSelect(agent.id)}
                  onPause={() => handlePause(agent.id)}
                  onResume={() => handleResume(agent.id)}
                  onFund={() => handleFund(agent.id)}
                />
              ))}
            </div>
          ) : (
            <div className="neo-card overflow-hidden">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-white/[0.07] bg-white/[0.03]">
                    <th className="px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-muted">
                      Agent
                    </th>
                    <th className="px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-muted">
                      Tier
                    </th>
                    <th className="px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-muted">
                      STRK
                    </th>
                    <th className="px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-muted">
                      Grade
                    </th>
                    <th className="px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-muted">
                      Preds
                    </th>
                    <th className="px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-muted">
                      P&L
                    </th>
                    <th className="px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-muted">
                      Last
                    </th>
                    <th className="px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-muted" />
                  </tr>
                </thead>
                <tbody>
                  {filteredAgents.map((agent) => (
                    <FleetAgentRow
                      key={agent.id}
                      agent={agent}
                      onSelect={() => handleSelect(agent.id)}
                      onPause={() => handlePause(agent.id)}
                      onResume={() => handleResume(agent.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Engine tab */}
      {activeTab === "engine" && (
        <div className="space-y-4 max-w-2xl">
          <AutonomousEngineCard
            loopStatus={loopStatus}
            factoryConfigured={false}
            factoryAddress={null}
            autonomousMode={autonomousMode}
            nextTickIn={nextTickIn}
            loopActions={loopActions}
            onTriggerTick={triggerTick}
            triggerDisabled={!canTriggerTick}
            triggerDisabledReason={tickBlockers[0] ?? null}
          />
          <SwarmDialogue isLoopRunning={autonomousMode} />
          <SpawnedAgentsCard spawnedAgents={spawnedAgents} />
        </div>
      )}

      {/* Activity tab */}
      {activeTab === "activity" && (
        <div className="max-w-2xl">
          <TradeLog isLoopRunning={autonomousMode} />
        </div>
      )}

      {/* Survival tab */}
      {activeTab === "survival" && (
        <div className="max-w-2xl">
          <SurvivalDashboard />
        </div>
      )}

      {/* Network tab — OpenClaw A2A connections */}
      {activeTab === "network" && (
        <div className="max-w-2xl space-y-4">
          <div className="neo-card p-4">
            <h3 className="font-heading text-sm font-bold text-white mb-1">
              Agent-to-Agent Network (OpenClaw)
            </h3>
            <p className="text-xs text-white/50 mb-3">
              Connect external AI agents via the A2A protocol. Linked agents can exchange forecasts,
              delegate research, and contribute predictions to your markets. Each agent publishes
              an agent card at <code className="text-[10px] bg-white/[0.06] px-1 py-0.5 rounded">/.well-known/agent-card.json</code>.
            </p>
            <div className="flex flex-wrap gap-1.5 text-[10px]">
              <span className="rounded-full border border-cyan-300/25 bg-cyan-300/10 px-2 py-0.5 text-cyan-100">A2A Protocol</span>
              <span className="rounded-full border border-neo-green/25 bg-neo-green/10 px-2 py-0.5 text-neo-green">SSE Streaming</span>
              <span className="rounded-full border border-violet-300/25 bg-violet-300/10 px-2 py-0.5 text-violet-100">ERC-8004 Identity</span>
            </div>
          </div>
          <OpenClawConnections />
        </div>
      )}

      {/* Drawer */}
      <FleetAgentDrawer
        agentId={drawerAgentId ?? ""}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onAction={() => loadData(false)}
      />

      {/* Deploy wizard */}
      <DeployWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onDeployed={() => loadData(false)}
      />
    </main>
    <Footer />
    </div>
  );
}
