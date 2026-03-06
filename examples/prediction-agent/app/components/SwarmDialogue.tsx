"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getAgentVoiceByName } from "@/lib/agent-voices";

interface SwarmDialogueProps {
  isLoopRunning?: boolean;
}

type Stance = {
  agentId: string;
  agentName: string;
  probability: number;
  question?: string;
  reasoning?: string;
  timestamp: number;
  marketId?: number;
};

type DebateEntry = {
  id: string;
  from: string;
  to?: string;
  message: string;
  question?: string;
  timestamp: number;
  marketId?: number;
};

type ActivityPrediction = {
  id: string;
  actor: string;
  type: string;
  probability?: number;
  marketId?: number;
  question?: string;
  detail?: string;
  timestamp: number;
};

export default function SwarmDialogue({ isLoopRunning }: SwarmDialogueProps) {
  const [stances, setStances] = useState<Record<string, Stance>>({});
  const [debates, setDebates] = useState<DebateEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource("/api/agent-loop/stream");
    eventSourceRef.current = es;

    es.onopen = () => setConnected(true);

    es.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (parsed.eventType !== "action") return;

        if (parsed.type === "prediction" && parsed.agentId && typeof parsed.probability === "number") {
          setStances((prev) => ({
            ...prev,
            [parsed.agentId]: {
              agentId: parsed.agentId,
              agentName: parsed.agentName ?? parsed.agentId,
              probability: parsed.probability,
              question: parsed.question,
              reasoning: parsed.reasoning,
              timestamp: parsed.timestamp ?? Date.now(),
              marketId: parsed.marketId,
            },
          }));
        }

        if (parsed.type === "debate") {
          setDebates((prev) =>
            [
              {
                id: parsed.id ?? `${parsed.agentId}_${Date.now()}`,
                from: parsed.agentName ?? parsed.agentId ?? "Agent",
                to: parsed.debateTarget,
                message: parsed.detail ?? "",
                question: parsed.question,
                timestamp: parsed.timestamp ?? Date.now(),
                marketId: parsed.marketId,
              },
              ...prev,
            ].slice(0, 12)
          );
        }
      } catch {
        // ignore malformed
      }
    };

    es.onerror = () => setConnected(false);

    return () => {
      es.close();
      eventSourceRef.current = null;
      setConnected(false);
    };
  }, []);

  useEffect(() => {
    fetch("/api/activity?limit=80")
      .then((res) => res.json())
      .then((payload) => {
        const activities = Array.isArray(payload.activities)
          ? (payload.activities as ActivityPrediction[])
          : [];

        const predictionActions = activities.filter(
          (item) =>
            item.type === "prediction" &&
            typeof item.probability === "number" &&
            typeof item.marketId === "number"
        );

        const stancesFromHistory: Record<string, Stance> = {};
        for (const action of predictionActions.slice(0, 20)) {
          const agentId = action.actor;
          if (!agentId || stancesFromHistory[agentId]) continue;
          stancesFromHistory[agentId] = {
            agentId,
            agentName: action.actor,
            probability: action.probability ?? 0.5,
            question: action.question,
            reasoning: action.detail,
            timestamp: action.timestamp,
            marketId: action.marketId,
          };
        }
        if (Object.keys(stancesFromHistory).length > 0) {
          setStances((prev) => ({ ...stancesFromHistory, ...prev }));
        }

        const byMarket = new Map<number, ActivityPrediction[]>();
        for (const action of predictionActions) {
          const marketId = action.marketId as number;
          const current = byMarket.get(marketId) ?? [];
          current.push(action);
          byMarket.set(marketId, current);
        }

        const syntheticDebates: DebateEntry[] = [];
        for (const [marketId, entries] of byMarket) {
          if (entries.length < 2) continue;
          const sorted = [...entries].sort((a, b) => b.timestamp - a.timestamp);
          const lead = sorted[0];
          const challenger = sorted.find(
            (candidate) =>
              candidate.actor !== lead.actor &&
              typeof candidate.probability === "number" &&
              Math.abs((candidate.probability ?? 0.5) - (lead.probability ?? 0.5)) >=
                0.15
          );
          if (!challenger) continue;
          const leadPct = Math.round((lead.probability ?? 0.5) * 100);
          const challengerPct = Math.round((challenger.probability ?? 0.5) * 100);
          syntheticDebates.push({
            id: `synthetic-${marketId}`,
            from: challenger.actor,
            to: lead.actor,
            message: `Forecast divergence on market #${marketId}: ${challenger.actor} at ${challengerPct}% vs ${lead.actor} at ${leadPct}%.`,
            question: lead.question ?? challenger.question,
            timestamp: Math.max(lead.timestamp, challenger.timestamp),
            marketId,
          });
        }

        if (syntheticDebates.length > 0) {
          setDebates((prev) => {
            const existing = new Set(prev.map((item) => item.id));
            const merged = [
              ...syntheticDebates.filter((item) => !existing.has(item.id)),
              ...prev,
            ];
            return merged
              .sort((a, b) => b.timestamp - a.timestamp)
              .slice(0, 12);
          });
        }
      })
      .catch(() => {});
  }, []);

  const stanceEntries = useMemo(
    () =>
      Object.values(stances)
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 5),
    [stances]
  );

  return (
    <div className="neo-card overflow-hidden">
      <div className="px-4 py-3 border-b border-white/[0.08] bg-white/[0.03]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-neo-orange/10 border border-neo-orange/20 flex items-center justify-center">
              <svg className="w-3 h-3 text-neo-orange" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
              </svg>
            </div>
            <div>
              <p className="font-heading font-bold text-sm text-white">Live Debate Feed</p>
              <p className="text-[10px] text-white/40">
                Agents challenge each other in real time
              </p>
            </div>
          </div>
          {connected ? (
            <span className="inline-flex items-center gap-1 text-[9px] font-mono font-bold text-neo-green bg-neo-green/10 px-2 py-0.5 border border-neo-green/20 rounded-md">
              <span className="w-1 h-1 rounded-full bg-neo-green animate-pulse" />
              LIVE
            </span>
          ) : (
            <span className="text-[10px] font-mono text-white/30">OFF</span>
          )}
        </div>
      </div>

      <div className="p-4 space-y-3">
        {!connected && !isLoopRunning && (
          <div className="text-[11px] text-white/40">
            Autonomous mode is off. Run a tick to generate debate.
          </div>
        )}

        {stanceEntries.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {stanceEntries.map((stance) => {
              const voice = getAgentVoiceByName(stance.agentName);
              return (
              <div
                key={stance.agentId}
                className="px-2 py-1 rounded-full border border-white/10 bg-white/[0.04] text-[10px] font-mono text-white/70"
                title={voice?.signature}
              >
                <span className={voice?.colorClass ?? "text-white/70"}>
                  {stance.agentName}
                </span>
                : {Math.round(stance.probability * 100)}%
              </div>
              );
            })}
          </div>
        )}

        {debates.length === 0 ? (
          <div className="text-[11px] text-white/40">
            No debate exchanges yet. Debates appear after conflicting predictions
            from multiple agents on the same market.
          </div>
        ) : (
          <div className="space-y-2">
            {debates.map((debate) => {
              const voice = getAgentVoiceByName(debate.from);
              return (
              <div
                key={debate.id}
                className="border border-white/10 rounded-lg p-3 bg-white/[0.03]"
              >
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-mono text-white/80">
                    <span className={voice?.colorClass ?? "text-white/80"}>
                      {debate.from}
                    </span>
                    {voice && (
                      <span className="text-[10px] text-white/40 ml-1">
                        {voice.signature}
                      </span>
                    )}
                    {debate.to && (
                      <span className="text-white/40"> → {debate.to}</span>
                    )}
                  </div>
                  <div className="text-[9px] text-white/30">
                    {timeAgo(debate.timestamp)}
                  </div>
                </div>
                {debate.question && (
                  <div className="text-[10px] text-white/40 mt-1 line-clamp-2">
                    {debate.question}
                  </div>
                )}
                <div className="text-[11px] text-white/70 mt-2 leading-snug">
                  {debate.message}
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
