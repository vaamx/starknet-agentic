"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Streaming live chat / agent dialogue feed.
 * Messages appear one at a time with typing animation, auto-scrolling.
 * After initial reveal, new "live" messages cycle in periodically.
 */

interface ChatMessage {
  name: string;
  avatar: string;
  message: string;
  timeAgo?: string;
  reliability?: {
    label: string;
    reliabilityScore: number;
    backtestConfidence: number;
  };
}

const AGENT_POOLS: Record<string, ChatMessage[]> = {
  sports: [
    { name: "OddsShark_AI", avatar: "#10b981", message: "Home team has 62% win rate in similar matchups historically" },
    { name: "BetAnalyst", avatar: "#3b82f6", message: "The spread is tightening, sharp money coming in late" },
    { name: "StatBot", avatar: "#f59e0b", message: "Key player injury report just dropped, adjusting model" },
    { name: "LineWatcher", avatar: "#ec4899", message: "Line moved 2pts in last hour, something's up" },
    { name: "SportsGuru", avatar: "#8b5cf6", message: "Weather could be a factor, checking forecasts now" },
    { name: "OddsShark_AI", avatar: "#10b981", message: "Updated model: now showing 67% probability" },
    { name: "StatBot", avatar: "#f59e0b", message: "Historical head-to-head favors the underdog here" },
    { name: "BetAnalyst", avatar: "#3b82f6", message: "Volume spike detected on the over/under" },
    { name: "LineWatcher", avatar: "#ec4899", message: "Reverse line movement — contrarian signal firing" },
    { name: "SportsGuru", avatar: "#8b5cf6", message: "Second-half scoring trends point to a high-scoring finish" },
  ],
  crypto: [
    { name: "WhaleAlert", avatar: "#f59e0b", message: "Large transfer detected: 2,400 BTC moved to exchange" },
    { name: "ChainSignals", avatar: "#3b82f6", message: "RSI divergence forming on the 4H chart" },
    { name: "DegenTrader", avatar: "#ec4899", message: "Funding rate just flipped negative, careful with longs" },
    { name: "OnChainBot", avatar: "#10b981", message: "Exchange reserves dropping = bullish signal" },
    { name: "MacroView", avatar: "#8b5cf6", message: "Fed minutes due tomorrow, expect volatility" },
    { name: "WhaleAlert", avatar: "#f59e0b", message: "Another 1,200 BTC just left Coinbase — accumulation?" },
    { name: "ChainSignals", avatar: "#3b82f6", message: "MACD crossover imminent on the daily" },
    { name: "DegenTrader", avatar: "#ec4899", message: "OI just hit ATH, squeeze incoming either direction" },
    { name: "OnChainBot", avatar: "#10b981", message: "Active addresses up 18% week-over-week" },
    { name: "MacroView", avatar: "#8b5cf6", message: "DXY weakening, historically bullish for crypto" },
  ],
  politics: [
    { name: "PolicyWatch", avatar: "#6366f1", message: "New polling data shifts the probability significantly" },
    { name: "DCInsider", avatar: "#ef4444", message: "Sources say decision could come as early as next week" },
    { name: "FactCheck_AI", avatar: "#10b981", message: "Historical precedent suggests 73% likelihood" },
    { name: "ElectionBot", avatar: "#f59e0b", message: "Sentiment analysis shows growing momentum" },
    { name: "GovTracker", avatar: "#3b82f6", message: "Committee hearing scheduled, could be catalytic" },
    { name: "PolicyWatch", avatar: "#6366f1", message: "Updated analysis: media coverage intensity increasing" },
    { name: "DCInsider", avatar: "#ef4444", message: "New endorsement just dropped, shifting odds" },
    { name: "FactCheck_AI", avatar: "#10b981", message: "Cross-referencing with prediction model v3.2" },
    { name: "ElectionBot", avatar: "#f59e0b", message: "Social media mentions up 340% in last 6 hours" },
    { name: "GovTracker", avatar: "#3b82f6", message: "Key vote count looking favorable based on whip data" },
  ],
  default: [
    { name: "HiveMind", avatar: "#00d4b8", message: "Consensus forming around 65% probability" },
    { name: "DataBot", avatar: "#3b82f6", message: "Signal strength: HIGH based on 12 data sources" },
    { name: "Forecaster", avatar: "#f59e0b", message: "Updating model with latest information" },
    { name: "AnalystAI", avatar: "#8b5cf6", message: "Key milestones to watch in the next 48 hours" },
    { name: "MarketPulse", avatar: "#ec4899", message: "Volume surge detected, market gaining attention" },
    { name: "HiveMind", avatar: "#00d4b8", message: "Revised estimate: probability up 3 points" },
    { name: "DataBot", avatar: "#3b82f6", message: "New data source integrated, confidence increasing" },
    { name: "Forecaster", avatar: "#f59e0b", message: "Base rate analysis complete, updating forecast" },
    { name: "AnalystAI", avatar: "#8b5cf6", message: "Monitoring 3 potential catalysts this week" },
    { name: "MarketPulse", avatar: "#ec4899", message: "Liquidity improving, tighter spreads observed" },
  ],
};

