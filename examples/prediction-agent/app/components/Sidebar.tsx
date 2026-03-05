"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { MarketCategory } from "@/lib/categories";
import type { CategoryTab } from "./dashboard/types";
import TamagotchiBadge from "./dashboard/TamagotchiBadge";

interface SidebarProps {
  tabs: CategoryTab[];
  activeCategory: MarketCategory;
  onSetCategory: (category: MarketCategory) => void;
  marketCount: number;
  isOpen: boolean;
  onClose: () => void;
}

const CATEGORIES: Record<
  string,
  { icon: string; label: string; accent: string; activeBg: string; activeText: string }
> = {
  all: {
    icon: "\u{1F525}",
    label: "Trending",
    accent: "neo-brand",
    activeBg: "bg-gradient-to-r from-neo-brand/[0.12] to-neo-brand/[0.04]",
    activeText: "text-white",
  },
  sports: {
    icon: "\u{1F3C8}",
    label: "Sports",
    accent: "emerald",
    activeBg: "bg-emerald-500/[0.08]",
    activeText: "text-emerald-400",
  },
  crypto: {
    icon: "\u20BF",
    label: "Crypto",
    accent: "blue",
    activeBg: "bg-blue-500/[0.08]",
    activeText: "text-blue-400",
  },
  politics: {
    icon: "\u{1F3DB}\uFE0F",
    label: "Politics",
    accent: "rose",
    activeBg: "bg-rose-500/[0.08]",
    activeText: "text-rose-400",
  },
  tech: {
    icon: "\u{1F4BB}",
    label: "Tech",
    accent: "violet",
    activeBg: "bg-violet-500/[0.08]",
    activeText: "text-violet-400",
  },
  other: {
    icon: "\u{1F30D}",
    label: "World",
    accent: "amber",
    activeBg: "bg-amber-500/[0.08]",
    activeText: "text-amber-400",
  },
};

function SidebarContent({
  tabs,
  activeCategory,
  onSetCategory,
  marketCount,
  onClose,
}: Omit<SidebarProps, "isOpen">) {
  const pathname = usePathname();
  const isFleetActive = pathname.startsWith("/fleet");

  return (
    <div className="flex flex-col h-full">
      {/* Featured "For You" card */}
      <div className="mx-3 mt-4 mb-2">
        <button
          type="button"
          onClick={() => {
            onSetCategory("all");
            onClose();
          }}
          className={`w-full rounded-xl p-3.5 transition-all duration-200 text-left group ${
            activeCategory === "all"
              ? "bg-gradient-to-br from-neo-brand/20 via-neo-brand/10 to-transparent border border-neo-brand/20"
              : "bg-white/[0.03] border border-white/[0.05] hover:border-white/[0.08] hover:bg-white/[0.05]"
          }`}
        >
          <div className="flex items-center gap-2.5">
            <div
              className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                activeCategory === "all"
                  ? "bg-neo-brand/20"
                  : "bg-white/[0.06]"
              }`}
            >
              <TamagotchiBadge
                autonomousMode={true}
                marketDataSource="onchain"
                marketDataStale={false}
                activeAgents={1}
                nextTickIn={null}
                size={18}
              />
            </div>
            <div className="min-w-0">
              <span
                className={`block text-[13px] font-heading font-bold ${
                  activeCategory === "all" ? "text-white" : "text-white/70"
                }`}
              >
                For You
              </span>
              <span className="block text-[11px] text-white/30 mt-0.5">
                All markets
              </span>
            </div>
          </div>
        </button>
      </div>

      {/* Category list */}
      <nav className="flex-1 px-2 mt-1" aria-label="Market categories">
        {tabs
          .filter((t) => t.id !== "all")
          .map((tab) => {
            const isActive = activeCategory === tab.id;
            const meta = CATEGORIES[tab.id] ?? CATEGORIES.other;

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  onSetCategory(tab.id);
                  onClose();
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13.5px] transition-all duration-150 ${
                  isActive
                    ? `${meta.activeBg} ${meta.activeText} font-semibold`
                    : "text-white/50 hover:bg-white/[0.04] hover:text-white/70 font-medium"
                }`}
              >
                <span className="text-[14px] w-5 text-center shrink-0 leading-none">
                  {meta.icon}
                </span>
                <span className="flex-1 text-left font-heading">
                  {meta.label}
                </span>
                <span
                  className={`text-[12px] font-mono tabular-nums min-w-[24px] text-right ${
                    isActive ? "opacity-70" : "opacity-25"
                  }`}
                >
                  ({tab.count})
                </span>
              </button>
            );
          })}
      </nav>

      {/* Section divider */}
      <div className="mx-4 mt-2 mb-2">
        <div className="border-t border-white/[0.05]" />
      </div>

      {/* Bottom links */}
      <div className="px-2 pb-2">
        <Link
          href="/fleet"
          onClick={onClose}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13.5px] font-heading font-medium transition-all no-underline ${
            isFleetActive
              ? "bg-white/[0.06] text-white"
              : "text-white/35 hover:bg-white/[0.04] hover:text-white/60"
          }`}
        >
          <svg
            className="w-[18px] h-[18px] shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
            />
          </svg>
          <span className="flex-1 text-left">Agent Fleet</span>
        </Link>

        <Link
          href="/.well-known/agent-card.json"
          target="_blank"
          onClick={onClose}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13.5px] font-heading font-medium text-white/35 hover:bg-white/[0.04] hover:text-white/60 transition-all no-underline"
        >
          <svg
            className="w-[18px] h-[18px] shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5"
            />
          </svg>
          <span className="flex-1 text-left">Agent Card</span>
          <svg
            className="w-3 h-3 opacity-25"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25"
            />
          </svg>
        </Link>
      </div>

      {/* Network status */}
      <div className="mx-3 mb-4 mt-1">
        <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04]">
          <span className="text-[11px] text-white/20 font-heading font-medium tracking-wide">
            Network
          </span>
          <span className="flex items-center gap-1.5 text-[11px] font-mono text-white/40">
            <span className="w-[5px] h-[5px] rounded-full bg-emerald-400 relative pulse-ring" />
            Sepolia
          </span>
        </div>
      </div>
    </div>
  );
}

export default function Sidebar({
  tabs,
  activeCategory,
  onSetCategory,
  marketCount,
  isOpen,
  onClose,
}: SidebarProps) {
  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex lg:flex-col w-[220px] shrink-0 sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto hide-scrollbar border-r border-white/[0.04] bg-[#12141a]/60">
        <SidebarContent
          tabs={tabs}
          activeCategory={activeCategory}
          onSetCategory={onSetCategory}
          marketCount={marketCount}
          onClose={onClose}
        />
      </aside>

      {/* Mobile sidebar — overlay */}
      {isOpen && (
        <>
          <div
            className="lg:hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />
          <aside className="lg:hidden fixed left-0 top-0 bottom-0 z-50 w-[280px] bg-[#14161c] border-r border-white/[0.06] overflow-y-auto animate-sheet-left shadow-neo-xl">
            {/* Mobile header */}
            <div className="flex items-center justify-between px-4 h-16 border-b border-white/[0.05]">
              <span className="font-heading text-[15px] font-bold text-white">
                Browse
              </span>
              <button
                type="button"
                onClick={onClose}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-white/40 hover:text-white/70 hover:bg-white/[0.06] transition-colors"
                aria-label="Close sidebar"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <SidebarContent
              tabs={tabs}
              activeCategory={activeCategory}
              onSetCategory={onSetCategory}
              marketCount={marketCount}
              onClose={onClose}
            />
          </aside>
        </>
      )}
    </>
  );
}
