"use client";

import { useMemo, useState } from "react";
import type { MarketCategory } from "@/lib/categories";
import { categorizeMarket } from "@/lib/categories";

interface CategorySidebarProps {
  markets: { question: string; resolutionTime: number }[];
  activeCategory: MarketCategory;
  activeSubcategory: string | null;
  onSetCategory: (category: MarketCategory) => void;
  onSetSubcategory: (sub: string | null) => void;
}

// Define subcategories for each main category
export const SUBCATEGORIES: Record<string, { label: string; icon: string; regex: RegExp }[]> = {
  sports: [
    { label: "NFL", icon: "🏈", regex: /nfl|super bowl|seahawks|patriots|chiefs|eagles|49ers|ravens|bills|cowboys|packers|dolphins|lions|bengals|steelers|broncos|jets|giants|raiders|chargers|rams|bears|saints|cardinals|falcons|panthers|buccaneers|colts|texans|jaguars|titans|commanders|vikings|browns/i },
    { label: "NBA", icon: "🏀", regex: /nba|lakers|celtics|warriors|bucks|nuggets|76ers|heat|knicks|nets|suns|clippers|mavericks|grizzlies|cavaliers|timberwolves|thunder/i },
    { label: "Soccer", icon: "⚽", regex: /premier league|la liga|serie a|bundesliga|ligue 1|liga mx|champions league|europa league|world cup|copa america|arsenal|manchester|liverpool|chelsea|tottenham|real madrid|barcelona|juventus|bayern|psg|inter milan/i },
    { label: "MLB", icon: "⚾", regex: /mlb|yankees|dodgers|astros|braves|phillies|world series/i },
    { label: "UFC / Boxing", icon: "🥊", regex: /ufc|mma|boxing|bellator|pfl/i },
    { label: "Tennis", icon: "🎾", regex: /tennis|wimbledon|us open|australian open|french open|roland garros|atp|wta/i },
    { label: "F1", icon: "🏎️", regex: /formula 1|f1|grand prix|monaco gp|silverstone/i },
    { label: "Golf", icon: "⛳", regex: /golf|pga|masters|british open|ryder cup/i },
    { label: "Cricket", icon: "🏏", regex: /cricket|ipl|test match|t20|ashes/i },
    { label: "NHL", icon: "🏒", regex: /nhl|hockey|stanley cup/i },
    { label: "College", icon: "🎓", regex: /ncaa|march madness|college football|cfp/i },
    { label: "Olympics", icon: "🏅", regex: /olympics|paralympics/i },
  ],
  politics: [
    { label: "US", icon: "🇺🇸", regex: /president|congress|senate|white house|supreme court|biden|executive order/i },
    { label: "Elections", icon: "🗳️", regex: /election|primary|caucus|electoral|ballot|polling|nominee|vote|midterm/i },
    { label: "Trump", icon: "🇺🇸", regex: /trump/i },
    { label: "Policy", icon: "🏛️", regex: /policy|regulation|legislation|bill|act|law|tariff/i },
    { label: "Congress", icon: "🏛️", regex: /congress|senate|house|filibuster|bipartisan/i },
    { label: "Courts", icon: "⚖️", regex: /supreme court|court|ruling|indictment|special counsel/i },
    { label: "Foreign Policy", icon: "🌐", regex: /foreign policy|diplomacy|embassy|ambassador/i },
  ],
  crypto: [
    { label: "Bitcoin", icon: "₿", regex: /bitcoin|btc/i },
    { label: "Ethereum", icon: "⟠", regex: /ethereum|eth\b/i },
    { label: "Starknet", icon: "⬡", regex: /starknet|strk/i },
    { label: "Solana", icon: "◎", regex: /solana|sol\b/i },
    { label: "DeFi", icon: "🔗", regex: /defi|tvl|liquidity|yield|staking/i },
    { label: "Regulation", icon: "📋", regex: /sec|regulation|etf|binance|coinbase/i },
    { label: "NFT", icon: "🖼️", regex: /nft|opensea/i },
  ],
  finance: [
    { label: "Fed / Rates", icon: "🏦", regex: /fed\b|interest rate|rate cut|rate hike|federal reserve/i },
    { label: "Stocks", icon: "📈", regex: /stock|s&p|nasdaq|dow jones|market cap/i },
    { label: "IPO / M&A", icon: "💼", regex: /ipo|merger|acquisition|buyout/i },
    { label: "Commodities", icon: "🛢️", regex: /oil|gold|silver|commodity|wheat|natural gas/i },
  ],
  tech: [
    { label: "AI", icon: "🤖", regex: /\bai\b|artificial intelligence|gpt|llm|openai|anthropic|claude/i },
    { label: "Big Tech", icon: "💻", regex: /apple|google|microsoft|meta|nvidia|amazon/i },
    { label: "Space", icon: "🚀", regex: /spacex|nasa|space|rocket|satellite|mars/i },
    { label: "Semiconductors", icon: "🔬", regex: /semiconductor|chip|tsmc|intel|amd/i },
  ],
  culture: [
    { label: "Movies / TV", icon: "🎬", regex: /movie|film|oscars|netflix|disney|streaming|hbo|box office/i },
    { label: "Music", icon: "🎵", regex: /music|grammy|album|concert|taylor swift|drake|beyonce|k-pop|bts/i },
    { label: "Gaming", icon: "🎮", regex: /gaming|playstation|xbox|nintendo|gta|fortnite|elden ring/i },
    { label: "Social Media", icon: "📱", regex: /tiktok|youtube|twitter|instagram|social media/i },
  ],
  geopolitics: [
    { label: "Ukraine/Russia", icon: "🇺🇦", regex: /ukraine|russia|zelensky|putin/i },
    { label: "Middle East", icon: "🕊️", regex: /israel|gaza|iran|middle east|ceasefire/i },
    { label: "China / Taiwan", icon: "🇨🇳", regex: /china|taiwan|xi jinping|south china sea/i },
  ],
  economy: [
    { label: "Inflation", icon: "📊", regex: /inflation|cpi|consumer price/i },
    { label: "Jobs", icon: "👷", regex: /jobs|unemployment|nonfarm|payroll/i },
    { label: "GDP", icon: "📉", regex: /gdp|recession|economic growth/i },
  ],
};

