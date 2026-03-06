"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Scrolling live news headline feed — Polymarket-style.
 * Headlines stream in with staggered timing, auto-scroll, sliding window.
 */

interface NewsItem {
  source: string;
  sourceColor: string;
  timeAgo: string;
  headline: string;
  url?: string;
  reliability?: {
    label: string;
    reliabilityScore: number;
    backtestConfidence: number;
  };
}

/* ── Headline pools keyed by question regex ── */

const TRUMP_HEADLINES: NewsItem[] = [
  { source: "Reuters", sourceColor: "#ff6600", timeAgo: "2h ago", headline: "White House confirms new executive order on tariff escalation with China" },
  { source: "WSJ", sourceColor: "#0274b6", timeAgo: "3h ago", headline: "Treasury officials signal shift in trade policy framework ahead of G7" },
  { source: "AP", sourceColor: "#e51937", timeAgo: "4h ago", headline: "Bipartisan pushback grows over proposed tariff rates on EU imports" },
  { source: "Bloomberg", sourceColor: "#472a91", timeAgo: "5h ago", headline: "Markets react as policy uncertainty index hits 6-month high" },
  { source: "BBC", sourceColor: "#bb1919", timeAgo: "6h ago", headline: "European leaders respond to latest trade negotiation breakdown" },
  { source: "Reuters", sourceColor: "#ff6600", timeAgo: "7h ago", headline: "Congressional hearing set to review executive trade authority scope" },
  { source: "WSJ", sourceColor: "#0274b6", timeAgo: "8h ago", headline: "Dollar weakens on trade tension fears, Treasury yields climb" },
  { source: "AP", sourceColor: "#e51937", timeAgo: "10h ago", headline: "Former trade advisors warn of supply chain disruption risks" },
  { source: "Bloomberg", sourceColor: "#472a91", timeAgo: "12h ago", headline: "Business groups lobby for exemptions amid policy uncertainty" },
  { source: "BBC", sourceColor: "#bb1919", timeAgo: "14h ago", headline: "Analysis: What the latest policy shift means for global trade" },
  { source: "Reuters", sourceColor: "#ff6600", timeAgo: "16h ago", headline: "Manufacturing sector braces for potential cost increases" },
  { source: "WSJ", sourceColor: "#0274b6", timeAgo: "1d ago", headline: "Tech companies assess impact of proposed import restrictions" },
];

const ELECTION_HEADLINES: NewsItem[] = [
  { source: "AP", sourceColor: "#e51937", timeAgo: "1h ago", headline: "New polling shows tightening margins in key battleground states" },
  { source: "Reuters", sourceColor: "#ff6600", timeAgo: "2h ago", headline: "Campaign fundraising totals shatter Q1 records across both parties" },
  { source: "WSJ", sourceColor: "#0274b6", timeAgo: "3h ago", headline: "Senate race forecasts shift after surprise endorsement wave" },
  { source: "Bloomberg", sourceColor: "#472a91", timeAgo: "4h ago", headline: "Voter registration surges in swing districts ahead of deadline" },
  { source: "BBC", sourceColor: "#bb1919", timeAgo: "5h ago", headline: "International observers assess integrity of election infrastructure" },
  { source: "AP", sourceColor: "#e51937", timeAgo: "6h ago", headline: "Early voting data reveals unexpected demographic turnout patterns" },
  { source: "Reuters", sourceColor: "#ff6600", timeAgo: "8h ago", headline: "Debate commission announces format changes for upcoming cycle" },
  { source: "WSJ", sourceColor: "#0274b6", timeAgo: "10h ago", headline: "Super PAC spending accelerates in final stretch of primaries" },
  { source: "Bloomberg", sourceColor: "#472a91", timeAgo: "12h ago", headline: "Down-ballot races draw attention as national mood shifts" },
  { source: "BBC", sourceColor: "#bb1919", timeAgo: "1d ago", headline: "Analysis: How economic sentiment is reshaping the electoral map" },
  { source: "Reuters", sourceColor: "#ff6600", timeAgo: "1d ago", headline: "State legislatures weigh new voting access measures" },
  { source: "AP", sourceColor: "#e51937", timeAgo: "1d ago", headline: "Youth voter engagement hits historic highs in latest surveys" },
];

