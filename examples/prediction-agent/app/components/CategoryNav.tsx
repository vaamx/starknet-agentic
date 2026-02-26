"use client";

import type { MarketCategory } from "@/lib/categories";
import type { CategoryTab, SortMode } from "./dashboard/types";

interface CategoryNavProps {
  tabs: CategoryTab[];
  activeCategory: MarketCategory;
  sortBy: SortMode;
  onSetCategory: (category: MarketCategory) => void;
  onSortChange: (mode: SortMode) => void;
}

const CATEGORY_COLORS: Partial<Record<MarketCategory, string>> = {
  sports: "border-neo-green/50 bg-neo-green/10 text-neo-green",
  crypto: "border-neo-blue/50 bg-neo-blue/10 text-neo-blue",
  politics: "border-neo-pink/50 bg-neo-pink/10 text-neo-pink",
  tech: "border-neo-purple/50 bg-neo-purple/10 text-neo-purple",
  other: "border-neo-yellow/50 bg-neo-yellow/10 text-neo-yellow",
};

export default function CategoryNav({
  tabs,
  activeCategory,
  sortBy,
  onSetCategory,
  onSortChange,
}: CategoryNavProps) {
  return (
    <div className="flex items-center gap-2 border-b border-white/[0.07] bg-neo-surface/50 backdrop-blur-md px-4 sm:px-6 py-2">
      <div
        className="flex items-center gap-1.5 overflow-x-auto hide-scrollbar flex-1"
        role="tablist"
        aria-label="Market categories"
      >
        {tabs.map((tab) => {
          const isActive = activeCategory === tab.id;
          const colorClass =
            isActive && tab.id !== "all"
              ? CATEGORY_COLORS[tab.id] ?? "border-neo-brand/50 bg-neo-brand/10 text-neo-brand"
              : "";

          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onSetCategory(tab.id)}
              className={`shrink-0 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${
                isActive
                  ? tab.id === "all"
                    ? "border-neo-brand/50 bg-neo-brand/10 text-neo-brand"
                    : colorClass
                  : "border-white/10 text-white/50 hover:border-white/25 hover:text-white/70"
              }`}
            >
              {tab.label}
              {tab.count > 0 && (
                <span className={`ml-1 text-xs ${isActive ? "opacity-80" : "opacity-50"}`}>
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <select
        value={sortBy}
        onChange={(e) => onSortChange(e.target.value as SortMode)}
        className="shrink-0 bg-white/5 border border-white/10 rounded-lg text-xs text-white/70 px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-neo-brand/40"
        aria-label="Sort markets"
      >
        <option value="engagement">Trending</option>
        <option value="volume">Volume</option>
        <option value="ending">Ending Soon</option>
        <option value="disagreement">Disagreement</option>
      </select>
    </div>
  );
}
