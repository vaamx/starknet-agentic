"use client";

import { useCallback, useEffect, useState } from "react";
import type { MarketCategory } from "@/lib/categories";
import type { CategoryTab } from "./dashboard/types";

/* ═══════════════════════════════════════════════════════════
   TAB DEFINITIONS — Polymarket-style topic bar
   ═══════════════════════════════════════════════════════════ */

/** Special sort-mode tabs shown before the separator */
const SPECIAL_TABS: { id: string; label: string; category: MarketCategory }[] = [
  { id: "trending", label: "Trending", category: "all" },
  { id: "breaking", label: "Breaking", category: "all" },
  { id: "new",      label: "New",      category: "all" },
];

/** Topic tabs — each maps to an underlying MarketCategory for filtering */
const TOPIC_TABS: { id: string; label: string; category: MarketCategory }[] = [
  { id: "politics",    label: "Politics",          category: "politics" },
  { id: "sports",      label: "Sports",            category: "sports" },
  { id: "crypto",      label: "Crypto",            category: "crypto" },
  { id: "finance",     label: "Finance",           category: "crypto" },
  { id: "geopolitics", label: "Geopolitics",       category: "politics" },
  { id: "earnings",    label: "Earnings",          category: "crypto" },
  { id: "tech",        label: "Tech",              category: "tech" },
  { id: "culture",     label: "Culture",           category: "other" },
  { id: "world",       label: "World",             category: "other" },
  { id: "economy",     label: "Economy",           category: "politics" },
  { id: "climate",     label: "Climate & Science", category: "other" },
  { id: "elections",   label: "Elections",          category: "politics" },
];

/* ═══════════════════════════════════════════════════════════
   COMPONENT
   ═══════════════════════════════════════════════════════════ */

interface CategoryNavProps {
  tabs: CategoryTab[];
  activeCategory: MarketCategory;
  onSetCategory: (category: MarketCategory) => void;
}

export default function CategoryNav({
  tabs,
  activeCategory,
  onSetCategory,
}: CategoryNavProps) {
  // Track which specific topic tab is highlighted (since multiple map to same category)
  const [activeTab, setActiveTab] = useState("trending");

  // Sync activeTab when category changes externally
  useEffect(() => {
    const matchingTopic = TOPIC_TABS.find(t => t.id === activeTab && t.category === activeCategory);
    const matchingSpecial = SPECIAL_TABS.find(t => t.id === activeTab && t.category === activeCategory);
    if (!matchingTopic && !matchingSpecial) {
      const firstMatch = TOPIC_TABS.find(t => t.category === activeCategory)
        ?? SPECIAL_TABS.find(t => t.category === activeCategory);
      if (firstMatch) setActiveTab(firstMatch.id);
    }
  }, [activeCategory, activeTab]);

  const handleTabClick = useCallback((id: string, category: MarketCategory) => {
    setActiveTab(id);
    onSetCategory(category);
  }, [onSetCategory]);

  return (
    <div className="border-b border-white/[0.04] bg-[#12141a]/80 backdrop-blur-xl sticky top-14 z-40">
      <div className="flex justify-center overflow-x-auto hide-scrollbar">
        <div className="flex items-center h-11" role="tablist" aria-label="Market categories">

          {/* ── Special tabs: Trending / Breaking / New ── */}
          {SPECIAL_TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => handleTabClick(tab.id, tab.category)}
                className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-heading font-medium transition-all duration-150 ${
                  isActive
                    ? "text-white font-semibold"
                    : "text-white/35 hover:text-white/60"
                }`}
              >
                {tab.id === "trending" && (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.306a11.95 11.95 0 015.814-5.518l2.74-1.22m0 0l-5.94-2.281m5.94 2.28l-2.28 5.941" />
                  </svg>
                )}
                {tab.label}
              </button>
            );
          })}

          {/* ── Separator ── */}
          <div className="w-px h-4 bg-white/[0.08] mx-2 shrink-0" />

          {/* ── Topic tabs ── */}
          {TOPIC_TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => handleTabClick(tab.id, tab.category)}
                className={`shrink-0 px-3 py-1.5 text-[13px] font-heading font-medium transition-all duration-150 whitespace-nowrap ${
                  isActive
                    ? "text-white font-semibold"
                    : "text-white/35 hover:text-white/60"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
