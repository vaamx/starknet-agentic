"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { useAccount } from "@starknet-react/core";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";
import { buildLaunchTokenCalls, ECONOMY } from "@/lib/contracts";

// ── Types ────────────────────────────────────────────────────────────────────

type CurveType = "linear" | "quadratic" | "sigmoid";

interface TokenLaunch {
  id: string;
  name: string;
  symbol: string;
  curveType: CurveType;
  currentPrice: number;
  totalSupply: number;
  reserveBalance: number;
  creator: string;
  createdAt: number;
  volume24h: number;
  priceDirection: "up" | "down" | "flat";
  agentId?: number;
}

// ── Data fetching ────────────────────────────────────────────────────────────

function useTokenLaunches() {
  const [tokens, setTokens] = useState<TokenLaunch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = () => {
    setLoading(true);
    fetch("/api/starkmint/tokens")
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load tokens (${r.status})`);
        return r.json();
      })
      .then((data) => {
        const tokens = (data.tokens ?? []).map((t: any) => ({
          ...t,
          volume24h: t.volume24h ?? 0,
          priceDirection: t.priceDirection ?? "flat",
          currentPrice: typeof t.currentPrice === "number" ? t.currentPrice : 0,
          totalSupply: typeof t.totalSupply === "number" ? t.totalSupply : 0,
          reserveBalance: typeof t.reserveBalance === "number" ? t.reserveBalance : 0,
        }));
        setTokens(tokens);
      })
      .catch((e) => setError(e.message ?? "Failed to load tokens"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { refetch(); }, []);

  return { tokens, loading, error, refetch };
}

// ── Constants ────────────────────────────────────────────────────────────────

const CURVE_FILTERS = ["all", "linear", "quadratic", "sigmoid"] as const;
type CurveFilter = (typeof CURVE_FILTERS)[number];

const SORT_OPTIONS = ["newest", "volume", "price"] as const;
type SortOption = (typeof SORT_OPTIONS)[number];

const CURVE_COLORS: Record<CurveType, { bg: string; text: string; border: string }> = {
  linear: { bg: "bg-cyan-400/10", text: "text-cyan-300", border: "border-cyan-400/20" },
  quadratic: { bg: "bg-violet-400/10", text: "text-violet-300", border: "border-violet-400/20" },
  sigmoid: { bg: "bg-amber-400/10", text: "text-amber-300", border: "border-amber-400/20" },
};

const DIRECTION_COLORS: Record<string, string> = {
  up: "from-emerald-500/60 to-emerald-400/20",
  down: "from-red-500/60 to-red-400/20",
  flat: "from-white/20 to-white/5",
};

const CURVE_TYPE_MAP: Record<string, number> = { linear: 0, quadratic: 1, sigmoid: 2 };

// ── Helpers ──────────────────────────────────────────────────────────────────

function truncateAddress(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatNumber(n: number | undefined | null): string {
  if (n == null || isNaN(n)) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatPrice(n: number): string {
  if (n === 0) return "0";
  if (n < 0.0001) return "< 0.0001";
  if (n < 1) return n.toFixed(4);
  if (n < 1000) return n.toFixed(2);
  return formatNumber(n);
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return "< 1h ago";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ── Components ───────────────────────────────────────────────────────────────

function PriceBar({ direction }: { direction: "up" | "down" | "flat" }) {
  return (
    <div className="w-16 h-1.5 rounded-full overflow-hidden bg-white/[0.04]">
      <div
        className={`h-full rounded-full bg-gradient-to-r ${DIRECTION_COLORS[direction]} transition-all duration-500`}
        style={{ width: direction === "flat" ? "50%" : direction === "up" ? "75%" : "30%" }}
      />
    </div>
  );
}

function StatsBar({ launches }: { launches: TokenLaunch[] }) {
  const totalVolume = launches.reduce((s, t) => s + (t.volume24h || 0), 0);
  const activeCurves = new Set(launches.map((t) => t.curveType)).size;
  const uniqueCreators = new Set(launches.map((t) => t.creator)).size;

  const stats = [
    { label: "Total Launches", value: launches.length.toString() },
    { label: "Total Volume", value: `${formatNumber(totalVolume)} STRK` },
    { label: "Active Curves", value: activeCurves.toString() },
    { label: "Unique Creators", value: uniqueCreators.toString() },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {stats.map((s) => (
        <div
          key={s.label}
          className="neo-card p-3 text-center space-y-1"
        >
          <p className="text-[10px] uppercase tracking-wider text-white/35">{s.label}</p>
          <p className="font-heading font-bold text-lg text-white">{s.value}</p>
        </div>
      ))}
    </div>
  );
}

// ── Launch Token Modal ───────────────────────────────────────────────────────

function LaunchTokenModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { isConnected, account } = useAccount();
  const [sending, setSending] = useState(false);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [curveType, setCurveType] = useState<CurveType>("linear");
  const [feeBps, setFeeBps] = useState("100");
  const [txResult, setTxResult] = useState<{ status: string; txHash?: string; error?: string } | null>(null);

  async function handleLaunch() {
    if (!name.trim() || !symbol.trim() || !account) return;
    if (name.length > 31 || symbol.length > 31) return;
    setTxResult(null);
    setSending(true);
    try {
      const factoryAddress = ECONOMY.BONDING_CURVE_FACTORY;
      if (factoryAddress === "0x0") {
        setTxResult({ status: "error", error: "Factory contract not configured" });
        return;
      }
      const calls = buildLaunchTokenCalls(
        factoryAddress,
        name.trim(),
        symbol.trim().toUpperCase(),
        CURVE_TYPE_MAP[curveType],
        parseInt(feeBps, 10) || 100,
      );
      const res = await account.execute(calls);
      setTxResult({ status: "success", txHash: res.transaction_hash });
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 2000);
    } catch (err: any) {
      setTxResult({ status: "error", error: err.message ?? "Transaction failed" });
    } finally {
      setSending(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="neo-card w-full max-w-md mx-4 p-6 space-y-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-heading font-bold text-lg text-white">Launch Token</h2>
          <button onClick={onClose} className="text-white/30 hover:text-white/60 transition-colors text-xl leading-none">&times;</button>
        </div>

        {!isConnected ? (
          <div className="text-center py-8 border border-dashed border-white/10 rounded-xl">
            <p className="text-white/50 text-sm">Connect your wallet to launch a token</p>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-white/35 block mb-1">
                  Token Name <span className="text-white/20">(max 31 chars)</span>
                </label>
                <input
                  type="text"
                  maxLength={31}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. OracleNode"
                  className="w-full h-10 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-sm text-white placeholder:text-white/20 outline-none focus:border-white/[0.15]"
                />
              </div>

              <div>
                <label className="text-[10px] uppercase tracking-wider text-white/35 block mb-1">
                  Symbol <span className="text-white/20">(max 31 chars)</span>
                </label>
                <input
                  type="text"
                  maxLength={31}
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                  placeholder="e.g. ORCL"
                  className="w-full h-10 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-sm font-mono text-white placeholder:text-white/20 outline-none focus:border-white/[0.15]"
                />
              </div>

              <div>
                <label className="text-[10px] uppercase tracking-wider text-white/35 block mb-1">
                  Bonding Curve
                </label>
                <div className="flex gap-2">
                  {(["linear", "quadratic", "sigmoid"] as const).map((ct) => {
                    const cc = CURVE_COLORS[ct];
                    return (
                      <button
                        key={ct}
                        onClick={() => setCurveType(ct)}
                        className={`flex-1 rounded-lg py-2 text-[11px] font-semibold capitalize transition-all border ${
                          curveType === ct
                            ? `${cc.bg} ${cc.text} ${cc.border}`
                            : "text-white/40 border-white/[0.06] hover:text-white/60"
                        }`}
                      >
                        {ct}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="text-[10px] uppercase tracking-wider text-white/35 block mb-1">
                  Fee <span className="text-white/20">(basis points, max 1000)</span>
                </label>
                <input
                  type="number"
                  min="0"
                  max="1000"
                  value={feeBps}
                  onChange={(e) => setFeeBps(e.target.value)}
                  className="w-full h-10 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-sm font-mono text-white placeholder:text-white/20 outline-none focus:border-white/[0.15]"
                />
                <p className="text-[9px] text-white/20 mt-1">
                  {parseInt(feeBps, 10) || 0} bps = {((parseInt(feeBps, 10) || 0) / 100).toFixed(2)}% per trade
                </p>
              </div>
            </div>

            <button
              onClick={handleLaunch}
              disabled={sending || !name.trim() || !symbol.trim() || name.length > 31 || symbol.length > 31}
              className="w-full h-11 rounded-xl bg-gradient-to-r from-violet-500 to-cyan-500 text-white text-sm font-semibold hover:from-violet-400 hover:to-cyan-400 transition-all shadow-lg shadow-violet-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {sending ? "Signing Transaction..." : "Launch Token"}
            </button>

            {txResult && (
              <div className={`p-3 border text-xs font-mono rounded-lg ${
                txResult.status === "success"
                  ? "border-emerald-400/30 bg-emerald-400/10"
                  : "border-red-400/30 bg-red-400/10"
              }`}>
                {txResult.status === "success" ? (
                  <>
                    <span className="font-bold text-emerald-300">Token launched!</span>
                    {txResult.txHash && (
                      <a
                        href={`https://sepolia.voyager.online/tx/${txResult.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-sky-400/70 mt-1 hover:underline break-all"
                      >
                        {txResult.txHash.slice(0, 20)}...
                      </a>
                    )}
                  </>
                ) : (
                  <span className="text-red-300">{txResult.error}</span>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function StarkMintPage() {
  const { tokens: allTokens, loading, error, refetch } = useTokenLaunches();
  const [search, setSearch] = useState("");
  const [curveFilter, setCurveFilter] = useState<CurveFilter>("all");
  const [sortBy, setSortBy] = useState<SortOption>("newest");
  const [showLaunchModal, setShowLaunchModal] = useState(false);

  useEffect(() => {
    document.title = "StarkMint — Agent Token Launchpad";
  }, []);

  const filtered = useMemo(() => {
    let tokens = [...allTokens];

    if (curveFilter !== "all") {
      tokens = tokens.filter((t) => t.curveType === curveFilter);
    }

    if (search) {
      const q = search.toLowerCase();
      tokens = tokens.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.symbol.toLowerCase().includes(q) ||
          t.creator.toLowerCase().includes(q)
      );
    }

    tokens.sort((a, b) => {
      if (sortBy === "newest") return b.createdAt - a.createdAt;
      if (sortBy === "volume") return b.volume24h - a.volume24h;
      return b.currentPrice - a.currentPrice;
    });

    return tokens;
  }, [allTokens, search, curveFilter, sortBy]);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)" }}>
      <SiteHeader />

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* Hero */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div className="space-y-2">
            <h1 className="font-heading text-3xl sm:text-4xl font-bold text-white tracking-tight">
              StarkMint
            </h1>
            <p className="text-white/50 text-sm max-w-xl">
              Agent token launchpad on Starknet. Launch tokens with bonding curves --
              linear, quadratic, or sigmoid. Prices adjust automatically as supply
              changes.
            </p>
            <div className="flex items-center gap-3 pt-1">
              <span className="neo-badge text-[10px]">{allTokens.length} launches</span>
              <span className="text-white/25 text-[10px]">Sepolia</span>
            </div>
          </div>

          <button
            onClick={() => setShowLaunchModal(true)}
            className="shrink-0 h-10 px-5 rounded-xl bg-gradient-to-r from-violet-500 to-cyan-500 text-white text-sm font-semibold hover:from-violet-400 hover:to-cyan-400 transition-all shadow-lg shadow-violet-500/20"
          >
            Launch Token
          </button>
        </div>

        {/* Stats */}
        <StatsBar launches={allTokens} />

        {/* Filters */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 max-w-sm">
            <svg
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
              />
            </svg>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tokens..."
              className="h-9 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] pl-9 pr-3 text-sm text-white/80 placeholder:text-white/30 outline-none focus:border-white/[0.15]"
            />
          </div>

          {/* Curve type filters */}
          <div className="flex items-center gap-1 flex-wrap" aria-label="Filter by curve type" role="group">
            {CURVE_FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setCurveFilter(f)}
                className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold capitalize transition-all ${
                  curveFilter === f
                    ? "bg-white/[0.1] text-white border border-white/[0.12]"
                    : "text-white/40 hover:text-white/60 border border-transparent"
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Sort */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
            className="h-9 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-[11px] text-white/60 outline-none cursor-pointer"
          >
            <option value="newest">Newest</option>
            <option value="volume">Volume</option>
            <option value="price">Price</option>
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
            <p className="text-white/40 text-sm animate-pulse">Loading tokens...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="neo-card p-12 text-center">
            <div className="space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-white/[0.04] border border-white/[0.06] mx-auto flex items-center justify-center">
                <svg className="w-6 h-6 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125v-3.75" />
                </svg>
              </div>
              <p className="text-white/40 text-sm">
                {allTokens.length === 0
                  ? "No tokens launched yet. Be the first."
                  : "No tokens match your filters."}
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((token) => {
              const cc = CURVE_COLORS[token.curveType];
              return (
                <div
                  key={token.id}
                  className="neo-card-hover p-4 space-y-3 group"
                >
                  {/* Header */}
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-white/[0.08] to-white/[0.02] border border-white/[0.08] flex items-center justify-center shrink-0">
                        <span className="font-heading font-bold text-sm text-white/60">
                          {token.symbol.charAt(0)}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="font-heading font-bold text-sm text-white truncate group-hover:text-white/90">
                          {token.name}
                        </p>
                        <p className="font-mono text-[10px] text-white/35">${token.symbol}</p>
                      </div>
                    </div>
                    <span
                      className={`shrink-0 inline-flex items-center rounded-md border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${cc.bg} ${cc.text} ${cc.border}`}
                    >
                      {token.curveType}
                    </span>
                  </div>

                  {/* Price + Direction */}
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-white/35">
                        Price
                      </p>
                      <p className="font-mono font-bold text-base text-white">
                        {formatPrice(token.currentPrice)}{" "}
                        <span className="text-[10px] text-white/30 font-normal">STRK</span>
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span
                        className={`text-[10px] font-semibold ${
                          token.priceDirection === "up"
                            ? "text-emerald-400"
                            : token.priceDirection === "down"
                            ? "text-red-400"
                            : "text-white/30"
                        }`}
                      >
                        {token.priceDirection === "up"
                          ? "trending up"
                          : token.priceDirection === "down"
                          ? "trending down"
                          : "stable"}
                      </span>
                      <PriceBar direction={token.priceDirection} />
                    </div>
                  </div>

                  {/* Stats row */}
                  <div className="grid grid-cols-3 gap-2 pt-1 border-t border-white/[0.05]">
                    <div>
                      <p className="text-[9px] uppercase tracking-wider text-white/30">Supply</p>
                      <p className="font-mono text-[11px] text-white/70">
                        {formatNumber(token.totalSupply)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[9px] uppercase tracking-wider text-white/30">Reserve</p>
                      <p className="font-mono text-[11px] text-white/70">
                        {formatNumber(token.reserveBalance)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[9px] uppercase tracking-wider text-white/30">Vol 24h</p>
                      <p className="font-mono text-[11px] text-white/70">
                        {formatNumber(token.volume24h)}
                      </p>
                    </div>
                  </div>

                  {/* Creator + CTA */}
                  <div className="flex items-center justify-between pt-1">
                    <span className="font-mono text-[10px] text-white/25">
                      {truncateAddress(token.creator)}
                    </span>
                    <Link
                      href={`/starkmint/${token.id}`}
                      className="rounded-lg bg-white/[0.06] border border-white/[0.08] px-3 py-1 text-[11px] font-semibold text-white/70 hover:bg-white/[0.1] hover:text-white transition-all"
                    >
                      Trade
                    </Link>
                  </div>

                  {/* Created at */}
                  <p className="text-[9px] text-white/20">{timeAgo(token.createdAt)}</p>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <Footer />

      <LaunchTokenModal
        open={showLaunchModal}
        onClose={() => setShowLaunchModal(false)}
        onSuccess={refetch}
      />
    </div>
  );
}