const CONFLICT_HEADLINES: NewsItem[] = [
  { source: "Reuters", sourceColor: "#ff6600", timeAgo: "45m ago", headline: "Diplomatic channels reopen as ceasefire talks enter critical phase" },
  { source: "BBC", sourceColor: "#bb1919", timeAgo: "1h ago", headline: "UN Security Council convenes emergency session on escalation" },
  { source: "AP", sourceColor: "#e51937", timeAgo: "2h ago", headline: "Humanitarian corridors established amid intensifying conflict" },
  { source: "Bloomberg", sourceColor: "#472a91", timeAgo: "3h ago", headline: "Energy markets spike as supply route disruptions widen" },
  { source: "WSJ", sourceColor: "#0274b6", timeAgo: "4h ago", headline: "Defense analysts assess shifting balance of strategic positions" },
  { source: "Reuters", sourceColor: "#ff6600", timeAgo: "5h ago", headline: "Sanctions package expanded to include additional sectors" },
  { source: "BBC", sourceColor: "#bb1919", timeAgo: "6h ago", headline: "Refugee flows intensify at border crossings, agencies warn" },
  { source: "AP", sourceColor: "#e51937", timeAgo: "8h ago", headline: "Allied nations coordinate response to latest developments" },
  { source: "Bloomberg", sourceColor: "#472a91", timeAgo: "10h ago", headline: "Global supply chains face new disruption risks from conflict zone" },
  { source: "WSJ", sourceColor: "#0274b6", timeAgo: "12h ago", headline: "Intelligence assessments diverge on timeline for resolution" },
  { source: "BBC", sourceColor: "#bb1919", timeAgo: "1d ago", headline: "Peace framework proposal gains cautious support from key actors" },
  { source: "Reuters", sourceColor: "#ff6600", timeAgo: "1d ago", headline: "Satellite imagery reveals infrastructure damage in contested area" },
];

const DEFAULT_HEADLINES: NewsItem[] = [
  { source: "Reuters", sourceColor: "#ff6600", timeAgo: "1h ago", headline: "Policy analysts weigh implications of latest regulatory shift" },
  { source: "AP", sourceColor: "#e51937", timeAgo: "2h ago", headline: "New government data challenges conventional economic assumptions" },
  { source: "Bloomberg", sourceColor: "#472a91", timeAgo: "3h ago", headline: "Cross-party negotiations stall over key legislative provisions" },
  { source: "BBC", sourceColor: "#bb1919", timeAgo: "4h ago", headline: "Public opinion shifts on major policy issue, new survey shows" },
  { source: "WSJ", sourceColor: "#0274b6", timeAgo: "5h ago", headline: "Institutional credibility concerns mount amid political turbulence" },
  { source: "Reuters", sourceColor: "#ff6600", timeAgo: "6h ago", headline: "International coalition announces framework for cooperation" },
  { source: "AP", sourceColor: "#e51937", timeAgo: "8h ago", headline: "State-level policy experiments draw national attention" },
  { source: "Bloomberg", sourceColor: "#472a91", timeAgo: "10h ago", headline: "Political risk premium rises in sovereign debt markets" },
  { source: "BBC", sourceColor: "#bb1919", timeAgo: "12h ago", headline: "Former officials call for bipartisan approach to emerging threats" },
  { source: "WSJ", sourceColor: "#0274b6", timeAgo: "1d ago", headline: "Think tank report outlines scenarios for policy trajectory" },
  { source: "Reuters", sourceColor: "#ff6600", timeAgo: "1d ago", headline: "Regional alliances shift as geopolitical landscape evolves" },
  { source: "AP", sourceColor: "#e51937", timeAgo: "1d ago", headline: "Demographics data reshapes assumptions about political alignment" },
];

