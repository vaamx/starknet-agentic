"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { useAccount } from "@starknet-react/core";
import { shortString } from "starknet";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";
import { friendlyTxError } from "@/lib/tx-errors";
import { ECONOMY, buildCreateGuildCalls } from "@/lib/contracts";

// ── Types ────────────────────────────────────────────────────────────────────

interface Guild {
  guildId: number;
  name: string;
  creator: string;
  memberCount: number;
  totalStaked: number;
  minStake: number;
  createdAt: number;
  activeProposals: number;
  description: string;
  tags: string[];
}

// ── Data fetching ────────────────────────────────────────────────────────────

function useGuilds() {
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/guilds")
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load guilds (${r.status})`);
        return r.json();
      })
      .then((data) => {
        const guilds = (data.guilds ?? []).map((g: any) => ({
          ...g,
          tags: g.tags ?? [],
          description: g.description ?? "",
          activeProposals: g.activeProposals ?? 0,
          totalStaked: g.totalStaked ?? 0,
          memberCount: g.memberCount ?? 0,
          minStake: g.minStake ?? 0,
        }));
        setGuilds(guilds);
      })
      .catch((e) => setError(e.message ?? "Failed to load guilds"))
      .finally(() => setLoading(false));
  }, []);

  return { guilds, loading, error };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

type SortOption = "members" | "staked" | "newest";

function truncateAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatStrkAmount(amount: number | undefined | null): string {
  if (amount == null || isNaN(amount)) return "0";
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)}K`;
  return amount.toLocaleString();
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ── Stats Bar ────────────────────────────────────────────────────────────────

function StatsBar({ guilds }: { guilds: Guild[] }) {
  const totalGuilds = guilds.length;
  const totalStaked = guilds.reduce((s, g) => s + g.totalStaked, 0);
  const totalMembers = guilds.reduce((s, g) => s + g.memberCount, 0);
  const activeProposals = guilds.reduce((s, g) => s + g.activeProposals, 0);

  const stats = [
    { label: "Total Guilds", value: totalGuilds.toString() },
    { label: "Total Staked STRK", value: formatStrkAmount(totalStaked) },
    { label: "Active Members", value: totalMembers.toString() },
    { label: "Active Proposals", value: activeProposals.toString() },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {stats.map((s) => (
        <div
          key={s.label}
          className="neo-card p-4 text-center space-y-1"
        >
          <p className="text-[10px] uppercase tracking-wider text-white/35 font-semibold">
            {s.label}
          </p>
          <p className="font-heading font-bold text-xl text-white">{s.value}</p>
        </div>
      ))}
    </div>
  );
}

// ── Guild Card ───────────────────────────────────────────────────────────────

function GuildCard({ guild }: { guild: Guild }) {
  return (
    <div className="neo-card p-5 space-y-4 group hover:border-white/[0.12] transition-all">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-400/15 to-violet-400/10 border border-white/[0.08] flex items-center justify-center shrink-0">
              <span className="font-heading font-bold text-base text-cyan-300/80">
                {guild.name.charAt(0)}
              </span>
            </div>
            <div className="min-w-0">
              <h3 className="font-heading font-bold text-sm text-white truncate">
                {guild.name}
              </h3>
              <p className="text-[10px] text-white/30 font-mono mt-0.5">
                by {truncateAddress(guild.creator)}
              </p>
            </div>
          </div>
        </div>
        {guild.activeProposals > 0 && (
          <span className="shrink-0 inline-flex items-center rounded-md border border-cyan-400/20 bg-cyan-400/10 px-2 py-0.5 text-[9px] font-semibold text-cyan-300">
            {guild.activeProposals} active
          </span>
        )}
      </div>

      {/* Description */}
      <p className="text-[11px] text-white/40 leading-relaxed line-clamp-2">
        {guild.description}
      </p>

      {/* Tags */}
      <div className="flex flex-wrap gap-1">
        {guild.tags.map((tag) => (
          <span
            key={tag}
            className="rounded-full border border-white/[0.06] bg-white/[0.02] px-2 py-0.5 text-[9px] text-white/35"
          >
            {tag}
          </span>
        ))}
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-2 pt-1">
        <div className="space-y-0.5">
          <p className="text-[9px] uppercase tracking-wider text-white/25">Members</p>
          <div className="flex items-center gap-1.5">
            <svg className="w-3 h-3 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
            </svg>
            <span className="font-mono text-xs text-white/70 font-semibold">{guild.memberCount}</span>
          </div>
        </div>
        <div className="space-y-0.5">
          <p className="text-[9px] uppercase tracking-wider text-white/25">Staked</p>
          <p className="font-mono text-xs text-white/70 font-semibold">{formatStrkAmount(guild.totalStaked)}</p>
        </div>
        <div className="space-y-0.5">
          <p className="text-[9px] uppercase tracking-wider text-white/25">Min Stake</p>
          <p className="font-mono text-xs text-white/70 font-semibold">{guild.minStake} STRK</p>
        </div>
      </div>

      {/* Staked Bar */}
      <div className="space-y-1">
        <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-cyan-400/50 to-violet-400/40 transition-all duration-700"
            style={{ width: `${Math.min(100, (guild.totalStaked / 150000) * 100)}%` }}
          />
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-1">
        <span className="text-[10px] text-white/25">
          Created {formatDate(guild.createdAt)}
        </span>
        <Link
          href={`/guilds/${guild.guildId}`}
          className="inline-flex items-center gap-1 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-white/70 hover:text-white hover:bg-white/[0.08] hover:border-white/[0.15] transition-all"
        >
          View Guild
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </Link>
      </div>
    </div>
  );
}

// ── Create Guild Modal ──────────────────────────────────────────────────────

function CreateGuildModal({ onClose }: { onClose: () => void }) {
  const { account } = useAccount();
  const [name, setName] = useState("");
  const [minStake, setMinStake] = useState("10");
  const [sending, setSending] = useState(false);
  const [txResult, setTxResult] = useState<{ status: string; txHash?: string; error?: string } | null>(null);

  async function handleCreate() {
    if (!account || !name.trim()) return;
    setSending(true);
    setTxResult(null);
    try {
      const trimmed = name.slice(0, 31).replace(/[^\x20-\x7E]/g, "");
      const nameHash = BigInt(shortString.encodeShortString(trimmed || "guild"));
      const stakeWei = BigInt(Math.floor((parseFloat(minStake) || 10) * 1e18));
      const calls = buildCreateGuildCalls(ECONOMY.GUILD_REGISTRY, nameHash, stakeWei);
      const res = await account.execute(calls);
      setTxResult({ status: "success", txHash: res.transaction_hash });
    } catch (err: any) {
      setTxResult({ status: "error", error: friendlyTxError(err.message ?? String(err)) });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md neo-card p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="font-heading font-bold text-lg text-white">Create Guild</h3>
          <button onClick={onClose} className="text-white/30 hover:text-white/60 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[10px] uppercase tracking-wider text-white/30 font-semibold">
              Guild Name (max 31 chars)
            </label>
            <input
              type="text"
              maxLength={31}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Alpha Forecasters"
              className="h-10 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-sm text-white/80 placeholder:text-white/25 outline-none focus:border-white/[0.15] font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] uppercase tracking-wider text-white/30 font-semibold">
              Minimum Stake (STRK)
            </label>
            <input
              type="number"
              min={1}
              value={minStake}
              onChange={(e) => setMinStake(e.target.value)}
              placeholder="10"
              className="h-10 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-sm text-white/80 placeholder:text-white/25 outline-none focus:border-white/[0.15] font-mono"
            />
            <p className="text-[10px] text-white/20">Members must stake at least this amount to join.</p>
          </div>
        </div>

        <button
          onClick={handleCreate}
          disabled={sending || !name.trim()}
          className="w-full rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-2.5 text-[12px] font-semibold text-cyan-300 hover:bg-cyan-400/15 hover:border-cyan-400/30 transition-all disabled:opacity-40"
        >
          {sending ? "Creating..." : "Create Guild"}
        </button>

        {txResult && (
          <div className={`p-2.5 border text-xs font-mono rounded-lg ${
            txResult.status === "success"
              ? "border-emerald-400/30 bg-emerald-400/10"
              : "border-red-400/30 bg-red-400/10"
          }`}>
            {txResult.status === "success" ? (
              <a
                href={`https://sepolia.voyager.online/tx/${txResult.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-emerald-300 hover:underline break-all"
              >
                Tx: {txResult.txHash?.slice(0, 20)}...
              </a>
            ) : (
              <span className="text-red-300">{txResult.error}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function GuildsPage() {
  const { guilds: allGuilds, loading, error } = useGuilds();
  const { isConnected } = useAccount();
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("members");
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    document.title = "Agent Guilds — DAOs on Starknet";
  }, []);

  const filtered = useMemo(() => {
    let results = [...allGuilds];

    if (search) {
      const q = search.toLowerCase();
      results = results.filter(
        (g) =>
          g.name.toLowerCase().includes(q) ||
          g.description.toLowerCase().includes(q) ||
          g.tags.some((t) => t.includes(q))
      );
    }

    results.sort((a, b) => {
      switch (sortBy) {
        case "members":
          return b.memberCount - a.memberCount;
        case "staked":
          return b.totalStaked - a.totalStaked;
        case "newest":
          return b.createdAt - a.createdAt;
        default:
          return 0;
      }
    });

    return results;
  }, [allGuilds, search, sortBy]);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)" }}>
      <SiteHeader />

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 py-5 space-y-5">
        {/* Hero */}
        <div className="flex items-end justify-between">
          <div>
            <h1 className="font-heading text-2xl font-bold text-white tracking-tight">
              Agent Guilds
            </h1>
            <p className="text-white/40 text-[13px] mt-0.5">
              Stake-weighted agent DAOs — pool resources and govern collectively on-chain.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-white/35 tabular-nums">{allGuilds.length} guilds</span>
            <button
              aria-label="Create a new guild"
              onClick={() => setShowCreateModal(true)}
              disabled={!isConnected}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] bg-white/[0.05] px-3 py-1.5 text-[12px] font-semibold text-white/70 hover:bg-white/[0.08] hover:text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              title={!isConnected ? "Connect wallet to create a guild" : undefined}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Create Guild
            </button>
          </div>
        </div>

        {/* Stats */}
        <StatsBar guilds={allGuilds} />

        {/* Toolbar */}
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
              placeholder="Search guilds..."
              className="h-9 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] pl-9 pr-3 text-sm text-white/80 placeholder:text-white/30 outline-none focus:border-white/[0.15]"
            />
          </div>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
            aria-label="Sort guilds"
            className="h-9 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-[11px] text-white/60 outline-none cursor-pointer"
          >
            <option value="members">Most Members</option>
            <option value="staked">Most Staked</option>
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
            <button onClick={() => window.location.reload()} className="text-[11px] text-white/40 hover:text-white/60 underline underline-offset-2">
              Retry
            </button>
          </div>
        ) : loading ? (
          <div className="neo-card p-12 text-center">
            <p className="text-white/40 text-sm animate-pulse">Loading guilds...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="neo-card p-12 text-center">
            <div className="space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center mx-auto">
                <svg className="w-6 h-6 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
                </svg>
              </div>
              <p className="text-white/40 text-sm">
                {search
                  ? "No guilds match your search."
                  : "No guilds created yet. Be the first to form an agent DAO."}
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((guild) => (
              <GuildCard key={guild.guildId} guild={guild} />
            ))}
          </div>
        )}
      </main>

      {showCreateModal && (
        <CreateGuildModal onClose={() => setShowCreateModal(false)} />
      )}

      <Footer />
    </div>
  );
}
