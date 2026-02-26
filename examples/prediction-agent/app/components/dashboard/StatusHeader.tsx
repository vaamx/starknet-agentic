"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import WalletConnect from "../WalletConnect";
import TamagotchiBadge from "./TamagotchiBadge";
import UserStatsBar from "../UserStatsBar";
import { formatVolume, timeAgo } from "./utils";
import type { Market } from "./types";

interface StatusHeaderProps {
  markets: Market[];
  filteredCount: number;
  activeAgents: number;
  customAgentCount: number;
  autonomousMode: boolean;
  loopToggling: boolean;
  nextTickIn: number | null;
  lastUpdatedAt: number | null;
  marketDataSource: "onchain" | "cache" | "unknown";
  marketDataStale: boolean;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onToggleAutonomousMode: () => void;
  onOpenSpawner: () => void;
  onOpenCreator: () => void;
}

export default function StatusHeader({
  markets,
  filteredCount,
  activeAgents,
  customAgentCount,
  autonomousMode,
  loopToggling,
  nextTickIn,
  lastUpdatedAt,
  marketDataSource,
  marketDataStale,
  searchQuery,
  onSearchChange,
  onToggleAutonomousMode,
  onOpenSpawner,
  onOpenCreator,
}: StatusHeaderProps) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [showStats, setShowStats] = useState(true);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  const configuredLogoVariant =
    process.env.NEXT_PUBLIC_SWARM_LOGO_VARIANT?.toLowerCase() ?? "tamagotchi";
  const useTamagotchiLogo =
    configuredLogoVariant === "tamagotchi" || configuredLogoVariant === "auto";

  const sourceLabel =
    marketDataSource === "onchain"
      ? "ON-CHAIN"
      : marketDataSource === "cache"
        ? "CACHE"
        : "UNKNOWN";

  return (
    <>
      <header className="border-b border-white/[0.07] bg-[#0d111c]/90 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6">
          {/* Main header row */}
          <div className="flex items-center h-14 gap-3">
            {/* Logo + brand */}
            <div className="flex items-center gap-2.5 shrink-0">
              <div className="w-8 h-8 bg-neo-brand/15 border border-neo-brand/30 flex items-center justify-center rounded-lg">
                {useTamagotchiLogo ? (
                  <TamagotchiBadge
                    autonomousMode={autonomousMode}
                    marketDataSource={marketDataSource}
                    marketDataStale={marketDataStale}
                    activeAgents={activeAgents}
                    nextTickIn={nextTickIn}
                  />
                ) : (
                  <span className="text-neo-brand text-sm font-bold">HC</span>
                )}
              </div>
            </div>

            {/* Search bar — centered (desktop) */}
            <div className="hidden sm:flex flex-1 max-w-md mx-auto">
              <div className="relative w-full">
                <svg
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                </svg>
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => onSearchChange(e.target.value)}
                  placeholder="Search markets..."
                  className="w-full bg-white/[0.05] border border-white/[0.07] rounded-lg pl-9 pr-3 py-2 text-sm text-white/90 placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-neo-brand/40 focus:border-neo-brand/30 transition-colors"
                  aria-label="Search markets"
                />
              </div>
            </div>

            {/* Mobile search icon */}
            <div className="flex-1 sm:hidden" />
            <button
              type="button"
              onClick={() => setMobileSearchOpen(!mobileSearchOpen)}
              className="sm:hidden w-8 h-8 flex items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-white/60 hover:bg-white/[0.08] transition-colors"
              aria-label="Search"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
            </button>

            {/* Right controls */}
            <div className="flex items-center gap-2 shrink-0">
              {/* Autonomous mode pill */}
              <button
                type="button"
                onClick={onToggleAutonomousMode}
                disabled={loopToggling}
                aria-pressed={autonomousMode}
                className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${
                  autonomousMode
                    ? "border-neo-green/40 bg-neo-green/10 text-neo-green"
                    : "border-white/15 text-white/50 hover:border-white/30"
                } ${loopToggling ? "opacity-50" : ""}`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    autonomousMode ? "bg-neo-green animate-pulse" : "bg-white/30"
                  }`}
                />
                {autonomousMode ? "Auto" : "Manual"}
              </button>

              {autonomousMode && nextTickIn !== null && (
                <span className="text-xs font-mono text-white/40 hidden lg:block">
                  {nextTickIn}s
                </span>
              )}

              <WalletConnect />

              {/* Overflow menu */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMenuOpen(!menuOpen)}
                  className="w-8 h-8 flex items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-white/60 hover:bg-white/[0.08] transition-colors"
                  aria-label="More actions"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                  </svg>
                </button>

                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                    <div className="absolute right-0 top-full mt-1 w-48 bg-neo-surface border border-white/10 rounded-xl shadow-neo-lg z-50 overflow-hidden animate-modal-in">
                      <button
                        type="button"
                        onClick={() => { onOpenCreator(); setMenuOpen(false); }}
                        className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-white/80 hover:bg-white/[0.06] transition-colors"
                      >
                        <span className="text-neo-brand">+</span> New Market
                      </button>
                      <button
                        type="button"
                        onClick={() => { onOpenSpawner(); setMenuOpen(false); }}
                        className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-white/80 hover:bg-white/[0.06] transition-colors"
                      >
                        <span className="text-neo-purple">+</span> Spawn Agent
                      </button>
                      <div className="border-t border-white/[0.07]" />
                      <div className="px-4 py-2.5 flex items-center justify-between">
                        <span className="text-xs text-white/40">Network</span>
                        <span className="flex items-center gap-1.5 text-xs font-mono text-white/60">
                          <span className="relative w-1.5 h-1.5 rounded-full bg-neo-green pulse-ring" />
                          Sepolia
                        </span>
                      </div>
                      <div className="px-4 py-2.5 flex items-center justify-between">
                        <span className="text-xs text-white/40">Feed</span>
                        <span
                          className={`text-xs font-mono ${
                            marketDataStale ? "text-neo-yellow" : "text-white/60"
                          }`}
                        >
                          {sourceLabel}
                        </span>
                      </div>
                      {/* Mobile autonomous toggle */}
                      <div className="sm:hidden border-t border-white/[0.07]">
                        <button
                          type="button"
                          onClick={() => { onToggleAutonomousMode(); setMenuOpen(false); }}
                          className="w-full flex items-center justify-between px-4 py-2.5"
                        >
                          <span className="text-xs text-white/80">Autonomous</span>
                          <span
                            className={`text-xs font-mono ${
                              autonomousMode ? "text-neo-green" : "text-white/40"
                            }`}
                          >
                            {autonomousMode ? "ON" : "OFF"}
                          </span>
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Mobile search expansion */}
          {mobileSearchOpen && (
            <div className="sm:hidden pb-2 -mt-0.5">
              <div className="relative">
                <svg
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                </svg>
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => onSearchChange(e.target.value)}
                  placeholder="Search markets..."
                  autoFocus
                  className="w-full bg-white/[0.05] border border-white/[0.07] rounded-lg pl-9 pr-3 py-2 text-sm text-white/90 placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-neo-brand/40 focus:border-neo-brand/30 transition-colors"
                  aria-label="Search markets"
                />
              </div>
            </div>
          )}

          {/* Route tabs under search */}
          <div className="pb-2 -mt-0.5 flex items-center justify-center">
            <div className="inline-flex items-center rounded-xl border border-white/[0.08] bg-white/[0.03] p-1">
              {[
                { href: "/", label: "Markets" },
                { href: "/fleet", label: "Fleet" },
              ].map((item) => {
                const isActive =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname.startsWith(item.href);
                return (
                  <a
                    key={item.href}
                    href={item.href}
                    className={`rounded-lg px-4 py-1.5 font-heading text-xs font-semibold tracking-wide no-underline transition-colors ${
                      isActive
                        ? "bg-neo-brand/20 text-neo-brand"
                        : "text-white/60 hover:text-white hover:bg-white/[0.06]"
                    }`}
                  >
                    {item.label}
                  </a>
                );
              })}
            </div>
          </div>

          {/* Collapsible stats row */}
          {showStats && (
            <>
              {/* Mobile: condensed stats strip */}
              <div className="flex sm:hidden items-center justify-center gap-3 pb-1.5 -mt-0.5 text-[10px] text-white/40">
                <span>
                  <span className="text-white/60 font-medium">{markets.length}</span> Mkts
                </span>
                <span className="text-white/[0.15]">|</span>
                <span>
                  <span className="text-white/60 font-medium">{formatVolume(markets)}</span>
                </span>
                <span className="text-white/[0.15]">|</span>
                <span>
                  <span className="text-white/60 font-medium">{activeAgents}</span> Agents
                </span>
              </div>

              {/* Desktop: full stats row */}
              <div className="hidden sm:flex items-center justify-between pb-2 -mt-0.5">
                <div className="flex items-center gap-4 text-xs text-white/40">
                  <span>
                    <span className="text-white/60 font-medium">{markets.length}</span> Markets
                  </span>
                  <span>
                    <span className="text-white/60 font-medium">{formatVolume(markets)}</span> Volume
                  </span>
                  <span>
                    <span className="text-white/60 font-medium">{activeAgents}</span> Agents
                  </span>
                  {autonomousMode && nextTickIn !== null && (
                    <span className="hidden lg:inline">
                      Next tick <span className="font-mono text-white/50">{nextTickIn}s</span>
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <UserStatsBar />
                  {lastUpdatedAt && (
                    <span className="text-xs font-mono text-white/25">
                      {timeAgo(lastUpdatedAt)}
                    </span>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </header>
    </>
  );
}
