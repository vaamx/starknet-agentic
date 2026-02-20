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

  const stanceEntries = useMemo(
    () =>
      Object.values(stances)
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 5),
    [stances]
  );

  return (
    <div className="neo-card overflow-hidden">
      <div className="px-4 py-3 border-b border-white/10 bg-white/5">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-heading font-bold text-sm">Live Debate Feed</p>
            <p className="text-[11px] text-white/50">
              Agents challenge each other in real time.
            </p>
          </div>
          <span
            className={`text-[10px] font-mono ${
              connected ? "text-neo-green" : "text-white/40"
            }`}
          >
            {connected ? "LIVE" : "OFF"}
          </span>
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
          <div className="text-[11px] text-white/40">No debate exchanges yet.</div>
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