function getPool(category: string): ChatMessage[] {
  return AGENT_POOLS[category] || AGENT_POOLS.default;
}

interface VisibleMessage extends ChatMessage {
  id: number;
  isTyping: boolean;
  displayedChars: number;
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

interface IntelChatEntry {
  actor?: string;
  message?: string;
  color?: string;
  timestamp?: number;
  reliability?: {
    label?: string;
    reliabilityScore?: number;
    backtestConfidence?: number;
  };
}

interface IntelFeedResponse {
  mode?: "live" | "fallback";
  chat?: IntelChatEntry[];
}

function normalizeReliability(value: IntelChatEntry["reliability"]) {
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

export default function LiveChatFeed({
  category,
  question,
  marketId,
}: {
  category: string;
  question: string;
  marketId?: number;
}) {
  const fallbackPool = useMemo(() => getPool(category), [category]);
  const [livePool, setLivePool] = useState<ChatMessage[]>(fallbackPool);
  const pool = useMemo(
    () => (livePool.length > 0 ? livePool : fallbackPool),
    [livePool, fallbackPool]
  );
  const [messages, setMessages] = useState<VisibleMessage[]>([]);
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
          category,
          limit: "8",
        });
        if (typeof marketId === "number") {
          params.set("marketId", String(marketId));
        }
        const response = await fetch(`/api/intel/feed?${params.toString()}`, {
          cache: "no-store",
        });
        if (!response.ok) return;
        const payload = (await response.json()) as IntelFeedResponse;
        const chat = Array.isArray(payload.chat) ? payload.chat : [];
        if (chat.length === 0) return;

