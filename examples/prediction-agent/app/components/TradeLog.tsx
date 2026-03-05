"use client";

import { useState, useEffect, useRef } from "react";

interface Activity {
  id: string;
  type: string;
  actor: string;
  isAgent?: boolean;
  marketId?: number;
  question?: string;
  outcome?: string;
  amount?: string;
  probability?: number;
  detail?: string;
  debateTarget?: string;
  txHash?: string;
  reasoningHash?: string;
  timestamp: number;
}

interface TradeLogProps {
  isLoopRunning?: boolean;
}

function normalizeActivityText(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function activityFingerprint(activity: Activity): string {
  const probability =
    typeof activity.probability === "number"
      ? activity.probability.toFixed(3)
      : "";
  return [
    activity.type,
    activity.actor.toLowerCase(),
    activity.marketId ?? "",
    activity.outcome ?? "",
    activity.amount ?? "",
    probability,
    normalizeActivityText(activity.question),
    normalizeActivityText(activity.detail).slice(0, 160),
    normalizeActivityText(activity.debateTarget),
  ].join("|");
}

const TYPE_COLORS: Record<string, string> = {
  bet: "text-neo-yellow",
  prediction: "text-neo-green",
  resolution: "text-neo-orange",
  market_creation: "text-neo-purple",
  defi_swap: "text-neo-blue",
  debate: "text-neo-orange",
};

const TYPE_LABELS: Record<string, string> = {
  bet: "BET",
  prediction: "PRED",
  resolution: "RES",
  market_creation: "GENESIS",
  defi_swap: "SWAP",
  debate: "DEBATE",
};

export default function TradeLog({ isLoopRunning = false }: TradeLogProps) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Poll /api/activity on mount and every 30s
  useEffect(() => {
    const fetchActivities = () => {
      fetch("/api/activity?limit=30")
        .then((r) => r.json())
        .then((data) => {
          if (data.activities) {
            setActivities((prev) => {
              const existingIds = new Set(prev.map((a) => a.id));
              const existingFingerprints = new Set(
                prev.map((a) => activityFingerprint(a))
              );
              const seenIncoming = new Set<string>();
              const newOnes = (data.activities as Activity[]).filter((a) => {
                if (existingIds.has(a.id)) return false;
                const fingerprint = activityFingerprint(a);
                if (existingFingerprints.has(fingerprint)) return false;
                if (seenIncoming.has(fingerprint)) return false;
                seenIncoming.add(fingerprint);
                return true;
              });
              if (newOnes.length === 0) return prev;
              return [...newOnes, ...prev].slice(0, 100);
            });
          }
        })
        .catch(() => {});
    };

    fetchActivities();
    const interval = setInterval(fetchActivities, 30_000);
    return () => clearInterval(interval);
  }, []);

  // SSE connection when autonomous mode is on
  useEffect(() => {
    if (!isLoopRunning) {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
        setIsConnected(false);
      }
      return;
    }

    const es = new EventSource("/api/agent-loop/stream");
    eventSourceRef.current = es;

    es.onopen = () => setIsConnected(true);

    es.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (
          parsed.agentId &&
          (parsed.type === "bet" ||
            parsed.type === "prediction" ||
            parsed.type === "resolution" ||
            parsed.type === "market_creation" ||
            parsed.type === "defi_swap" ||
            parsed.type === "debate")
        ) {
          const activity: Activity = {
            id: parsed.id,
            type: parsed.type,
            actor: parsed.agentName,
            isAgent: true,
            marketId: parsed.marketId,
            question: parsed.question,
            outcome: parsed.betOutcome ?? parsed.resolutionOutcome,
            amount: parsed.betAmount,
            probability: parsed.probability,
            detail: parsed.detail,
            debateTarget: parsed.debateTarget,
            txHash: parsed.txHash,
            reasoningHash: parsed.reasoningHash,
            timestamp: parsed.timestamp,
          };
          setActivities((prev) => {
            const fingerprint = activityFingerprint(activity);
            if (
              prev.some(
                (item) =>
                  item.id === activity.id ||
                  activityFingerprint(item) === fingerprint
              )
            ) {
              return prev;
            }
            return [activity, ...prev].slice(0, 100);
          });
        }
      } catch {
        // Skip malformed
      }
    };

    es.onerror = () => setIsConnected(false);

    return () => {
      es.close();
      eventSourceRef.current = null;
      setIsConnected(false);
    };
  }, [isLoopRunning]);

  // Auto-scroll to top for new items
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [activities.length]);

  function timeAgo(ts: number): string {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60) return `${diff}s`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    return `${Math.floor(diff / 86400)}d`;
  }

  const hasActivities = activities.length > 0;

  return (
    <div className="neo-card overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-white/5 border-b border-white/10 hover:bg-white/10 transition-colors"
      >
        <div className="flex items-center gap-2">
          <div
            className={`w-1.5 h-1.5 rounded-full ${
              isConnected
                ? "bg-neo-green animate-pulse"
                : hasActivities
                  ? "bg-neo-yellow"
                  : "bg-white/30"
            }`}
          />
          <h3 className="font-heading font-bold text-xs">Activity Feed</h3>
          <span className="text-[9px] font-mono text-white/50 bg-white/10 px-1.5 py-0.5 border border-white/10 rounded-full">
            ON-CHAIN + AGENT
          </span>
          {isConnected && (
            <span className="text-[9px] font-mono text-neo-green bg-neo-green/10 px-1.5 py-0.5 border border-neo-green/20 rounded-full">
              LIVE
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-white/40">
            {activities.length} events
          </span>
          <svg
            className={`w-3.5 h-3.5 text-white/50 transition-transform ${isCollapsed ? "" : "rotate-180"}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {!isCollapsed && (
        <>
          {/* Ticker tape — hidden on mobile */}
          {hasActivities && (
            <div className="overflow-hidden border-b border-white/10 hidden sm:block">
              <div className="ticker-tape flex items-center gap-6 px-4 py-1.5 whitespace-nowrap">
                {activities.slice(0, 8).map((a, i) => (
                  <span key={`${a.id}-${i}`} className="flex items-center gap-1.5 text-[10px]">
                    <span className="text-white/40 font-mono">{timeAgo(a.timestamp)}</span>
                    {a.isAgent && (
                      <span className="w-3 h-3 bg-neo-purple/70 text-white text-[7px] font-black flex items-center justify-center border border-white/10 rounded-sm">
                        AI
                      </span>
                    )}
                    <span className="font-bold text-white/80">{a.actor.slice(0, 10)}</span>
                    {a.outcome && (
                      <span className={`font-black ${a.outcome === "YES" ? "text-neo-green" : "text-neo-pink"}`}>
                        {a.outcome}
                      </span>
                    )}
                    {a.amount && <span className="font-mono text-white/50">{a.amount}</span>}
                    {a.type === "market_creation" && (
                      <span className="font-black text-neo-purple">GENESIS</span>
                    )}
                    {a.type === "defi_swap" && (
                      <span className="font-black text-neo-blue">SWAP</span>
                    )}
                    {a.type === "debate" && (
                      <span className="font-black text-neo-orange">DEBATE</span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Activity list */}
          <div ref={scrollRef} className="max-h-80 overflow-y-auto">
            {!hasActivities ? (
              <div className="px-4 py-12 text-center">
                <p className="text-sm text-white/50 font-mono">
                  No on-chain activity yet — place a bet or enable autonomous mode
                </p>
              </div>
            ) : (
              <>
                {/* Desktop table */}
                <div className="hidden sm:block divide-y divide-white/10">
                  {activities.slice(0, 20).map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center gap-2 px-4 py-2 text-xs hover:bg-white/5 transition-colors"
                    >
                      <span className="font-mono text-[10px] text-white/30 w-8 shrink-0 tabular-nums">
                        {timeAgo(a.timestamp)}
                      </span>
                      <span
                        className={`text-[9px] font-black w-8 shrink-0 ${TYPE_COLORS[a.type] ?? "text-white/40"}`}
                      >
                        {TYPE_LABELS[a.type] ?? a.type.toUpperCase().slice(0, 4)}
                      </span>
                      <div className="flex items-center gap-1.5 w-24 shrink-0">
                        {a.isAgent && (
                          <span className="w-3.5 h-3.5 bg-neo-purple/70 text-white text-[7px] font-black flex items-center justify-center border border-white/10 rounded-sm">
                            AI
                          </span>
                        )}
                        <span className="font-mono text-[11px] font-medium truncate text-white/80">
                          {a.actor}
                          {a.debateTarget && (
                            <span className="text-white/40"> → {a.debateTarget}</span>
                          )}
                        </span>
                      </div>
                      {a.outcome ? (
                        <span
                          className={`font-heading font-bold text-[11px] w-8 ${
                            a.outcome === "YES" ? "text-neo-green" : "text-neo-pink"
                          }`}
                        >
                          {a.outcome}
                        </span>
                      ) : a.probability !== undefined ? (
                        <span className="font-mono text-[11px] text-neo-blue w-8">
                          {Math.round(a.probability * 100)}%
                        </span>
                      ) : (
                        <span className="w-8" />
                      )}
                      {a.amount ? (
                        <span className="font-mono text-[11px] text-right w-20 shrink-0 tabular-nums">
                          {a.amount}
                        </span>
                      ) : (
                        <span className="w-20 shrink-0" />
                      )}
                      <span className="text-[10px] text-white/50 truncate flex-1 min-w-0">
                        {a.type === "debate"
                          ? a.detail ?? a.question ?? ""
                          : a.question ?? ""}
                      </span>
                      {a.txHash && (
                        <a
                          href={`https://sepolia.voyager.online/tx/${a.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[9px] text-neo-blue/60 hover:text-neo-blue shrink-0"
                        >
                          tx
                        </a>
                      )}
                      {a.reasoningHash && (
                        <span
                          className="text-[8px] text-neo-purple/70 bg-neo-purple/10 border border-neo-purple/20 px-1 py-0.5 cursor-help shrink-0"
                          title={`Proof of reasoning: ${a.reasoningHash}`}
                        >
                          PROOF
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                {/* Mobile cards */}
                <div className="sm:hidden divide-y divide-white/10">
                  {activities.slice(0, 12).map((a) => (
                    <div key={a.id} className="px-4 py-2.5">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`text-[9px] font-black ${TYPE_COLORS[a.type] ?? "text-white/40"}`}
                          >
                            {TYPE_LABELS[a.type] ?? a.type.toUpperCase().slice(0, 4)}
                          </span>
                          {a.isAgent && (
                            <span className="w-3.5 h-3.5 bg-neo-purple/70 text-white text-[7px] font-black flex items-center justify-center border border-white/10 rounded-sm">
                              AI
                            </span>
                          )}
                          <span className="font-mono text-[11px] font-medium text-white/80">
                            {a.actor}
                            {a.debateTarget && (
                              <span className="text-white/40"> → {a.debateTarget}</span>
                            )}
                          </span>
                        </div>
                        <span className="font-mono text-[10px] text-white/30 tabular-nums">
                          {timeAgo(a.timestamp)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-white/50 truncate max-w-[60%]">
                          {a.type === "debate"
                            ? a.detail ?? a.question ?? ""
                            : a.question ?? ""}
                        </span>
                        <div className="flex items-center gap-2">
                          {a.outcome && (
                            <span
                              className={`font-heading font-bold text-[11px] ${
                                a.outcome === "YES" ? "text-neo-green" : "text-neo-pink"
                              }`}
                            >
                              {a.outcome}
                            </span>
                          )}
                          {a.amount && (
                            <span className="font-mono text-[11px] tabular-nums">
                              {a.amount}
                            </span>
                          )}
                          {a.txHash && (
                            <a
                              href={`https://sepolia.voyager.online/tx/${a.txHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[9px] text-neo-blue/60 hover:text-neo-blue"
                            >
                              tx
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
