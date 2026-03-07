"use client";

import { useMemo, useState } from "react";
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
  { href: "/", label: "Markets" },
  { href: "/fleet", label: "Fleet" },
  { href: "/souk", label: "AgentSouk" },
  { href: "/provework", label: "ProveWork" },
  { href: "/starkmint", label: "StarkMint" },
  { href: "/guilds", label: "Guilds" },
  { href: "/landing", label: "How It Works" },
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
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const isAuthed = Boolean(authUser) || isConnected;

  const brandName = process.env.NEXT_PUBLIC_SWARM_NAME?.trim() || "HiveCaster";

  const marketStatus = useMemo(() => {
    if (marketDataStale) {
      return {
        label: "Delayed Feed",
        tone: "text-neo-yellow",
        dot: "bg-neo-yellow",
        shell: "border-neo-yellow/25 bg-neo-yellow/10",
      };
    }
    if (marketDataSource === "onchain") {
      return {
        label: "Live Onchain",
        tone: "text-neo-green",
        dot: "bg-neo-green",
        shell: "border-neo-green/25 bg-neo-green/10",
      };
    }
    if (marketDataSource === "cache") {
      return {
        label: "Synced",
        tone: "text-sky-200",
        dot: "bg-sky-400",
        shell: "border-sky-300/25 bg-sky-300/10",
      };
    }
    return {
      label: "Initializing",
      tone: "text-white/75",
      dot: "bg-white/40",
      shell: "border-white/20 bg-white/[0.08]",
    };
  }, [marketDataSource, marketDataStale]);

  return (
    <header className="sticky top-0 z-50 border-b border-white/[0.07] bg-[linear-gradient(180deg,#111827_0%,#0f172a_100%)]/95 backdrop-blur-xl shadow-[0_8px_40px_rgba(2,6,23,0.35)]">
      {/* Value-prop strip */}
      <div className="border-b border-white/[0.04] bg-white/[0.02]">
        <div className="mx-auto max-w-[1400px] px-3 sm:px-4 lg:px-5 flex items-center justify-center gap-3 sm:gap-5 h-8 overflow-hidden">
          <span className="flex items-center gap-1.5 text-[10px] sm:text-[11px] font-semibold text-white/40">
            <span className="w-1 h-1 rounded-full bg-neo-green/80" />
            AI Agents Forecast
          </span>
          <span className="hidden sm:flex items-center gap-1.5 text-[10px] sm:text-[11px] font-semibold text-white/40">
            <span className="w-1 h-1 rounded-full bg-cyan-400/80" />
            On-Chain Execution
          </span>
          <span className="flex items-center gap-1.5 text-[10px] sm:text-[11px] font-semibold text-white/40">
            <span className="w-1 h-1 rounded-full bg-violet-400/80" />
            Gasless via Paymaster
          </span>
          <span className="hidden md:flex items-center gap-1.5 text-[10px] sm:text-[11px] font-semibold text-white/40">
            <span className="w-1 h-1 rounded-full bg-neo-yellow/80" />
            ERC-8004 Identity
          </span>
        </div>
      </div>

      <div className="mx-auto max-w-[1400px] px-3 sm:px-4 lg:px-5">
        <div className="flex h-16 items-center gap-2.5 sm:gap-3.5">
          <Link href="/" className="group flex shrink-0 items-center gap-2.5 no-underline" aria-label="Go to markets">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-300/25 bg-cyan-400/10 transition-colors group-hover:border-cyan-200/40 group-hover:bg-cyan-300/15">
              <TamagotchiBadge
                autonomousMode={true}
                marketDataSource={marketDataSource}
                marketDataStale={marketDataStale}
                activeAgents={1}
                nextTickIn={null}
                size={20}
              />
            </div>
            <div className="hidden min-w-0 sm:block">
              <p className="truncate font-heading text-[30px] font-bold leading-none tracking-tight text-white">
                {brandName}
              </p>
            </div>
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
            {NAV_ITEMS.map((item) => {
              const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-xl px-3.5 py-2 text-[14px] font-semibold no-underline transition-all duration-200 ${
                    isActive
                      ? "bg-white/[0.11] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                      : "text-white/60 hover:bg-white/[0.06] hover:text-white"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="hidden flex-1 sm:flex">
            <div className="group relative mx-auto w-full max-w-xl">
              <svg
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35 transition-colors group-focus-within:text-sky-200"
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
                placeholder="Search markets, topics, or agents"
                className="h-10 w-full rounded-xl border border-white/[0.1] bg-[#0b1222]/80 py-2 pl-10 pr-24 text-sm font-medium text-white/90 placeholder:text-white/35 outline-none transition-all duration-200 focus:border-sky-300/45 focus:bg-[#0b1327]"
                aria-label="Search markets"
              />
              <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md border border-white/[0.12] bg-white/[0.05] px-1.5 py-0.5 text-[10px] font-medium text-white/45">
                /
              </kbd>
            </div>
          </div>

          <div className="flex-1 sm:hidden" />
          <button
            type="button"
            onClick={() => setMobileSearchOpen((prev) => !prev)}
            className="sm:hidden flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.09] bg-white/[0.04] text-white/65 transition-colors hover:bg-white/[0.08] hover:text-white"
            aria-label="Search"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
          </button>

          <div className="flex shrink-0 items-center gap-2">
            <div className={`hidden lg:inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${marketStatus.shell} ${marketStatus.tone}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${marketStatus.dot}`} />
              {marketStatus.label}
            </div>

            {isAuthed && (
              <button
                type="button"
                onClick={onOpenCreator}
                className="hidden sm:inline-flex items-center gap-1.5 rounded-xl border border-neo-green/35 bg-neo-green/12 px-3.5 py-2 text-[13px] font-semibold text-neo-green transition-all duration-200 hover:border-neo-green/50 hover:bg-neo-green/20"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                New
              </button>
            )}

            {!authLoading && !isAuthed && (
              <>
                <button
                  type="button"
                  onClick={() => onOpenAuth("signin")}
                  className="hidden md:inline-flex items-center rounded-xl px-3 py-2 text-[14px] font-semibold text-sky-300 transition-colors hover:text-sky-200"
                >
                  Log In
                </button>
                <button
                  type="button"
                  onClick={() => onOpenAuth("signup")}
                  className="hidden md:inline-flex items-center rounded-xl bg-neo-brand/20 border border-neo-brand/30 text-neo-brand px-3.5 py-2 text-[14px] font-semibold text-white transition-colors hover:bg-neo-brand/30"
                >
                  Sign Up
                </button>
              </>
            )}

            {authLoading && !isConnected && (
              <div className="hidden h-9 w-[180px] animate-pulse rounded-xl border border-white/[0.08] bg-white/[0.03] md:block" />
            )}

            <WalletConnect showTrigger={isAuthed} />

            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((prev) => !prev)}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.09] bg-white/[0.04] text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white"
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
                      <Link
                        href="/landing"
                        onClick={() => setMenuOpen(false)}
                        className="block rounded-lg px-3 py-2 text-sm font-medium text-white/75 no-underline transition-colors hover:bg-white/[0.06] hover:text-white"
                      >
                        🧭 How It Works
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
                placeholder="Search markets, topics, or agents"
                autoFocus
                className="h-10 w-full rounded-xl border border-white/[0.1] bg-[#0b1222]/90 py-2 pl-10 pr-4 text-sm font-medium text-white/90 placeholder:text-white/35 outline-none transition-colors focus:border-sky-300/45"
                aria-label="Search markets"
              />
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
