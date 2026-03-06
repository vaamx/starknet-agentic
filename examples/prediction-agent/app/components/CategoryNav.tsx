"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MarketCategory } from "@/lib/categories";
import type { CategoryTab } from "./dashboard/types";

const SPECIAL_TABS: { id: string; label: string; category: MarketCategory; icon?: string }[] = [
  { id: "trending", label: "Trending", category: "all" },
  { id: "breaking", label: "Breaking", category: "all" },
  { id: "new", label: "New", category: "all" },
];

const TOPIC_TABS: { id: string; label: string; category: MarketCategory }[] = [
  { id: "politics", label: "Politics", category: "politics" },
  { id: "sports", label: "Sports", category: "sports" },
  { id: "crypto", label: "Crypto", category: "crypto" },
  { id: "finance", label: "Finance", category: "crypto" },
  { id: "geopolitics", label: "Geopolitics", category: "politics" },
  { id: "earnings", label: "Earnings", category: "crypto" },
  { id: "tech", label: "Tech", category: "tech" },
  { id: "culture", label: "Culture", category: "other" },
  { id: "world", label: "World", category: "other" },
  { id: "economy", label: "Economy", category: "politics" },
  { id: "climate", label: "Climate & Science", category: "other" },
  { id: "elections", label: "Elections", category: "politics" },
];

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
  const [activeTab, setActiveTab] = useState("trending");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    const matchingTopic = TOPIC_TABS.find((t) => t.id === activeTab && t.category === activeCategory);
    const matchingSpecial = SPECIAL_TABS.find((t) => t.id === activeTab && t.category === activeCategory);
    if (!matchingTopic && !matchingSpecial) {
      const firstMatch =
        TOPIC_TABS.find((t) => t.category === activeCategory) ??
        SPECIAL_TABS.find((t) => t.category === activeCategory);
      if (firstMatch) setActiveTab(firstMatch.id);
    }
  }, [activeCategory, activeTab]);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    checkScroll();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", checkScroll, { passive: true });
    window.addEventListener("resize", checkScroll);
    return () => {
      el.removeEventListener("scroll", checkScroll);
      window.removeEventListener("resize", checkScroll);
    };
  }, [checkScroll]);

  const handleTabClick = useCallback(
    (id: string, category: MarketCategory) => {
      setActiveTab(id);
      onSetCategory(category);
    },
    [onSetCategory]
  );

  const scroll = useCallback((dir: "left" | "right") => {
    scrollRef.current?.scrollBy({ left: dir === "left" ? -200 : 200, behavior: "smooth" });
  }, []);

  return (
    <div className="sticky top-24 z-40 border-b border-white/[0.06] bg-[#111827]/90 backdrop-blur-xl">
      <div className="relative mx-auto max-w-[1400px] px-3 sm:px-4 lg:px-5">
        {/* Scroll shadow left */}
        {canScrollLeft && (
          <button
            type="button"
            onClick={() => scroll("left")}
            className="absolute left-0 top-0 bottom-0 z-10 flex items-center pl-2 pr-4 bg-gradient-to-r from-[#111827] via-[#111827]/90 to-transparent"
            aria-label="Scroll left"
          >
            <svg className="w-4 h-4 text-white/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
        )}

        <div
          ref={scrollRef}
          className="flex h-12 items-center overflow-x-auto hide-scrollbar"
          role="tablist"
          aria-label="Market categories"
        >
          <div className="flex items-center gap-0.5 min-w-max">
            {SPECIAL_TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => handleTabClick(tab.id, tab.category)}
                  className={`relative inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] font-semibold transition-all duration-200 rounded-lg ${
                    isActive
                      ? "text-white"
                      : "text-white/50 hover:text-white/80"
                  }`}
                >
                  {tab.id === "trending" && (
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.306a11.95 11.95 0 015.814-5.518l2.74-1.22m0 0l-5.94-2.281m5.94 2.28l-2.28 5.941" />
                    </svg>
                  )}
                  {tab.id === "breaking" && (
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                    </svg>
                  )}
                  {tab.id === "new" && (
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                    </svg>
                  )}
                  {tab.label}
                  {isActive && (
                    <span className="absolute inset-x-1 -bottom-[7px] h-[2px] rounded-full bg-neo-brand" />
                  )}
                </button>
              );
            })}

            <div className="mx-2 h-4 w-px shrink-0 bg-white/[0.1]" />

            {TOPIC_TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => handleTabClick(tab.id, tab.category)}
                  className={`relative whitespace-nowrap px-3 py-1.5 text-[13px] font-semibold transition-all duration-200 rounded-lg ${
                    isActive
                      ? "text-white"
                      : "text-white/45 hover:text-white/75"
                  }`}
                >
                  {tab.label}
                  {isActive && (
                    <span className="absolute inset-x-1 -bottom-[7px] h-[2px] rounded-full bg-neo-brand" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Scroll shadow right */}
        {canScrollRight && (
          <button
            type="button"
            onClick={() => scroll("right")}
            className="absolute right-0 top-0 bottom-0 z-10 flex items-center pr-2 pl-4 bg-gradient-to-l from-[#111827] via-[#111827]/90 to-transparent"
            aria-label="Scroll right"
          >
            <svg className="w-4 h-4 text-white/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