const CAT_ICONS: Record<string, string> = {
  sports: "🏆",
  politics: "🏛️",
  crypto: "₿",
  finance: "📊",
  tech: "💻",
  culture: "🎭",
  geopolitics: "🌍",
  elections: "🗳️",
  earnings: "💰",
  economy: "🏦",
  climate: "🌿",
  world: "🌐",
  other: "📦",
};

export default function CategorySidebar({
  markets,
  activeCategory,
  activeSubcategory,
  onSetCategory,
  onSetSubcategory,
}: CategorySidebarProps) {
  const [expandedCats, setExpandedCats] = useState<Set<string>>(
    new Set([activeCategory])
  );

  // Compute counts per category and subcategory
  const { categoryCounts, subcategoryCounts } = useMemo(() => {
    const catCounts: Record<string, number> = {};
    const subCounts: Record<string, Record<string, number>> = {};

    for (const m of markets) {
      const cat = categorizeMarket(m.question);
      catCounts[cat] = (catCounts[cat] ?? 0) + 1;

      // Check subcategories
      const subs = SUBCATEGORIES[cat];
      if (subs) {
        if (!subCounts[cat]) subCounts[cat] = {};
        for (const sub of subs) {
          if (sub.regex.test(m.question)) {
            subCounts[cat][sub.label] = (subCounts[cat][sub.label] ?? 0) + 1;
          }
        }
      }
    }

    return { categoryCounts: catCounts, subcategoryCounts: subCounts };
  }, [markets]);

  const toggleExpand = (cat: string) => {
    setExpandedCats(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  // Order categories by count descending
  const orderedCats = useMemo(() => {
    const cats = Object.entries(categoryCounts)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1]);
    return cats;
  }, [categoryCounts]);

  // Ending soon count
  const endingSoonCount = useMemo(() => {
    const cutoff = Date.now() / 1000 + 7 * 86400; // next 7 days
    return markets.filter(m => m.resolutionTime > Date.now() / 1000 && m.resolutionTime < cutoff).length;
  }, [markets]);

  return (
    <aside className="w-[220px] shrink-0 hidden lg:block">
      <div className="sticky top-40 max-h-[calc(100vh-180px)] overflow-y-auto hide-scrollbar pb-8">
        {/* Category tree */}
        <nav className="space-y-0.5">
          {orderedCats.map(([cat, count]) => {
            const isActive = activeCategory === cat;
            const isExpanded = expandedCats.has(cat);
            const subs = SUBCATEGORIES[cat];
            const subCounts = subcategoryCounts[cat] ?? {};
            const hasSubs = subs && subs.some(s => (subCounts[s.label] ?? 0) > 0);

            return (
              <div key={cat}>
                {/* Main category row */}
                <button
                  type="button"
                  onClick={() => {
                    onSetCategory(cat as MarketCategory);
                    onSetSubcategory(null);
                    if (hasSubs) toggleExpand(cat);
                  }}
                  className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-all group ${
                    isActive && !activeSubcategory
                      ? "bg-white/[0.08] text-white"
                      : "text-white/55 hover:text-white/80 hover:bg-white/[0.03]"
                  }`}
                >
                  {hasSubs && (
                    <svg className={`w-3 h-3 shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""} ${isActive ? "text-white/40" : "text-white/20"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                  )}
                  {!hasSubs && <div className="w-3 shrink-0" />}
                  <span className="text-[13px] shrink-0">{CAT_ICONS[cat] ?? "📦"}</span>
                  <span className={`text-[13px] font-semibold capitalize flex-1 truncate ${isActive && !activeSubcategory ? "text-white" : ""}`}>
                    {cat}
                  </span>
                  <span className={`text-[11px] font-mono tabular-nums shrink-0 ${isActive && !activeSubcategory ? "text-white/50" : "text-white/25"}`}>
                    ({count.toLocaleString()})
                  </span>
                </button>

                {/* Subcategories */}
                {isExpanded && hasSubs && (
                  <div className="ml-5 border-l border-white/[0.06] pl-2 mt-0.5 mb-1 space-y-0">
                    {subs
                      .filter(s => (subCounts[s.label] ?? 0) > 0)
                      .map(sub => {
                        const subCount = subCounts[sub.label] ?? 0;
                        const isSubActive = activeCategory === cat && activeSubcategory === sub.label;
                        return (
                          <button
                            key={sub.label}
                            type="button"
                            onClick={() => {
                              onSetCategory(cat as MarketCategory);
                              onSetSubcategory(sub.label);
                            }}
                            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-all ${
                              isSubActive
                                ? "bg-white/[0.06] text-white"
                                : "text-white/40 hover:text-white/65 hover:bg-white/[0.02]"
                            }`}
                          >
                            <span className="text-[12px] shrink-0">{sub.icon}</span>
                            <span className={`text-[12px] font-medium flex-1 truncate ${isSubActive ? "text-white" : ""}`}>
                              {sub.label}
                            </span>
                            <span className={`text-[10px] font-mono tabular-nums shrink-0 ${isSubActive ? "text-white/40" : "text-white/20"}`}>
                              ({subCount})
                            </span>
                          </button>
                        );
                      })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Browse section */}
        <div className="mt-6 pt-4 border-t border-white/[0.06]">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-white/30 px-2.5 mb-2">Browse</h4>
          <div className="space-y-0.5">
            <button
              type="button"
              onClick={() => { onSetCategory("all" as MarketCategory); onSetSubcategory(null); }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-white/40 hover:text-white/65 hover:bg-white/[0.03] transition-all"
            >
              <span className="text-[12px]">✨</span>
              <span className="text-[12px] font-medium flex-1">New</span>
              <span className="text-[10px] font-mono text-white/20">({markets.length})</span>
            </button>
            <button
              type="button"
              onClick={() => { onSetCategory("all" as MarketCategory); onSetSubcategory(null); }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-white/40 hover:text-white/65 hover:bg-white/[0.03] transition-all"
            >
              <span className="text-[12px]">🔥</span>
              <span className="text-[12px] font-medium flex-1">Trending</span>
            </button>
            <button
              type="button"
              onClick={() => { onSetCategory("all" as MarketCategory); onSetSubcategory(null); }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-white/40 hover:text-white/65 hover:bg-white/[0.03] transition-all"
            >
              <span className="text-[12px]">⏳</span>
              <span className="text-[12px] font-medium flex-1">Ending Soon</span>
              <span className="text-[10px] font-mono text-white/20">({endingSoonCount})</span>
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
