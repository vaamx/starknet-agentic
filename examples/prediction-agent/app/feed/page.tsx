"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import SiteHeader from "../components/SiteHeader";
import Footer from "../components/Footer";
import useMarkets from "../hooks/useMarkets";
import { categorizeMarket } from "@/lib/categories";
import { safeBigInt } from "../components/dashboard/utils";
import type { Market } from "../components/dashboard/types";

/* ─── Category metadata ─────────────────────────────────── */
const CAT_META: Record<string, { icon: string; label: string; color: string }> = {
  sports:      { icon: "\u{1F3C8}", label: "Sports",      color: "#10b981" },
  crypto:      { icon: "\u20BF",    label: "Crypto",      color: "#f59e0b" },
  politics:    { icon: "\u{1F3DB}\uFE0F", label: "Politics", color: "#6366f1" },
  tech:        { icon: "\u{1F4BB}", label: "Tech",        color: "#8b5cf6" },
  elections:   { icon: "\u{1F5F3}\uFE0F", label: "Elections", color: "#818cf8" },
  geopolitics: { icon: "\u{1F30D}", label: "Geopolitics", color: "#f472b6" },
  finance:     { icon: "\u{1F4C8}", label: "Finance",     color: "#22d3ee" },
  earnings:    { icon: "\u{1F4B0}", label: "Earnings",    color: "#a78bfa" },
  economy:     { icon: "\u{1F3E6}", label: "Economy",     color: "#fbbf24" },
  climate:     { icon: "\u{1F33F}", label: "Climate",     color: "#4ade80" },
  culture:     { icon: "\u{1F3AC}", label: "Culture",     color: "#fb923c" },
  world:       { icon: "\u{1F310}", label: "World",       color: "#ec4899" },
  other:       { icon: "\u{2728}",  label: "Other",       color: "#94a3b8" },
};

/* ─── Helpers ────────────────────────────────────────────── */

function poolToUsd(pool: string): number {
  try {
    const wei = BigInt(pool);
    return Number(wei) / 1e18;
  } catch {
    return 0;
  }
}

function formatPool(pool: string): string {
  const usd = poolToUsd(pool);
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`;
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(1)}K`;
  if (usd >= 1) return `$${usd.toFixed(0)}`;
  return "$0";
}

function timeLeft(resolutionTime: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = resolutionTime - now;
  if (diff <= 0) return "Ended";
  if (diff < 3600) return `${Math.ceil(diff / 60)}m left`;
  if (diff < 86400) return `${Math.ceil(diff / 3600)}h left`;
  if (diff < 2592000) return `${Math.ceil(diff / 86400)}d left`;
  return `${Math.ceil(diff / 2592000)}mo left`;
}

function isOpen(m: Market): boolean {
  const now = Math.floor(Date.now() / 1000);
  return m.status === 0 && m.resolutionTime > now;
}

/* ─── Feed Card ──────────────────────────────────────────── */

function FeedCard({ market, rank }: { market: Market; rank?: number }) {
  const cat = (market.category as string) ?? categorizeMarket(market.question);
  const meta = CAT_META[cat] ?? CAT_META.other;
  const prob = Math.round((market.impliedProbYes ?? 0.5) * 100);
  const pool = formatPool(market.totalPool);
  const remaining = timeLeft(market.resolutionTime);
  const resolved = market.status === 2 || market.resolutionTime <= Math.floor(Date.now() / 1000);

  return (
    <Link
      href={`/market/${market.id}`}
      className="group relative flex flex-col bg-[#1a1d27] border border-white/[0.06] rounded-xl overflow-hidden hover:border-neo-brand/30 transition-all duration-300 hover:shadow-lg hover:shadow-neo-brand/5"
    >
      {/* Image or gradient header */}
      {market.imageUrl ? (
        <div className="relative h-36 overflow-hidden">
          <img
            src={market.imageUrl}
            alt=""
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#1a1d27] via-transparent to-transparent" />
        </div>
      ) : (
        <div
          className="relative h-24 overflow-hidden"
          style={{
            background: `linear-gradient(135deg, ${meta.color}15, ${meta.color}05)`,
          }}
        >
          <div className="absolute top-3 left-3 text-3xl opacity-40">{meta.icon}</div>
          <div className="absolute inset-0 bg-gradient-to-t from-[#1a1d27] via-transparent to-transparent" />
        </div>
      )}

      {/* Badges row */}
      <div className="px-4 -mt-4 relative z-10 flex items-center gap-2">
        {rank !== undefined && (
          <span className="text-[10px] font-heading font-bold bg-neo-brand/20 text-neo-brand border border-neo-brand/30 px-2 py-0.5 rounded-full">
            #{rank}
          </span>
        )}
        <span
          className="text-[10px] font-body font-medium px-2 py-0.5 rounded-full border"
          style={{
            color: meta.color,
            borderColor: `${meta.color}40`,
            backgroundColor: `${meta.color}15`,
          }}
        >
          {meta.label}
        </span>
        {market.source === "polymarket" && (
          <span className="text-[10px] font-body text-white/30 px-1.5 py-0.5 rounded bg-white/5">
            Polymarket
          </span>
        )}
        {resolved && (
          <span className="text-[10px] font-body font-medium px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-400 border border-sky-500/30">
            Resolved
          </span>
        )}
      </div>

      {/* Content */}
      <div className="px-4 pt-3 pb-4 flex-1 flex flex-col gap-3">
        <h3 className="font-heading font-semibold text-sm text-white/90 leading-snug line-clamp-2 group-hover:text-white transition-colors">
          {market.question}
        </h3>

        {/* Probability bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-body text-white/50">Yes</span>
            <span className={`text-sm font-heading font-bold ${prob >= 50 ? "text-emerald-400" : "text-rose-400"}`}>
              {prob}%
            </span>
          </div>
          <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${prob}%`,
                background: prob >= 50
                  ? "linear-gradient(90deg, #10b981, #00d4b8)"
                  : "linear-gradient(90deg, #f43f5e, #fb7185)",
              }}
            />
          </div>
        </div>

        {/* Footer stats */}
        <div className="flex items-center justify-between mt-auto pt-2 border-t border-white/[0.04]">
          <div className="flex items-center gap-3 text-[11px] font-body text-white/40">
            <span>{pool}</span>
            {(market.tradeCount ?? 0) > 0 && (
              <span>{market.tradeCount} trades</span>
            )}
          </div>
          <span className={`text-[11px] font-body ${resolved ? "text-sky-400/60" : "text-white/30"}`}>
            {remaining}
          </span>
        </div>
      </div>
    </Link>
  );
}