function getHeadlinePool(question: string): NewsItem[] {
  const q = question.toLowerCase();
  if (/trump/.test(q)) return TRUMP_HEADLINES;
  if (/election|vote|senate|congress|ballot/.test(q)) return ELECTION_HEADLINES;
  if (/ceasefire|war|ukraine|russia|iran|conflict|military/.test(q)) return CONFLICT_HEADLINES;
  return DEFAULT_HEADLINES;
}

interface VisibleHeadline extends NewsItem {
  id: number;
  isNew: boolean;
}

interface IntelNewsEntry {
  source?: string;
  headline?: string;
  color?: string;
  timestamp?: number;
  url?: string;
  reliability?: {
    label?: string;
    reliabilityScore?: number;
    backtestConfidence?: number;
  };
}

interface IntelFeedResponse {
  mode?: "live" | "fallback";
  news?: IntelNewsEntry[];
}

function normalizeReliability(value: IntelNewsEntry["reliability"]) {
  if (!value || typeof value !== "object") return undefined;
  if (
    typeof value.reliabilityScore !== "number" ||
    !Number.isFinite(value.reliabilityScore) ||
    typeof value.backtestConfidence !== "number" ||
    !Number.isFinite(value.backtestConfidence)
  ) {
    return undefined;
  }
  return {
    label:
      typeof value.label === "string" && value.label.trim().length > 0
        ? value.label.trim()
        : "SOURCE",
    reliabilityScore: Math.max(0, Math.min(1, value.reliabilityScore)),
    backtestConfidence: Math.max(0, Math.min(1, value.backtestConfidence)),
  };
}

