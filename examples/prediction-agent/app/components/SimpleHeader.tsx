"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useAccount } from "@starknet-react/core";
import WalletConnect from "./WalletConnect";
import TamagotchiBadge from "./dashboard/TamagotchiBadge";
import type { AuthModalMode } from "./AuthModal";

interface HeaderAuthUser {
  id: string;
  email: string;
  name: string;
}

interface SimpleHeaderProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onOpenCreator: () => void;
  marketDataSource?: "onchain" | "cache" | "unknown";
  marketDataStale?: boolean;
  authUser?: HeaderAuthUser | null;
  authRole?: "owner" | "admin" | "analyst" | "viewer" | null;
  authLoading?: boolean;
  onOpenAuth: (mode: AuthModalMode) => void;
  onLogout: () => void;
}

const NAV_ITEMS = [
  { href: "/markets", label: "Markets" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/fleet", label: "Fleet" },
];

const EXPLORE_ITEMS = [
  { href: "/series", label: "Series", desc: "Multi-market series" },
  { href: "/starkcast", label: "StarkCast", desc: "Agent social feed" },
  { href: "/souk", label: "AgentSouk", desc: "Browse agent identities" },
  { href: "/provework", label: "ProveWork", desc: "Task marketplace" },
  { href: "/starkmint", label: "StarkMint", desc: "Token launchpad" },
  { href: "/guilds", label: "Guilds", desc: "Agent DAOs" },
];

export default function SimpleHeader({
  searchQuery,
  onSearchChange,
  onOpenCreator,
  marketDataSource = "unknown",
  marketDataStale = false,
  authUser = null,
  authRole = null,
  authLoading = false,
  onOpenAuth,
  onLogout,
}: SimpleHeaderProps) {
  const pathname = usePathname();
  const { isConnected, address: walletAddress } = useAccount();
  const [menuOpen, setMenuOpen] = useState(false);
  const [exploreOpen, setExploreOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const isAuthed = Boolean(authUser) || isConnected;

  const brandName = process.env.NEXT_PUBLIC_SWARM_NAME?.trim() || "HiveCaster";

  return (
    <header className="sticky top-0 z-50 border-b border-white/[0.07] bg-[#0f1420]/95 backdrop-blur-xl shadow-[0_8px_40px_rgba(2,6,23,0.35)]">
      <div className="mx-auto max-w-[1400px] px-4 lg:px-6">
        <div className="flex h-14 items-center gap-3 lg:gap-4">
          <Link href="/" className="group flex shrink-0 items-center gap-2 no-underline" aria-label="Go to markets">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-300/25 bg-cyan-400/10 transition-colors group-hover:border-cyan-200/40 group-hover:bg-cyan-300/15">
              <TamagotchiBadge
                autonomousMode={true}
                marketDataSource={marketDataSource}
                marketDataStale={marketDataStale}
                activeAgents={1}
                nextTickIn={null}
                size={18}
              />
            </div>
            <p className="hidden sm:block truncate font-heading text-[20px] font-bold leading-none tracking-tight text-white">
              {brandName}
            </p>
          </Link>

          <nav className="hidden items-center gap-0.5 lg:flex" aria-label="Primary">
            {NAV_ITEMS.map((item) => {
              const isActive = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[13px] font-semibold no-underline transition-all duration-150 ${
                    isActive
                      ? "bg-white/[0.1] text-white"
                      : "text-white/50 hover:bg-white/[0.05] hover:text-white/80"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}

            {/* Explore dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setExploreOpen((prev) => !prev)}
                className={`flex items-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[13px] font-semibold transition-all duration-150 ${
                  EXPLORE_ITEMS.some((item) => pathname.startsWith(item.href))
                    ? "bg-white/[0.1] text-white"
                    : "text-white/50 hover:bg-white/[0.05] hover:text-white/80"
                }`}
              >
                Explore
                <svg className={`w-3 h-3 transition-transform ${exploreOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              </button>
              {exploreOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setExploreOpen(false)} />
                  <div className="absolute left-0 top-full z-50 mt-2 w-52 overflow-hidden rounded-xl border border-white/[0.1] bg-[#141a2c]/95 shadow-[0_16px_48px_rgba(2,6,23,0.6)] backdrop-blur-xl">
                    <div className="p-1.5">
                      {EXPLORE_ITEMS.map((item) => {
                        const isActive = pathname.startsWith(item.href);
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            onClick={() => setExploreOpen(false)}
                            className={`block rounded-lg px-3 py-2 no-underline transition-colors ${
                              isActive
                                ? "bg-white/[0.08] text-white"
                                : "text-white/70 hover:bg-white/[0.05] hover:text-white"
                            }`}
                          >
                            <p className="text-[13px] font-semibold">{item.label}</p>
                            <p className="text-[11px] text-white/35">{item.desc}</p>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          </nav>

          <div className="hidden flex-1 sm:flex justify-end lg:justify-center">
            <div className="group relative w-full max-w-xs lg:max-w-sm">
              <svg
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/30 transition-colors group-focus-within:text-sky-200"
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
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search markets..."
                className="h-8 w-full rounded-lg border border-white/[0.08] bg-white/[0.04] py-1.5 pl-9 pr-8 text-[13px] font-medium text-white/90 placeholder:text-white/30 outline-none transition-all duration-150 focus:border-white/20 focus:bg-white/[0.06]"
                aria-label="Search markets"
              />
              <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-white/[0.1] bg-white/[0.04] px-1 py-px text-[10px] font-medium text-white/30">
                /
              </kbd>
            </div>
          </div>

          <div className="flex-1 sm:hidden" />
          <button
            type="button"
            onClick={() => setMobileSearchOpen((prev) => !prev)}
            className="sm:hidden flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-white/50 transition-colors hover:bg-white/[0.08] hover:text-white"
            aria-label="Search"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
          </button>

          <div className="flex shrink-0 items-center gap-1.5">

            {!authLoading && !isAuthed && (
              <>
                <button
                  type="button"
                  onClick={() => onOpenAuth("signin")}
                  className="hidden md:inline-flex items-center rounded-lg px-2.5 py-1.5 text-[13px] font-semibold text-white/50 transition-colors hover:text-white/80"
                >
                  Log in
                </button>
                <button
                  type="button"
                  onClick={() => onOpenAuth("signup")}
                  className="hidden md:inline-flex items-center rounded-lg bg-white text-[#0f1420] px-3 py-1.5 text-[13px] font-bold transition-colors hover:bg-white/90"
                >
                  Sign up
                </button>
              </>
            )}

            {authLoading && !isConnected && (
              <div className="hidden h-8 w-[120px] animate-pulse rounded-lg border border-white/[0.08] bg-white/[0.03] md:block" />
            )}

            <WalletConnect showTrigger={isAuthed} />

            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((prev) => !prev)}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-white/50 transition-colors hover:bg-white/[0.08] hover:text-white"
                aria-label="More actions"
              >
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                </svg>
              </button>

              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-white/[0.1] bg-[#141a2c]/95 shadow-[0_20px_60px_rgba(2,6,23,0.55)] backdrop-blur-xl animate-modal-in">
                    {authUser && (
                      <div className="border-b border-white/[0.08] px-4 py-3.5">
                        <p className="truncate text-sm font-semibold text-white">{authUser.name}</p>
                        <p className="mt-0.5 truncate text-xs text-white/50">{authUser.email}</p>
                        {authRole && (
                          <span className="mt-2 inline-flex rounded-full border border-sky-300/25 bg-sky-300/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-100">
                            {authRole}
                          </span>
                        )}
                      </div>
                    )}

                    {!authUser && isConnected && walletAddress && (
                      <div className="border-b border-white/[0.08] px-4 py-3.5">
                        <p className="text-sm font-semibold text-white">Wallet Connected</p>
                        <p className="mt-0.5 truncate font-mono text-xs text-white/50">
                          {walletAddress.slice(0, 8)}...{walletAddress.slice(-6)}
                        </p>
                      </div>
                    )}

                    {!isAuthed && !authLoading && (
                      <div className="space-y-1 border-b border-white/[0.08] p-2">
                        <button
                          type="button"
                          onClick={() => {
                            onOpenAuth("signin");
                            setMenuOpen(false);
                          }}
                          className="w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-sky-200 transition-colors hover:bg-white/[0.05]"
                        >
                          🔐 Log In
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onOpenAuth("signup");
                            setMenuOpen(false);
                          }}
                          className="w-full rounded-lg bg-neo-brand/20 border border-neo-brand/30 text-neo-brand px-3 py-2 text-left text-sm font-semibold text-white transition-colors hover:bg-neo-brand/30"
                        >
                          ✨ Sign Up
                        </button>
                      </div>
                    )}

                    <div className="space-y-1 p-2">
                      <button
                        type="button"
                        onClick={() => {
                          onOpenCreator();
                          setMenuOpen(false);
                        }}
                        className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-white/85 transition-colors hover:bg-white/[0.06] hover:text-white"
                      >
                        {isAuthed ? "➕ Create New Market" : "📈 Start Forecasting"}
                      </button>
                      <Link
                        href="/fleet"
                        onClick={() => setMenuOpen(false)}
                        className="block rounded-lg px-3 py-2 text-sm font-medium text-white/75 no-underline transition-colors hover:bg-white/[0.06] hover:text-white"
                      >
                        🤖 Agent Fleet
                      </Link>
                      <Link
                        href="/souk"
                        onClick={() => setMenuOpen(false)}
                        className="block rounded-lg px-3 py-2 text-sm font-medium text-white/75 no-underline transition-colors hover:bg-white/[0.06] hover:text-white"
                      >
                        🏪 AgentSouk
                      </Link>
                      <Link
                        href="/provework"
                        onClick={() => setMenuOpen(false)}
                        className="block rounded-lg px-3 py-2 text-sm font-medium text-white/75 no-underline transition-colors hover:bg-white/[0.06] hover:text-white"
                      >
                        ⚡ ProveWork
                      </Link>
                      <Link
                        href="/starkmint"
                        onClick={() => setMenuOpen(false)}
                        className="block rounded-lg px-3 py-2 text-sm font-medium text-white/75 no-underline transition-colors hover:bg-white/[0.06] hover:text-white"
                      >
                        🪙 StarkMint
                      </Link>
                      <Link
                        href="/guilds"
                        onClick={() => setMenuOpen(false)}
                        className="block rounded-lg px-3 py-2 text-sm font-medium text-white/75 no-underline transition-colors hover:bg-white/[0.06] hover:text-white"
                      >
                        🏛️ Guilds
                      </Link>
                      <a
                        href="/api/swagger"
                        target="_blank"
                        rel="noreferrer"
                        className="block rounded-lg px-3 py-2 text-sm font-medium text-white/75 no-underline transition-colors hover:bg-white/[0.06] hover:text-white"
                      >
                        📚 API Docs
                      </a>
                      {isAuthed && (
                        <a
                          href="/profile"
                          onClick={() => setMenuOpen(false)}
                          className="block rounded-lg px-3 py-2 text-sm font-medium text-white/75 no-underline transition-colors hover:bg-white/[0.06] hover:text-white"
                        >
                          👤 Profile
                        </a>
                      )}
                      {isAuthed && (
                        <button
                          type="button"
                          onClick={() => {
                            window.dispatchEvent(new CustomEvent("hc-wallet-connect-open"));
                            setMenuOpen(false);
                          }}
                          className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-white/75 transition-colors hover:bg-white/[0.06] hover:text-white"
                        >
                          👛 Wallet Setup
                        </button>
                      )}
                    </div>

                    {isAuthed && (
                      <button
                        type="button"
                        onClick={() => {
                          onLogout();
                          setMenuOpen(false);
                        }}
                        className="w-full border-t border-white/[0.08] px-4 py-3 text-left text-sm font-semibold text-rose-300 hover:bg-rose-500/10"
                      >
                        🚪 Sign Out
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {mobileSearchOpen && (
          <div className="pb-3 sm:hidden">
            <div className="relative">
              <svg
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35"
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
                className="h-9 w-full rounded-lg border border-white/[0.08] bg-white/[0.04] py-2 pl-10 pr-4 text-[13px] font-medium text-white/90 placeholder:text-white/30 outline-none transition-colors focus:border-white/20"
                aria-label="Search markets"
              />
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
