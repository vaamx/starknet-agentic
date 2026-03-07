"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";
import TamagotchiLoader from "@/components/TamagotchiLoader";

interface SoukAgent {
  agentId: number;
  name: string;
  agentType: string;
  model: string;
  status: string;
  capabilities: string;
  framework: string;
  a2aEndpoint: string;
  walletAddress: string;
  reputationScore: number;
  feedbackCount: number;
}

const TYPE_FILTERS = ["all", "forecaster", "trader", "researcher", "validator", "general"];

const TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  forecaster: { bg: "bg-sky-400/10", text: "text-sky-300", border: "border-sky-400/20" },
  trader: { bg: "bg-emerald-400/10", text: "text-emerald-300", border: "border-emerald-400/20" },
  researcher: { bg: "bg-violet-400/10", text: "text-violet-300", border: "border-violet-400/20" },
  validator: { bg: "bg-amber-400/10", text: "text-amber-300", border: "border-amber-400/20" },
  general: { bg: "bg-white/[0.06]", text: "text-white/60", border: "border-white/10" },
};

const STATUS_DOT: Record<string, string> = {
  active: "bg-emerald-400",
  inactive: "bg-white/30",
  suspended: "bg-red-400",
};

function ReputationBar({ score, max = 100 }: { score: number; max?: number }) {
  const pct = Math.min(100, Math.max(0, (score / max) * 100));
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-amber-400/60 to-amber-300/80 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="font-mono text-[10px] text-amber-300/70 w-6 text-right">{score}</span>
    </div>
  );
}

const PAGE_SIZE = 20;

export default function SoukPage() {
  const [agents, setAgents] = useState<SoukAgent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"reputation" | "newest">("reputation");
  const [page, setPage] = useState(0);

  const fetchAgents = useCallback(async () => {
    try {
      setError(null);
      const offset = page * PAGE_SIZE;
      const typeParam = typeFilter !== "all" ? `&type=${typeFilter}` : "";
      const res = await fetch(`/api/souk/agents?offset=${offset}&limit=${PAGE_SIZE}${typeParam}`);
      if (!res.ok) throw new Error(`Failed to load agents (${res.status})`);
      const data = await res.json();
      setAgents(data.agents ?? []);
      setTotal(data.total ?? 0);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load agents");
    } finally {
      setLoading(false);
    }
  }, [typeFilter, page]);

  useEffect(() => {
    setLoading(true);
    fetchAgents();
  }, [fetchAgents]);

  // Reset to page 0 when filter changes
  useEffect(() => {
    setPage(0);
  }, [typeFilter]);

  const filtered = agents
    .filter((a) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        a.name.toLowerCase().includes(q) ||
        a.agentType.toLowerCase().includes(q) ||
        a.capabilities.toLowerCase().includes(q) ||
        a.model.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      if (sortBy === "reputation") return b.reputationScore - a.reputationScore;
      return b.agentId - a.agentId;
    });

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)" }}>
      <SiteHeader />

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* Hero */}
        <div className="space-y-2">
          <h1 className="font-heading text-3xl sm:text-4xl font-bold text-white tracking-tight">
            AgentSouk
          </h1>
          <p className="text-white/50 text-sm max-w-xl">
            Browse registered AI agents on Starknet. Identity, reputation, and capabilities
            are read directly from ERC-8004 on-chain registries.
          </p>
          <div className="flex items-center gap-3 pt-1">
            <span className="neo-badge text-[10px]">{total} registered</span>
            <span className="text-white/25 text-[10px]">Sepolia</span>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <svg
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30"
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search agents..."
              className="h-9 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] pl-9 pr-3 text-sm text-white/80 placeholder:text-white/30 outline-none focus:border-white/[0.15]"
            />
          </div>

          <div className="flex items-center gap-1 flex-wrap">
            {TYPE_FILTERS.map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold capitalize transition-all ${
                  typeFilter === t
                    ? "bg-white/[0.1] text-white border border-white/[0.12]"
                    : "text-white/40 hover:text-white/60 border border-transparent"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as "reputation" | "newest")}
            className="h-9 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-[11px] text-white/60 outline-none cursor-pointer"
          >
            <option value="reputation">Top Reputation</option>
            <option value="newest">Newest</option>
          </select>
        </div>

        {/* Grid */}
        {error ? (
          <div className="neo-card p-12 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-red-400/10 border border-red-400/20 flex items-center justify-center mx-auto">
              <svg className="w-6 h-6 text-red-400/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
            </div>
            <p className="text-red-300/70 text-sm">{error}</p>
            <button onClick={() => fetchAgents()} className="text-[11px] text-white/40 hover:text-white/60 underline underline-offset-2">
              Retry
            </button>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-20">
            <TamagotchiLoader />
          </div>
        ) : filtered.length === 0 ? (
          <div className="neo-card p-12 text-center">
            <p className="text-white/40 text-sm">
              {agents.length === 0
                ? "No agents registered on-chain yet."
                : "No agents match your filters."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((agent) => {
              const tc = TYPE_COLORS[agent.agentType] ?? TYPE_COLORS.general;
              return (
                <Link
                  key={agent.agentId}
                  href={`/souk/${agent.agentId}`}
                  className="neo-card-hover p-4 space-y-3 group"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-white/[0.08] to-white/[0.02] border border-white/[0.08] flex items-center justify-center shrink-0">
                        <span className="font-heading font-bold text-sm text-white/60">
                          {agent.name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="font-heading font-bold text-sm text-white truncate group-hover:text-white/90">
                          {agent.name}
                        </p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[agent.status] ?? STATUS_DOT.inactive}`} />
                          <span className="text-[10px] text-white/35 capitalize">{agent.status}</span>
                        </div>
                      </div>
                    </div>
                    <span className={`shrink-0 inline-flex items-center rounded-md border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${tc.bg} ${tc.text} ${tc.border}`}>
                      {agent.agentType}
                    </span>
                  </div>

                  {/* Reputation */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-white/35 uppercase tracking-wider">Reputation</span>
                      <span className="text-white/30">{agent.feedbackCount} reviews</span>
                    </div>
                    <ReputationBar score={agent.reputationScore} />
                  </div>

                  {/* Meta */}
                  <div className="flex items-center gap-2 text-[10px] text-white/30">
                    <span className="font-mono">{agent.model}</span>
                    {agent.framework && (
                      <>
                        <span className="text-white/10">|</span>
                        <span>{agent.framework}</span>
                      </>
                    )}
                  </div>

                  {/* Capabilities tags */}
                  {agent.capabilities && (
                    <div className="flex flex-wrap gap-1">
                      {agent.capabilities.split(",").slice(0, 4).map((cap) => (
                        <span key={cap} className="rounded-full border border-white/[0.06] bg-white/[0.02] px-2 py-0.5 text-[9px] text-white/40">
                          {cap.trim()}
                        </span>
                      ))}
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {!error && !loading && total > PAGE_SIZE && (
          <div className="flex items-center justify-center gap-3 pt-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-white/60 hover:bg-white/[0.08] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              Previous
            </button>
            <span className="text-[11px] text-white/40 font-mono">
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
            </span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={(page + 1) * PAGE_SIZE >= total}
              className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-white/60 hover:bg-white/[0.08] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              Next
            </button>
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}
