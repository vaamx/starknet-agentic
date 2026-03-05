"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import WalletConnect from "./WalletConnect";
import TamagotchiBadge from "./dashboard/TamagotchiBadge";

interface SimpleHeaderProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onOpenCreator: () => void;
  marketDataSource?: "onchain" | "cache" | "unknown";
  marketDataStale?: boolean;
}

const NAV_ITEMS = [
  { href: "/", label: "Markets", icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" },
  { href: "/fleet", label: "Fleet", icon: "M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" },
];

export default function SimpleHeader({
  searchQuery,
  onSearchChange,
  onOpenCreator,
  marketDataSource = "unknown",
  marketDataStale = false,
}: SimpleHeaderProps) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  const brandName = process.env.NEXT_PUBLIC_SWARM_NAME?.trim() || "HiveCaster";

  return (
    <header className="border-b border-white/[0.06] bg-[#12141a]/90 backdrop-blur-xl sticky top-0 z-50">
      <div className="px-3 sm:px-4 lg:px-5">
        <div className="flex items-center h-14 gap-3">
          {/* Brand */}
          <Link
            href="/"
            className="flex items-center gap-2.5 shrink-0 no-underline group"
          >
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-neo-brand/20 to-neo-brand/5 border border-neo-brand/20 flex items-center justify-center group-hover:border-neo-brand/40 transition-colors">
              <TamagotchiBadge
                autonomousMode={true}
                marketDataSource={marketDataSource}
                marketDataStale={marketDataStale}
                activeAgents={1}
                nextTickIn={null}
                size={20}
              />
            </div>
            <span className="font-heading text-[17px] font-bold tracking-tight text-white">
              {brandName}
            </span>
          </Link>

          {/* Nav — desktop */}
          <nav className="hidden md:flex items-center gap-0.5 ml-2">
            {NAV_ITEMS.map((item) => {
              const isActive =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-medium no-underline transition-colors ${
                    isActive
                      ? "bg-white/[0.08] text-white"
                      : "text-white/45 hover:text-white/75 hover:bg-white/[0.04]"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* Search — desktop */}
          <div className="hidden sm:flex flex-1 max-w-md mx-auto">
            <div className="relative w-full group">
              <svg
                className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/25 group-focus-within:text-white/40 transition-colors"
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
                className="w-full bg-white/[0.04] border border-white/[0.06] rounded-xl pl-10 pr-4 py-2 text-sm text-white/90 placeholder:text-white/25 focus:outline-none focus:ring-1 focus:ring-neo-brand/30 focus:border-neo-brand/20 focus:bg-white/[0.06] transition-all"
                aria-label="Search markets"
              />
              <kbd className="hidden lg:inline-flex absolute right-3 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded text-[10px] font-mono text-white/20 border border-white/[0.06] bg-white/[0.03]">
                /
              </kbd>
            </div>
          </div>

          {/* Spacer + mobile search */}
          <div className="flex-1 sm:hidden" />
          <button
            type="button"
            onClick={() => setMobileSearchOpen(!mobileSearchOpen)}
            className="sm:hidden w-9 h-9 flex items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.03] text-white/50 hover:bg-white/[0.06] hover:text-white/70 transition-colors"
            aria-label="Search"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
          </button>

          {/* Right controls */}
          <div className="flex items-center gap-2 shrink-0">
            {/* New Market — desktop */}
            <button
              type="button"
              onClick={onOpenCreator}
              className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[13px] font-semibold font-heading text-neo-brand bg-neo-brand/[0.08] border border-neo-brand/[0.15] hover:bg-neo-brand/[0.15] hover:border-neo-brand/[0.25] transition-all"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              New
            </button>

            <WalletConnect />

            {/* Overflow */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen(!menuOpen)}
                className="w-9 h-9 flex items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.03] text-white/50 hover:bg-white/[0.06] hover:text-white/70 transition-colors"
                aria-label="More actions"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                </svg>
              </button>

              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 top-full mt-2 w-52 bg-[#1f2230] border border-white/[0.08] rounded-xl shadow-neo-lg z-50 overflow-hidden animate-modal-in">
                    {/* Mobile-only: New Market */}
                    <button
                      type="button"
                      onClick={() => { onOpenCreator(); setMenuOpen(false); }}
                      className="sm:hidden w-full flex items-center gap-2.5 px-4 py-3 text-sm text-white/80 hover:bg-white/[0.04] transition-colors"
                    >
                      <svg className="w-4 h-4 text-neo-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                      </svg>
                      New Market
                    </button>
                    {/* Mobile nav */}
                    <div className="md:hidden border-t border-white/[0.06]">
                      {NAV_ITEMS.map((item) => (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={() => setMenuOpen(false)}
                          className="w-full flex items-center gap-2.5 px-4 py-3 text-sm text-white/70 hover:bg-white/[0.04] transition-colors no-underline"
                        >
                          {item.label}
                        </Link>
                      ))}
                    </div>
                    <div className="border-t border-white/[0.06]" />
                    <div className="px-4 py-3 flex items-center justify-between">
                      <span className="text-xs text-white/30 font-medium">Network</span>
                      <span className="flex items-center gap-1.5 text-xs font-mono text-white/50">
                        <span className="relative w-1.5 h-1.5 rounded-full bg-emerald-400 pulse-ring" />
                        Sepolia
                      </span>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Mobile search expansion */}
        {mobileSearchOpen && (
          <div className="sm:hidden pb-2.5">
            <div className="relative">
              <svg
                className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/25"
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
                className="w-full bg-white/[0.04] border border-white/[0.06] rounded-xl pl-10 pr-4 py-2.5 text-sm text-white/90 placeholder:text-white/25 focus:outline-none focus:ring-1 focus:ring-neo-brand/30 transition-all"
                aria-label="Search markets"
              />
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