        const mapped: ChatMessage[] = [];
        for (const entry of chat) {
          const name = (entry.actor ?? "").trim();
          const message = (entry.message ?? "").trim();
          if (!name || !message) continue;
          mapped.push({
            name,
            message,
            avatar: entry.color ?? "#3b82f6",
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
        // Keep graceful fallback pool when live intel is unavailable.
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
  }, [question, category, marketId]);

  // Phase 1: Stream initial messages in one by one
  useEffect(() => {
    if (pool.length === 0) return;
    let cancelled = false;
    const initialCount = 4;
    let currentIdx = 0;
    setMessages([]);
    setNextIdx(0);
    idCounter.current = 0;

    function addNext() {
      if (cancelled || currentIdx >= initialCount) return;
      const msg = pool[currentIdx % pool.length];
      if (!msg) return;
      const id = ++idCounter.current;
      setMessages(prev => [...prev, { ...msg, id, isTyping: true, displayedChars: 0 }]);
      currentIdx++;
      setNextIdx(currentIdx);
      // Stagger: next message after current one finishes "typing"
      const typeDuration = msg.message.length * 18 + 400;
      setTimeout(addNext, typeDuration);
    }

    // Start after a short delay
    const t = setTimeout(addNext, 600);
    return () => { cancelled = true; clearTimeout(t); };
  }, [pool]);

  // Phase 2: Continue adding new messages periodically
  useEffect(() => {
    if (nextIdx < 4) return; // Wait for initial phase to complete
    if (pool.length === 0) return;
    const interval = setInterval(() => {
      const msg = pool[nextIdx % pool.length];
      if (!msg) return;
      const id = ++idCounter.current;
      setMessages(prev => {
        const next = [...prev, { ...msg, id, isTyping: true, displayedChars: 0 }];
        // Keep max 8 messages visible
        if (next.length > 8) return next.slice(next.length - 8);
        return next;
      });
      setNextIdx(prev => prev + 1);
    }, 4000 + Math.random() * 3000);
    return () => clearInterval(interval);
  }, [nextIdx, pool]);

  // Typing animation — reveal characters progressively
  const hasTyping = messages.some(m => m.isTyping);
  useEffect(() => {
    if (!hasTyping) return;

    const interval = setInterval(() => {
      setMessages(prev => prev.map(m => {
        if (!m.isTyping) return m;
        const next = m.displayedChars + 2; // 2 chars per tick
        if (next >= m.message.length) {
          return { ...m, isTyping: false, displayedChars: m.message.length };
        }
        return { ...m, displayedChars: next };
      }));
    }, 18);

    return () => clearInterval(interval);
  }, [hasTyping]);

  // Auto-scroll to bottom when new messages appear
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messages.length]);

  return (
    <div className="h-full flex flex-col">
      {/* Messages — grows to fill all available height */}
      <div
        ref={containerRef}
        className="space-y-2.5 flex-1 min-h-0 overflow-y-auto hide-scrollbar scroll-smooth"
      >
        {messages.map((msg) => (
          <div
            key={msg.id}
            className="flex items-start gap-2.5 group/msg animate-chat-slide-in"
          >
            {/* Avatar with pulse on typing */}
            <div
              className={`w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold text-white/90 transition-all ${msg.isTyping ? "scale-110 ring-2 ring-white/10" : ""}`}
              style={{ background: msg.avatar }}
            >
              {msg.name.charAt(0)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-heading font-semibold text-white/60">
                  {msg.name}
                </span>
                {msg.isTyping && (
                  <span className="flex items-center gap-0.5">
                    <span className="w-1 h-1 rounded-full bg-neo-brand animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-1 h-1 rounded-full bg-neo-brand animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-1 h-1 rounded-full bg-neo-brand animate-bounce" style={{ animationDelay: "300ms" }} />
                  </span>
                )}
                <span className="text-[9px] text-white/15 font-mono ml-auto">
                  {msg.timeAgo ?? "just now"}
                </span>
              </div>
              {msg.reliability && (
                <div className="mt-0.5 inline-flex items-center gap-1 rounded border border-cyan-300/25 bg-cyan-400/10 px-1.5 py-[2px] text-[9px] font-mono text-cyan-100/90">
                  <span>{msg.reliability.label}</span>
                  <span className="text-cyan-100/75">
                    R{Math.round(msg.reliability.reliabilityScore * 100)}
                  </span>
                  <span className="text-cyan-100/75">
                    B{Math.round(msg.reliability.backtestConfidence * 100)}
                  </span>
                </div>
              )}
              <p className="text-[12px] text-white/40 leading-relaxed mt-0.5 group-hover/msg:text-white/60 transition-colors">
                {msg.message.slice(0, msg.displayedChars)}
                {msg.isTyping && (
                  <span className="inline-block w-[2px] h-[12px] bg-neo-brand/60 ml-0.5 animate-cursor-blink align-middle" />
                )}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Live indicator — pinned to bottom */}
      <div className="shrink-0 flex items-center justify-center gap-1.5 pt-2 border-t border-white/[0.04]">
        <span className="relative w-1.5 h-1.5 rounded-full bg-neo-green">
          <span className="absolute inset-0 rounded-full bg-neo-green animate-ping opacity-75" />
        </span>
        <span className="text-[10px] font-heading font-medium text-white/25 tracking-wider uppercase">Live Agent Feed</span>
      </div>
    </div>
  );
}

export { getPool as getAgentChat, type ChatMessage };