function formatTimeAgo(timestamp: number): string {
  const delta = Math.max(0, Date.now() - timestamp);
  const sec = Math.floor(delta / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

export default function LiveNewsFeed({
  question,
  marketId,
}: {
  question: string;
  marketId?: number;
}) {
  const fallbackPool = useMemo(() => getHeadlinePool(question), [question]);
  const [livePool, setLivePool] = useState<NewsItem[]>(fallbackPool);
  const pool = useMemo(
    () => (livePool.length > 0 ? livePool : fallbackPool),
    [livePool, fallbackPool]
  );
  const [headlines, setHeadlines] = useState<VisibleHeadline[]>([]);
  const [nextIdx, setNextIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const idCounter = useRef(0);

  useEffect(() => {
    setLivePool(fallbackPool);
  }, [fallbackPool]);

  useEffect(() => {
    let cancelled = false;
    const loadIntel = async () => {
      try {
        const params = new URLSearchParams({
          question,
          limit: "6",
        });
        if (typeof marketId === "number") {
          params.set("marketId", String(marketId));
        }
        const response = await fetch(`/api/intel/feed?${params.toString()}`, {
          cache: "no-store",
        });
        if (!response.ok) return;
        const payload = (await response.json()) as IntelFeedResponse;
        const news = Array.isArray(payload.news) ? payload.news : [];
        if (news.length === 0) return;

        const mapped: NewsItem[] = [];
        for (const entry of news) {
          const source = (entry.source ?? "").trim();
          const headline = (entry.headline ?? "").trim();
          if (!source || !headline) continue;
          mapped.push({
            source,
            headline,
            url: entry.url?.trim() || undefined,
            sourceColor: entry.color ?? "#64748b",
            timeAgo:
              typeof entry.timestamp === "number"
                ? formatTimeAgo(entry.timestamp)
                : "just now",
            reliability: normalizeReliability(entry.reliability),
          });
        }

        if (cancelled || mapped.length === 0) return;
        setLivePool(mapped);
      } catch {
        // Keep graceful fallback pool when intel feed is unavailable.
      }
    };

    void loadIntel();
    const intervalId = setInterval(() => {
      void loadIntel();
    }, 45_000);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [question, marketId]);

  // Phase 1: Stream initial 3 headlines in with staggered timing
  useEffect(() => {
    if (pool.length === 0) return;
    let cancelled = false;
    const initialCount = 3;
    let currentIdx = 0;
    setHeadlines([]);
    setNextIdx(0);
    idCounter.current = 0;

    function addNext() {
      if (cancelled || currentIdx >= initialCount) return;
      const item = pool[currentIdx % pool.length];
      if (!item) return;
      const id = ++idCounter.current;
      setHeadlines(prev => [...prev, { ...item, id, isNew: true }]);
      currentIdx++;
      setNextIdx(currentIdx);
      // Stagger: next headline after a beat
      setTimeout(addNext, 800 + Math.random() * 400);
    }

    const t = setTimeout(addNext, 500);
    return () => { cancelled = true; clearTimeout(t); };
  }, [pool]);

  // Remove "isNew" flag after entrance animation
  useEffect(() => {
    const hasNew = headlines.some(h => h.isNew);
    if (!hasNew) return;
    const t = setTimeout(() => {
      setHeadlines(prev => prev.map(h => h.isNew ? { ...h, isNew: false } : h));
    }, 500);
    return () => clearTimeout(t);
  }, [headlines]);

  // Phase 2: New headlines every 6-10s, max 4 visible (prevents card growth)
  useEffect(() => {
    if (nextIdx < 3) return;
    if (pool.length === 0) return;
    const interval = setInterval(() => {
      const item = pool[nextIdx % pool.length];
      if (!item) return;
      const id = ++idCounter.current;
      setHeadlines(prev => {
        const next = [...prev, { ...item, id, isNew: true }];
        if (next.length > 4) return next.slice(next.length - 4);
        return next;
      });
      setNextIdx(prev => prev + 1);
    }, 6000 + Math.random() * 4000);
    return () => clearInterval(interval);
  }, [nextIdx, pool]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [headlines.length]);

  return (
    <div className="h-full flex flex-col">
      {/* Headline list */}
      <div
        ref={containerRef}
        className="space-y-4 flex-1 min-h-0 overflow-y-auto hide-scrollbar scroll-smooth"
      >
        {headlines.map((h) => (
          <div
            key={h.id}
            className={`group/headline transition-all duration-300 ${h.isNew ? "animate-chat-slide-in" : ""}`}
          >
            {/* Source + time — Polymarket style */}
            <div className="flex items-center gap-2 mb-1">
              <span
                className="w-[8px] h-[8px] rounded-[2px] shrink-0"
                style={{ background: h.sourceColor }}
              />
              <span
                className="text-[13px] font-heading font-semibold"
                style={{ color: h.sourceColor }}
              >
                {h.source}
              </span>
              <span className="text-[11px] text-white/25 font-mono">&middot;</span>
              <span className="text-[11px] text-white/25 font-mono">{h.timeAgo}</span>
              {h.reliability && (
                <>
                  <span className="text-[11px] text-white/20 font-mono">&middot;</span>
                  <span className="rounded border border-cyan-300/25 bg-cyan-400/10 px-1.5 py-[1px] text-[9px] font-mono text-cyan-100/90">
                    {h.reliability.label} R{Math.round(h.reliability.reliabilityScore * 100)} B
                    {Math.round(h.reliability.backtestConfidence * 100)}
                  </span>
                </>
              )}
            </div>
            {/* Headline text — brighter like Polymarket */}
            {h.url ? (
              <a
                href={h.url}
                target="_blank"
                rel="noreferrer"
                className="text-[13px] text-white/70 leading-relaxed line-clamp-2 group-hover/headline:text-white/90 transition-colors hover:underline"
              >
                {h.headline}
              </a>
            ) : (
              <p className="text-[13px] text-white/70 leading-relaxed line-clamp-2 group-hover/headline:text-white/90 transition-colors">
                {h.headline}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Thin separator bar — Polymarket style */}
      <div className="shrink-0 mt-2 mb-1">
        <div className="w-5 h-[2px] rounded-full bg-neo-red/40" />
      </div>

      {/* Live indicator */}
      <div className="shrink-0 flex items-center gap-1.5 pb-1">
        <span className="relative w-1.5 h-1.5 rounded-full bg-neo-green">
          <span className="absolute inset-0 rounded-full bg-neo-green animate-ping opacity-75" />
        </span>
        <span className="text-[10px] font-heading font-medium text-white/25 tracking-wider uppercase">Live News</span>
      </div>
    </div>
  );
}
