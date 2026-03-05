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
  txHash?: string;
  timestamp: number;
}

const TYPE_COLORS: Record<string, string> = {
  bet: "text-neo-yellow",
  prediction: "text-neo-green",
  resolution: "text-neo-orange",
  market_creation: "text-neo-purple",
  defi_swap: "text-neo-blue",
  debate: "text-neo-orange",
};

const TYPE_ICONS: Record<string, string> = {
  bet: "BET",
  prediction: "PRED",
  resolution: "RES",
  market_creation: "NEW",
  defi_swap: "SWAP",
  debate: "DBT",
};

interface CompactActivityTickerProps {
  isLoopRunning?: boolean;
  onViewAll?: () => void;
}

export default function CompactActivityTicker({
  isLoopRunning = false,
  onViewAll,
}: CompactActivityTickerProps) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Poll initial data
  useEffect(() => {
    fetch("/api/activity?limit=8")
      .then((r) => r.json())
      .then((data) => {
        if (data.activities) {
          setActivities(data.activities as Activity[]);
        }
      })
      .catch(() => {});
  }, []);

  // SSE connection
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
        if (parsed.agentId && parsed.type) {
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
            txHash: parsed.txHash,
            timestamp: parsed.timestamp,
          };
          setActivities((prev) => {
            if (prev.some((item) => item.id === activity.id)) return prev;
            return [activity, ...prev].slice(0, 8);
          });
        }
      } catch {
        // skip
      }
    };

    es.onerror = () => setIsConnected(false);

    return () => {
      es.close();
      eventSourceRef.current = null;
      setIsConnected(false);
    };
  }, [isLoopRunning]);

  function timeAgo(ts: number): string {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60) return `${diff}s`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    return `${Math.floor(diff / 86400)}d`;
  }

  return (
    <div className="neo-card overflow-hidden">
      <div className="px-4 py-2.5 border-b border-white/[0.07] bg-white/[0.03] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              isConnected ? "bg-neo-green animate-pulse" : "bg-white/30"
            }`}
          />
          <h3 className="font-heading font-bold text-xs text-white">Activity</h3>
          {isConnected && (
            <span className="text-[10px] font-mono text-neo-green/70">LIVE</span>
          )}
        </div>
        {onViewAll && (
          <button
            type="button"
            onClick={onViewAll}
            className="text-xs text-neo-brand hover:underline"
          >
            View All
          </button>
        )}
      </div>

      <div className="divide-y divide-white/[0.04]">
        {activities.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-white/40">
            No activity yet
          </div>
        ) : (
          activities.slice(0, 8).map((a) => (
            <div
              key={a.id}
              className="flex items-center gap-2 px-4 py-2 text-xs animate-enter"
            >
              <span className="text-[10px] font-mono text-white/30 w-6 shrink-0 tabular-nums">
                {timeAgo(a.timestamp)}
              </span>
              <span
                className={`text-[10px] font-bold w-8 shrink-0 ${
                  TYPE_COLORS[a.type] ?? "text-white/40"
                }`}
              >
                {TYPE_ICONS[a.type] ?? a.type.slice(0, 4).toUpperCase()}
              </span>
              {a.isAgent && (
                <span className="w-3.5 h-3.5 bg-neo-purple/60 text-white text-[7px] font-bold flex items-center justify-center rounded-sm shrink-0">
                  AI
                </span>
              )}
              <span className="text-white/70 truncate flex-1 min-w-0">
                <span className="font-medium">{a.actor.slice(0, 12)}</span>
                {a.outcome && (
                  <span
                    className={`ml-1 font-bold ${
                      a.outcome === "YES" ? "text-neo-green" : "text-neo-red"
                    }`}
                  >
                    {a.outcome}
                  </span>
                )}
                {a.amount && (
                  <span className="ml-1 text-white/40 font-mono">{a.amount}</span>
                )}
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
            </div>
          ))
        )}
      </div>
    </div>
  );
}
