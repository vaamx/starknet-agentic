"use client";

import {
  useState,
  useEffect,
  useMemo,
  useDeferredValue,
  useCallback,
} from "react";
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

// ── Types ────────────────────────────────────────────────────────────────────

interface FleetStats {
  totalAgents: number;
  runningAgents: number;
  totalStrkHuman: number;
  avgBrierScore: number | null;
  tierDistribution: Record<string, number>;
  fleetPnl: string;
}

interface FleetData {
  fleet: FleetStats;
  agents: FleetAgentSummary[];
}

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

// ── Page ─────────────────────────────────────────────────────────────────────

export default function FleetPage() {
  const [agents, setAgents] = useState<FleetAgentSummary[]>([]);
  const [fleetStats, setFleetStats] = useState<FleetStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);

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

  // ── Data loading ─────────────────────────────────────────────────────────

  const loadData = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);

    try {
      const res = await fetchWithTimeout("/api/fleet", 5_000);
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

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="font-heading text-xl font-bold text-white">
          Fleet Command Center
        </h1>
        <p className="text-xs text-muted">
          Deploy, monitor, and orchestrate your AI prediction agents.
          {stale && (
            <span className="ml-2 text-yellow-400">(cached)</span>
          )}
        </p>
      </div>

      {/* Stats header */}
      <div className="mb-5">
        <FleetStatsHeader stats={fleetStats} />
      </div>

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
          onDeployClick={() => setWizardOpen(true)}
        />
      </div>

      {/* Agent grid/list */}
      {loading && agents.length === 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="neo-card h-48 animate-pulse" />
          ))}
        </div>
      ) : filteredAgents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <p className="text-sm text-muted">No agents match your filters.</p>
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
  );
}
