"use client";

import { useDeferredValue, useMemo, useState } from "react";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";
import useMarkets from "@/hooks/useMarkets";
import { categorizeMarket } from "@/lib/categories";
import { safeBigInt } from "@/components/dashboard/utils";
import type { Market } from "@/components/dashboard/types";

/* ------------------------------------------------------------------ */
/*  Asset identity — icons, colors, tickers                            */
/* ------------------------------------------------------------------ */

interface AssetMeta {
  ticker: string;
  label: string;
  gradient: string;       // card accent gradient
  iconBg: string;         // icon circle background
  iconBorder: string;     // icon circle border
  iconText: string;       // icon letter color
  badgeBg: string;        // ticker badge
  badgeText: string;
}

const ASSET_META: Record<string, AssetMeta> = {
  btc: {
    ticker: "BTC", label: "Bitcoin",
    gradient: "from-amber-500/8 to-orange-500/4",
    iconBg: "bg-gradient-to-br from-amber-400 to-orange-500",
    iconBorder: "ring-amber-400/30",
    iconText: "text-white",
    badgeBg: "bg-amber-500/15 border-amber-500/25",
    badgeText: "text-amber-400",
  },
  eth: {
    ticker: "ETH", label: "Ethereum",
    gradient: "from-indigo-500/8 to-violet-500/4",
    iconBg: "bg-gradient-to-br from-indigo-400 to-violet-500",
    iconBorder: "ring-indigo-400/30",
    iconText: "text-white",
    badgeBg: "bg-indigo-500/15 border-indigo-500/25",
    badgeText: "text-indigo-400",
  },
  sol: {
    ticker: "SOL", label: "Solana",
    gradient: "from-fuchsia-500/8 to-purple-500/4",
    iconBg: "bg-gradient-to-br from-fuchsia-400 to-purple-500",
    iconBorder: "ring-fuchsia-400/30",
    iconText: "text-white",
    badgeBg: "bg-fuchsia-500/15 border-fuchsia-500/25",
    badgeText: "text-fuchsia-400",
  },
  xrp: {
    ticker: "XRP", label: "XRP",
    gradient: "from-slate-400/8 to-zinc-500/4",
    iconBg: "bg-gradient-to-br from-slate-300 to-zinc-400",
    iconBorder: "ring-slate-400/30",
    iconText: "text-slate-900",
    badgeBg: "bg-slate-500/15 border-slate-500/25",
    badgeText: "text-slate-400",
  },
  strk: {
    ticker: "STRK", label: "Starknet",
    gradient: "from-cyan-500/8 to-teal-500/4",
    iconBg: "bg-gradient-to-br from-cyan-400 to-teal-500",
    iconBorder: "ring-cyan-400/30",
    iconText: "text-white",
    badgeBg: "bg-cyan-500/15 border-cyan-500/25",
    badgeText: "text-cyan-400",
  },
  doge: {
    ticker: "DOGE", label: "Dogecoin",
    gradient: "from-yellow-500/8 to-amber-500/4",
    iconBg: "bg-gradient-to-br from-yellow-400 to-amber-400",
    iconBorder: "ring-yellow-400/30",
    iconText: "text-yellow-900",
    badgeBg: "bg-yellow-500/15 border-yellow-500/25",
    badgeText: "text-yellow-400",
  },
  bnb: {
    ticker: "BNB", label: "BNB",
    gradient: "from-yellow-600/8 to-orange-600/4",
    iconBg: "bg-gradient-to-br from-yellow-500 to-orange-400",
    iconBorder: "ring-yellow-500/30",
    iconText: "text-black",
    badgeBg: "bg-yellow-500/15 border-yellow-600/25",
    badgeText: "text-yellow-500",
  },
  ada: {
    ticker: "ADA", label: "Cardano",
    gradient: "from-blue-500/8 to-sky-500/4",
    iconBg: "bg-gradient-to-br from-blue-400 to-sky-500",
    iconBorder: "ring-blue-400/30",
    iconText: "text-white",
    badgeBg: "bg-blue-500/15 border-blue-500/25",
    badgeText: "text-blue-400",
  },
  link: {
    ticker: "LINK", label: "Chainlink",
    gradient: "from-blue-600/8 to-indigo-600/4",
    iconBg: "bg-gradient-to-br from-blue-500 to-indigo-600",
    iconBorder: "ring-blue-500/30",
    iconText: "text-white",
    badgeBg: "bg-blue-600/15 border-blue-600/25",
    badgeText: "text-blue-500",
  },
};