/* ─── Section component ──────────────────────────────────── */

function FeedSection({
  icon,
  title,
  subtitle,
  markets,
  viewAllHref,
  showRank,
}: {
  icon: string;
  title: string;
  subtitle: string;
  markets: Market[];
  viewAllHref?: string;
  showRank?: boolean;
}) {
  if (markets.length === 0) return null;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">{icon}</span>
          <h2 className="font-heading font-bold text-lg text-white">{title}</h2>
          <span className="text-xs font-body text-white/30 hidden sm:inline">({subtitle})</span>
        </div>
        {viewAllHref && (
          <Link
            href={viewAllHref}
            className="text-xs font-body text-neo-brand/70 hover:text-neo-brand flex items-center gap-1 transition-colors"
          >
            View all <span aria-hidden>&rarr;</span>
          </Link>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {markets.map((m, i) => (
          <FeedCard key={m.id} market={m} rank={showRank ? i + 1 : undefined} />
        ))}
      </div>
    </section>
  );
}

/* ─── Main Feed Page ─────────────────────────────────────── */

export default function FeedPage() {
  const { markets, loading } = useMarkets();

  // Filter to on-chain only (non-polymarket)
  const onChainMarkets = useMemo(
    () => markets.filter((m) => m.source !== "polymarket"),
    [markets]
  );

  const allMarkets = useMemo(
    () => markets,
    [markets]
  );

  const nowSec = Math.floor(Date.now() / 1000);

  // Breaking: highest implied probability change / most extreme probabilities
  const breaking = useMemo(() => {
    return [...allMarkets]
      .filter(isOpen)
      .filter((m) => Math.abs((m.oneDayChange ?? 0)) > 0 || (m.impliedProbYes > 0.85 || m.impliedProbYes < 0.15))
      .sort((a, b) => Math.abs(b.oneDayChange ?? 0) - Math.abs(a.oneDayChange ?? 0))
      .slice(0, 4);
  }, [allMarkets]);

  // Hot: highest volume / trade count (on-chain)
  const hot = useMemo(() => {
    return [...onChainMarkets]
      .filter(isOpen)
      .sort((a, b) => {
        const aScore = (a.tradeCount ?? 0) * 10 + poolToUsd(a.totalPool);
        const bScore = (b.tradeCount ?? 0) * 10 + poolToUsd(b.totalPool);
        return bScore - aScore;
      })
      .slice(0, 4);
  }, [onChainMarkets]);

  // Ending soon: soonest resolution time
  const endingSoon = useMemo(() => {
    return [...allMarkets]
      .filter((m) => isOpen(m) && m.resolutionTime > nowSec && m.resolutionTime - nowSec < 7 * 86400)
      .sort((a, b) => a.resolutionTime - b.resolutionTime)
      .slice(0, 4);
  }, [allMarkets, nowSec]);

  // New: most recently created (highest ID)
  const newest = useMemo(() => {
    return [...onChainMarkets]
      .filter(isOpen)
      .sort((a, b) => b.id - a.id)
      .slice(0, 4);
  }, [onChainMarkets]);

  // On-chain Starknet spotlight — highest pool on-chain markets
  const starknetSpotlight = useMemo(() => {
    return [...onChainMarkets]
      .filter(isOpen)
      .sort((a, b) => poolToUsd(b.totalPool) - poolToUsd(a.totalPool))
      .slice(0, 8);
  }, [onChainMarkets]);

  // Recently resolved
  const recentlyResolved = useMemo(() => {
    return [...allMarkets]
      .filter((m) => m.status === 2 || (m.resolutionTime <= nowSec && m.resolutionTime > nowSec - 7 * 86400))
      .sort((a, b) => b.resolutionTime - a.resolutionTime)
      .slice(0, 4);
  }, [allMarkets, nowSec]);

  // Category spotlight — pick a random underrepresented category to highlight
  const categorySpotlight = useMemo(() => {
    const targetCats = ["culture", "tech", "geopolitics", "climate", "world", "earnings"];
    const open = allMarkets.filter(isOpen);
    for (const cat of targetCats) {
      const catMarkets = open.filter(
        (m) => (m.category ?? categorizeMarket(m.question)) === cat
      );
      if (catMarkets.length >= 2) {
        return {
          category: cat,
          meta: CAT_META[cat] ?? CAT_META.other,
          markets: catMarkets.slice(0, 4),
        };
      }
    }
    return null;
  }, [allMarkets]);

  return (
    <div className="min-h-screen bg-[#12141a] text-white">
      <SiteHeader />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 pt-8 pb-20 space-y-10">
        {/* Page header */}
        <div>
          <h1 className="font-heading text-2xl sm:text-3xl font-bold tracking-tight">Feed</h1>
          <p className="text-sm font-body text-white/40 mt-1">
            Markets picked for you &mdash; on-chain Starknet + Polymarket
          </p>
        </div>

        {loading && allMarkets.length === 0 ? (
          <div className="flex items-center justify-center py-32">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-neo-brand/30 border-t-neo-brand rounded-full animate-spin" />
              <span className="text-sm font-body text-white/40">Loading feed...</span>
            </div>
          </div>
        ) : (
          <>
            {/* Breaking */}
            <FeedSection
              icon={"\u26A1"}
              title="Breaking"
              subtitle="Biggest price moves 24h"
              markets={breaking}
              viewAllHref="/markets"
            />

            {/* Hot on-chain */}
            <FeedSection
              icon={"\u{1F525}"}
              title="Hot"
              subtitle="High trading volume"
              markets={hot}
              showRank
              viewAllHref="/markets"
            />

            {/* Starknet Spotlight */}
            {starknetSpotlight.length > 0 && (
              <section className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{"\u{1F680}"}</span>
                    <h2 className="font-heading font-bold text-lg text-white">Starknet Spotlight</h2>
                    <span className="text-[10px] font-body font-medium px-2 py-0.5 rounded-full bg-neo-brand/15 text-neo-brand border border-neo-brand/20">
                      ON-CHAIN
                    </span>
                    <span className="text-xs font-body text-white/30 hidden sm:inline">(Native STRK markets)</span>
                  </div>
                  <Link
                    href="/markets"
                    className="text-xs font-body text-neo-brand/70 hover:text-neo-brand flex items-center gap-1 transition-colors"
                  >
                    View all <span aria-hidden>&rarr;</span>
                  </Link>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {starknetSpotlight.map((m, i) => (
                    <FeedCard key={m.id} market={m} rank={i + 1} />
                  ))}
                </div>
              </section>
            )}

            {/* Ending Soon */}
            <FeedSection
              icon={"\u23F3"}
              title="Ending Soon"
              subtitle="Resolving within 7 days"
              markets={endingSoon}
              viewAllHref="/markets"
            />

            {/* Category Spotlight */}
            {categorySpotlight && (
              <FeedSection
                icon={categorySpotlight.meta.icon}
                title={categorySpotlight.meta.label}
                subtitle={`${categorySpotlight.markets.length} open markets`}
                markets={categorySpotlight.markets}
                viewAllHref="/markets"
              />
            )}

            {/* New */}
            <FeedSection
              icon={"\u{1F195}"}
              title="New"
              subtitle="Recently created"
              markets={newest}
              viewAllHref="/markets"
            />

            {/* Recently Resolved */}
            <FeedSection
              icon={"\u2705"}
              title="Recently Resolved"
              subtitle="Past 7 days"
              markets={recentlyResolved}
            />

            {/* Empty state */}
            {onChainMarkets.length === 0 && !loading && (
              <div className="text-center py-20 space-y-4">
                <div className="text-4xl">{"\u{1F30D}"}</div>
                <h3 className="font-heading text-lg text-white/60">No on-chain markets yet</h3>
                <p className="text-sm font-body text-white/30 max-w-md mx-auto">
                  On-chain Starknet prediction markets will appear here once deployed.
                  Check the Markets page for Polymarket mirrors.
                </p>
                <Link
                  href="/markets"
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-body bg-neo-brand/20 border border-neo-brand/30 text-neo-brand rounded-lg hover:bg-neo-brand/30 transition-colors"
                >
                  Browse All Markets
                </Link>
              </div>
            )}
          </>
        )}
      </main>

      <Footer />
    </div>
  );
}