const DEFAULT_ASSET: AssetMeta = {
  ticker: "???", label: "Unknown",
  gradient: "from-white/5 to-white/2",
  iconBg: "bg-gradient-to-br from-gray-400 to-gray-500",
  iconBorder: "ring-gray-400/30",
  iconText: "text-white",
  badgeBg: "bg-gray-500/15 border-gray-500/25",
  badgeText: "text-gray-400",
};

/* ------------------------------------------------------------------ */
/*  Series detection — group markets into cadence buckets               */
/* ------------------------------------------------------------------ */

type Cadence = "5m" | "15m" | "hourly" | "4h" | "daily" | "weekly" | "monthly";

interface SeriesMarket extends Market {
  asset: AssetMeta;
  assetKey: string;
  cadence: Cadence;
  isLive: boolean;
  timeLeftLabel: string;
  seriesTitle: string;
  avgVolume: number;
}

const CADENCE_META: Record<Cadence, { emoji: string; label: string; description: string; order: number }> = {
  "5m":      { emoji: "\u26A1", label: "5 Minutes",  description: "Ultra-fast prediction markets expiring every 5 minutes", order: 0 },
  "15m":     { emoji: "\u26A1", label: "15 Minutes", description: "Quick prediction markets expiring every 15 minutes", order: 1 },
  "hourly":  { emoji: "\u23F0", label: "Hourly",     description: "Markets expiring every hour", order: 2 },
  "4h":      { emoji: "\u23F3", label: "4 Hour",     description: "Markets expiring every 4 hours", order: 3 },
  "daily":   { emoji: "\uD83D\uDCC5", label: "Daily",      description: "Daily prediction markets", order: 4 },
  "weekly":  { emoji: "\uD83D\uDCCA", label: "Weekly",     description: "Weekly prediction markets", order: 5 },
  "monthly": { emoji: "\uD83D\uDCC6", label: "Monthly",    description: "Monthly and longer-term markets", order: 6 },
};

function detectAsset(question: string): { key: string; meta: AssetMeta } {
  const q = question.toLowerCase();
  if (/\bbitcoin\b|\bbtc\b/i.test(q)) return { key: "btc", meta: ASSET_META.btc };
  if (/\bethereum\b|\beth\b/i.test(q)) return { key: "eth", meta: ASSET_META.eth };
  if (/\bsolana\b|\bsol\b/i.test(q)) return { key: "sol", meta: ASSET_META.sol };
  if (/\bxrp\b/i.test(q)) return { key: "xrp", meta: ASSET_META.xrp };
  if (/\bstarknet\b|\bstrk\b/i.test(q)) return { key: "strk", meta: ASSET_META.strk };
  if (/\bdogecoin\b|\bdoge\b/i.test(q)) return { key: "doge", meta: ASSET_META.doge };
  if (/\bbnb\b|\bbinance\b/i.test(q)) return { key: "bnb", meta: ASSET_META.bnb };
  if (/\bcardano\b|\bada\b/i.test(q)) return { key: "ada", meta: ASSET_META.ada };
  if (/\bchainlink\b|\blink\b/i.test(q)) return { key: "link", meta: ASSET_META.link };
  return { key: "other", meta: DEFAULT_ASSET };
}

function detectCadence(question: string, resolutionTime: number): Cadence {
  const q = question.toLowerCase();
  const secsLeft = resolutionTime - Date.now() / 1000;
  const hoursLeft = secsLeft / 3600;

  if (/\b5\s?min(ute)?s?\b/i.test(q)) return "5m";
  if (/\b15\s?min(ute)?s?\b|\b15m\b/i.test(q)) return "15m";
  if (/\bhourly\b|\b1\s?h(ou)?r?\b/i.test(q)) return "hourly";
  if (/\b4\s?h(ou)?r?\b|\b4h\b/i.test(q)) return "4h";
  if (/\bdaily\b|\btoday\b|\btomorrow\b/i.test(q)) return "daily";
  if (/\bweekly\b|\bweek\b|\bsunday\b|\bsaturday\b/i.test(q)) return "weekly";
  if (/\bmonthly\b|\bmonth\b|\bquarter\b/i.test(q)) return "monthly";

  // Fallback: guess from resolution time
  if (hoursLeft <= 0.15) return "5m";
  if (hoursLeft <= 0.5) return "15m";
  if (hoursLeft <= 2) return "hourly";
  if (hoursLeft <= 6) return "4h";
  if (hoursLeft <= 48) return "daily";
  if (hoursLeft <= 240) return "weekly";
  return "monthly";
}

function formatTimeLeft(resolutionTime: number): { label: string; isLive: boolean } {
  const secsLeft = resolutionTime - Date.now() / 1000;
  if (secsLeft <= 0) return { label: "Ended", isLive: false };
  const days = Math.floor(secsLeft / 86400);
  const hours = Math.floor(secsLeft / 3600);
  const mins = Math.ceil((secsLeft % 3600) / 60);
  if (days > 0) return { label: `${days}d ${hours % 24}h`, isLive: true };
  if (hours > 0) return { label: `${hours}h ${mins}m`, isLive: true };
  return { label: `${mins}m`, isLive: true };
}

function buildSeriesTitle(question: string, cadence: Cadence): string {
  // Try to extract a short series name
  const match = question.match(/^(.+?)\s*[-–—]\s/);
  if (match) return match[1].trim();
  if (question.length > 40) return question.slice(0, 40) + "...";
  return question;
}

/* ------------------------------------------------------------------ */
/*  Components                                                          */
/* ------------------------------------------------------------------ */

function SeriesCard({ market }: { market: SeriesMarket }) {
  const yesPct = Math.round(market.impliedProbYes * 100);
  const noPct = 100 - yesPct;
  const poolStrk = Number(safeBigInt(market.totalPool)) / 1e18;

  return (
    <Link
      href={`/market/${market.id}`}
      className="group block no-underline"
    >
      <div className={`relative rounded-2xl border border-white/[0.06] bg-gradient-to-br ${market.asset.gradient} hover:border-white/[0.12] transition-all duration-200 overflow-hidden`}>
        {/* Subtle glow on hover */}
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" style={{ background: "radial-gradient(ellipse at top left, rgba(255,255,255,0.03) 0%, transparent 60%)" }} />

        <div className="relative p-4">
          {/* Header: icon + title + badges */}
          <div className="flex items-start gap-3 mb-3">
            <div className={`w-9 h-9 rounded-full ${market.asset.iconBg} ring-2 ${market.asset.iconBorder} flex items-center justify-center shrink-0 shadow-lg`}>
              <span className={`text-sm font-black ${market.asset.iconText}`}>
                {market.asset.ticker.charAt(0)}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-[14px] font-bold text-white/90 group-hover:text-white transition-colors leading-tight truncate">
                {market.seriesTitle}
              </h3>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-white/[0.06] border border-white/[0.08] text-white/40">
                  {CADENCE_META[market.cadence].label.replace(" ", "\u00A0")}
                </span>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${market.asset.badgeBg} ${market.asset.badgeText}`}>
                  {market.asset.ticker}
                </span>
              </div>
            </div>
          </div>

          {/* Status row */}
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-1.5">
              {market.isLive ? (
                <>
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-50" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
                  </span>
                  <span className="text-[11px] font-bold text-emerald-400">LIVE</span>
                </>
              ) : (
                <span className="text-[11px] font-semibold text-amber-400/70">upcoming</span>
              )}
            </div>
            <div className="flex items-center gap-1 text-white/30">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-[11px] font-mono tabular-nums">{market.timeLeftLabel}</span>
            </div>
          </div>

          {/* Description */}
          <p className="text-[12px] text-white/35 leading-relaxed mb-3 line-clamp-2">
            {market.question}
          </p>

          {/* Prices */}
          <div className="flex items-end justify-between">
            <div className="flex items-center gap-6">
              <div>
                <span className="text-[10px] text-white/25 block mb-0.5">Yes</span>
                <span className="text-xl font-bold tabular-nums text-emerald-400">{yesPct}%</span>
              </div>
              <div>
                <span className="text-[10px] text-white/25 block mb-0.5">No</span>
                <span className="text-xl font-bold tabular-nums text-rose-400">{noPct}%</span>
              </div>
            </div>
            <span className="text-[11px] font-mono text-white/20 tabular-nums">
              ${poolStrk > 0 ? poolStrk.toFixed(0) : "0"} avg
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                           */
/* ------------------------------------------------------------------ */

type CategoryFilter = "all" | "crypto" | "stocks";

export default function SeriesPage() {
  const { markets, loading } = useMarkets();
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [cadenceFilter, setCadenceFilter] = useState<Cadence | "all">("all");
  const [assetFilter, setAssetFilter] = useState<string>("all");
  const deferredQuery = useDeferredValue(searchQuery.trim().toLowerCase());

  // Build series markets
  const seriesMarkets = useMemo<SeriesMarket[]>(() => {
    return markets.map((m) => {
      const { key, meta } = detectAsset(m.question);
      const cadence = detectCadence(m.question, m.resolutionTime);
      const { label, isLive } = formatTimeLeft(m.resolutionTime);
      const poolStrk = Number(safeBigInt(m.totalPool)) / 1e18;
      return {
        ...m,
        asset: meta,
        assetKey: key,
        cadence,
        isLive,
        timeLeftLabel: label,
        seriesTitle: buildSeriesTitle(m.question, cadence),
        avgVolume: poolStrk,
      };
    });
  }, [markets]);

  // Asset counts for filter chips
  const assetCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of seriesMarkets) {
      counts[m.assetKey] = (counts[m.assetKey] ?? 0) + 1;
    }
    return Object.entries(counts)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1]);
  }, [seriesMarkets]);

  // Filter
  const filtered = useMemo(() => {
    return seriesMarkets.filter((m) => {
      if (deferredQuery && !m.question.toLowerCase().includes(deferredQuery) && !m.seriesTitle.toLowerCase().includes(deferredQuery)) return false;
      if (categoryFilter === "crypto") {
        const cat = categorizeMarket(m.question);
        if (cat !== "crypto" && cat !== "finance") return false;
      }
      if (categoryFilter === "stocks") {
        const cat = categorizeMarket(m.question);
        if (cat !== "finance" && cat !== "earnings") return false;
      }
      if (cadenceFilter !== "all" && m.cadence !== cadenceFilter) return false;
      if (assetFilter !== "all" && m.assetKey !== assetFilter) return false;
      return true;
    });
  }, [seriesMarkets, deferredQuery, categoryFilter, cadenceFilter, assetFilter]);

  // Group by cadence
  const groupedByCadence = useMemo(() => {
    const groups: Record<Cadence, SeriesMarket[]> = {
      "5m": [], "15m": [], hourly: [], "4h": [], daily: [], weekly: [], monthly: [],
    };
    for (const m of filtered) {
      groups[m.cadence].push(m);
    }
    // Sort each group: live first, then by time left ascending
    for (const key of Object.keys(groups) as Cadence[]) {
      groups[key].sort((a, b) => {
        if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
        return a.resolutionTime - b.resolutionTime;
      });
    }
    return groups;
  }, [filtered]);

  const liveCount = filtered.filter((m) => m.isLive).length;

  const CADENCE_TABS: { id: Cadence | "all"; label: string }[] = [
    { id: "all", label: "All" },
    { id: "5m", label: "5 Minutes" },
    { id: "15m", label: "15 Minutes" },
    { id: "hourly", label: "Hourly" },
    { id: "4h", label: "4 Hour" },
    { id: "daily", label: "Daily" },
    { id: "weekly", label: "Weekly" },
    { id: "monthly", label: "Monthly" },
  ];

  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader />

      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-20">
        {/* ---- Hero Stats ---- */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white tracking-tight mb-1">Series Markets</h1>
          <p className="text-sm text-white/40 mb-5">
            Repeating prediction markets for crypto prices, sports, and more. Markets auto-renew on schedule.
          </p>
          <div className="flex items-center gap-6">
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-black text-white tabular-nums">{filtered.length}</span>
              <span className="text-sm text-white/40">Series</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-40" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400" />
              </span>
              <span className="text-4xl font-black text-white tabular-nums">{liveCount}</span>
              <span className="text-sm text-white/40">Live Now</span>
            </div>
          </div>
        </div>

        {/* ---- Search ---- */}
        <div className="relative mb-5">
          <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/25" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search series..."
            className="w-full max-w-lg pl-11 pr-4 py-3 rounded-xl text-sm text-white bg-white/[0.04] border border-white/[0.08] focus:border-white/[0.15] outline-none placeholder:text-white/20 transition-colors"
          />
        </div>

        {/* ---- Category + Cadence Filters ---- */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          {/* Category tabs */}
          <div className="flex items-center gap-1 bg-white/[0.03] border border-white/[0.06] rounded-xl p-1">
            {([
              { id: "all" as CategoryFilter, label: "All", count: seriesMarkets.length },
              { id: "crypto" as CategoryFilter, label: "Crypto", icon: "\u20BF" },
              { id: "stocks" as CategoryFilter, label: "Stocks", icon: "\u2191\u2193" },
            ]).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setCategoryFilter(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${
                  categoryFilter === tab.id
                    ? "bg-neo-brand text-white shadow-sm"
                    : "text-white/40 hover:text-white/60"
                }`}
              >
                {tab.icon && <span className="mr-1">{tab.icon}</span>}
                {tab.label}
                {"count" in tab && <span className="ml-1 text-[10px] opacity-60">{tab.count}</span>}
              </button>
            ))}
          </div>

          <div className="h-5 w-px bg-white/[0.06]" />

          {/* Cadence tabs */}
          <div className="flex items-center gap-0.5 overflow-x-auto hide-scrollbar">
            {CADENCE_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setCadenceFilter(tab.id)}
                className={`whitespace-nowrap px-2.5 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${
                  cadenceFilter === tab.id
                    ? "bg-white/[0.08] text-white"
                    : "text-white/30 hover:text-white/55"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* ---- Asset Filter Chips ---- */}
        <div className="flex flex-wrap items-center gap-2 mb-8">
          <div className="flex items-center gap-1.5 text-white/30">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" />
            </svg>
            <span className="text-[11px] font-semibold">Filter by:</span>
          </div>

          <button
            type="button"
            onClick={() => setAssetFilter("all")}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all ${
              assetFilter === "all"
                ? "bg-neo-brand/20 border-neo-brand/40 text-neo-brand"
                : "bg-white/[0.03] border-white/[0.06] text-white/40 hover:text-white/60"
            }`}
          >
            All
          </button>

          {assetCounts.map(([key, count]) => {
            const meta = ASSET_META[key] ?? DEFAULT_ASSET;
            const isActive = assetFilter === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setAssetFilter(isActive ? "all" : key)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all ${
                  isActive
                    ? `${meta.badgeBg} ${meta.badgeText}`
                    : "bg-white/[0.03] border-white/[0.06] text-white/45 hover:text-white/65"
                }`}
              >
                {meta.ticker}
                <span className="ml-1.5 opacity-50">{count}</span>
              </button>
            );
          })}
        </div>

        {/* ---- Cadence Sections ---- */}
        {loading ? (
          <div className="space-y-12">
            {[1, 2, 3].map((i) => (
              <div key={i}>
                <div className="h-6 w-40 bg-white/[0.04] rounded animate-pulse mb-4" />
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {[1, 2, 3, 4].map((j) => (
                    <div key={j} className="h-52 rounded-2xl bg-white/[0.03] animate-pulse" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 rounded-2xl border border-white/[0.04] bg-white/[0.01]">
            <div className="w-14 h-14 rounded-2xl bg-white/[0.03] border border-white/[0.05] flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-white/15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m5.231 13.481L15 17.25m-4.5-15H5.625c-.621 0-1.125.504-1.125 1.125v16.5c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
            </div>
            <p className="text-sm text-white/35 font-semibold mb-1">No series found</p>
            <p className="text-xs text-white/20">Try adjusting filters or search query</p>
          </div>
        ) : (
          <div className="space-y-12">
            {(Object.entries(CADENCE_META) as [Cadence, typeof CADENCE_META[Cadence]][])
              .sort((a, b) => a[1].order - b[1].order)
              .map(([cadence, meta]) => {
                const group = groupedByCadence[cadence];
                if (group.length === 0) return null;
                if (cadenceFilter !== "all" && cadenceFilter !== cadence) return null;

                return (
                  <section key={cadence}>
                    {/* Section header */}
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-xl">{meta.emoji}</span>
                      <h2 className="text-xl font-bold text-white">{meta.label}</h2>
                      <span className="text-[11px] font-bold text-white/40 bg-white/[0.06] px-2 py-0.5 rounded-full tabular-nums">
                        {group.length}
                      </span>
                    </div>
                    <p className="text-[13px] text-white/30 mb-4">{meta.description}</p>

                    {/* Cards grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                      {group.map((market) => (
                        <SeriesCard key={market.id} market={market} />
                      ))}
                    </div>
                  </section>
                );
              })}
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}
