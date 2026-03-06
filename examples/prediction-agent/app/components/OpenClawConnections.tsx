"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Connection = {
  id: string;
  url: string;
  label?: string;
  addedAt: number;
};

type ConnectionStatus = {
  state: "idle" | "loading" | "online" | "error";
  card?: any;
  error?: string;
  checkedAt?: number;
};

const STORAGE_KEY = "openclaw-connections-v1";

type DelegateState = {
  isOpen: boolean;
  question: string;
  streaming: boolean;
  events: { type: string; content: string }[];
  probability: number | null;
};

export default function OpenClawConnections() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [statuses, setStatuses] = useState<Record<string, ConnectionStatus>>({});
  const [input, setInput] = useState("");
  const [label, setLabel] = useState("");
  const [delegates, setDelegates] = useState<Record<string, DelegateState>>({});
  const abortRefs = useRef<Record<string, AbortController>>({});

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Connection[];
        setConnections(parsed);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (connections.length === 0) return;
    refreshAll();
  }, [connections]);

  const saveConnections = (next: Connection[]) => {
    setConnections(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const normalized = useMemo(() => normalizeUrl(input), [input]);

  const addConnection = () => {
    if (!normalized) return;
    const next: Connection = {
      id: `conn_${Date.now()}`,
      url: normalized,
      label: label.trim() || undefined,
      addedAt: Date.now(),
    };
    const updated = [next, ...connections].slice(0, 12);
    saveConnections(updated);
    setInput("");
    setLabel("");
  };

  const removeConnection = (id: string) => {
    // Abort any in-flight forecast stream for this connection before removing.
    abortRefs.current[id]?.abort();
    delete abortRefs.current[id];

    const updated = connections.filter((c) => c.id !== id);
    saveConnections(updated);
    setStatuses((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setDelegates((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const refreshOne = async (conn: Connection) => {
    setStatuses((prev) => ({
      ...prev,
      [conn.id]: { state: "loading" },
    }));
    try {
      const res = await fetch(conn.url, { method: "GET" });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const card = await res.json();
      setStatuses((prev) => ({
        ...prev,
        [conn.id]: { state: "online", card, checkedAt: Date.now() },
      }));
    } catch (err: any) {
      setStatuses((prev) => ({
        ...prev,
        [conn.id]: {
          state: "error",
          error: err?.message || "Connection failed",
          checkedAt: Date.now(),
        },
      }));
    }
  };

  const refreshAll = () => {
    connections.forEach((conn) => {
      refreshOne(conn);
    });
  };

  const openDelegate = (connId: string) => {
    setDelegates((prev) => ({
      ...prev,
      [connId]: { isOpen: true, question: "", streaming: false, events: [], probability: null },
    }));
  };

  const closeDelegate = (connId: string) => {
    abortRefs.current[connId]?.abort();
    setDelegates((prev) => ({ ...prev, [connId]: { isOpen: false, question: "", streaming: false, events: [], probability: null } }));
  };

  const requestForecast = async (conn: Connection) => {
    const state = delegates[conn.id];
    if (!state || !state.question.trim()) return;

    const abort = new AbortController();
    abortRefs.current[conn.id] = abort;

    setDelegates((prev) => ({
      ...prev,
      [conn.id]: { ...prev[conn.id], streaming: true, events: [], probability: null },
    }));

    try {
      const res = await fetch("/api/openclaw/delegate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentCardUrl: conn.url, question: state.question.trim() }),
        signal: abort.signal,
      });

      if (!res.ok) {
        let errorMessage = `HTTP ${res.status}`;
        try {
          const data = await res.json();
          if (typeof data?.error === "string") {
            errorMessage = data.error;
          }
        } catch {
          // Ignore JSON parsing issues.
        }
        throw new Error(errorMessage);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No stream");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") break;
          try {
            const event = JSON.parse(raw);
            const displayContent =
              event.type === "text" ? event.content ?? ""
              : event.type === "tool_call" ? `[${event.toolName}] ${JSON.stringify(event.input ?? {})}`
              : event.type === "tool_result" ? `→ ${String(event.result ?? "").slice(0, 80)}`
              : event.type === "result" ? `Final: ${((event.probability ?? 0) * 100).toFixed(1)}%`
              : "";

            if (displayContent) {
              setDelegates((prev) => ({
                ...prev,
                [conn.id]: {
                  ...prev[conn.id],
                  events: [...(prev[conn.id]?.events ?? []), { type: event.type, content: displayContent }],
                  probability: event.type === "result" ? event.probability : prev[conn.id]?.probability ?? null,
                },
              }));
            }
          } catch {
            // ignore malformed events
          }
        }
      }
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        setDelegates((prev) => ({
          ...prev,
          [conn.id]: {
            ...prev[conn.id],
            events: [...(prev[conn.id]?.events ?? []), { type: "error", content: err?.message ?? "Request failed" }],
          },
        }));
      }
    } finally {
      setDelegates((prev) => ({
        ...prev,
        [conn.id]: { ...prev[conn.id], streaming: false },
      }));
    }
  };

  return (
    <div className="neo-card overflow-hidden">
      <div className="px-4 py-3 border-b border-white/[0.08] bg-white/[0.03]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-neo-blue/10 border border-neo-blue/20 flex items-center justify-center">
              <svg className="w-3 h-3 text-neo-blue" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-2.556a4.5 4.5 0 00-1.242-7.244l-4.5-4.5a4.5 4.5 0 00-6.364 6.364L4.25 8.006" />
              </svg>
            </div>
            <div>
              <p className="font-heading font-bold text-sm text-white">OpenClaw</p>
              <p className="text-[10px] text-white/40">
                A2A agent connections
              </p>
            </div>
          </div>
          <button
            onClick={refreshAll}
            className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded-md border border-white/[0.1] text-white/50 hover:text-white hover:border-white/20 transition-colors"
          >
            <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      <div className="p-4 space-y-3">
        <div className="grid gap-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Connection label (optional)"
            className="neo-input"
          />
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="https://agent.example/.well-known/agent-card.json"
              className="neo-input flex-1"
            />
            <button
              onClick={addConnection}
              disabled={!normalized}
              className="neo-btn-primary px-3 disabled:opacity-40"
            >
              Add
            </button>
          </div>
          {input && !normalized && (
            <p className="text-[10px] text-neo-pink">Enter a valid URL.</p>
          )}
        </div>

        {connections.length === 0 ? (
          <div className="text-[11px] text-white/40">
            No connections yet. Paste an agent card URL to link an external agent.
          </div>
        ) : (
          <div className="space-y-2">
            {connections.map((conn) => {
              const status = statuses[conn.id];
              const card = status?.card;
              const framework = card?.framework ?? card?.identity?.framework;
              const moltbookId = card?.moltbookId ?? card?.identity?.moltbookId;
              const statusColor =
                status?.state === "online"
                  ? "text-neo-green"
                  : status?.state === "error"
                    ? "text-neo-pink"
                    : "text-white/40";

              const hasPredictSkill =
                status?.state === "online" &&
                (Array.isArray(card?.skills)
                  ? card.skills.some((s: any) => s.id === "predict" || s.id === "openclaw-forecast")
                  : true); // assume predict capability if card has no skills array

              const delegate = delegates[conn.id];

              return (
                <div
                  key={conn.id}
                  className="border border-white/10 rounded-lg p-3 bg-white/[0.03]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-[11px] text-white/70 truncate">
                        {card?.name || conn.label || conn.url}
                      </p>
                      <p className="text-[10px] text-white/40 truncate">
                        {conn.url}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-md border ${
                        status?.state === "online"
                          ? "bg-neo-green/10 text-neo-green border-neo-green/20"
                          : status?.state === "error"
                            ? "bg-neo-pink/10 text-neo-pink border-neo-pink/20"
                            : status?.state === "loading"
                              ? "bg-neo-yellow/10 text-neo-yellow border-neo-yellow/20"
                              : "bg-white/[0.04] text-white/40 border-white/[0.08]"
                      }`}>
                        <span className={`w-1 h-1 rounded-full ${
                          status?.state === "online" ? "bg-neo-green"
                            : status?.state === "error" ? "bg-neo-pink"
                            : status?.state === "loading" ? "bg-neo-yellow animate-pulse"
                            : "bg-white/25"
                        }`} />
                        {status?.state === "online"
                          ? "ONLINE"
                          : status?.state === "error"
                            ? "ERROR"
                            : status?.state === "loading"
                              ? "PING"
                              : "IDLE"}
                      </span>
                      {hasPredictSkill && !delegate?.isOpen && (
                        <button
                          onClick={() => openDelegate(conn.id)}
                          className="text-[10px] text-neo-green/80 hover:text-neo-green"
                        >
                          Request Forecast
                        </button>
                      )}
                      <a
                        href={conn.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-neo-blue/70 hover:text-neo-blue"
                      >
                        Open
                      </a>
                      <button
                        onClick={() => removeConnection(conn.id)}
                        className="text-[10px] text-white/40 hover:text-white"
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  {card && (
                    <div className="mt-2 space-y-1">
                      {card.description && (
                        <p className="text-[11px] text-white/60 line-clamp-2">
                          {card.description}
                        </p>
                      )}
                      {(framework || moltbookId) && (
                        <div className="text-[10px] text-white/40">
                          {framework && <span>Framework: {framework}</span>}
                          {framework && moltbookId && <span> · </span>}
                          {moltbookId && <span>MoltBook: {moltbookId}</span>}
                        </div>
                      )}
                      {Array.isArray(card.skills) && card.skills.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {card.skills.slice(0, 4).map((skill: any) => (
                            <span
                              key={skill.id}
                              className="text-[9px] uppercase tracking-wider px-2 py-0.5 rounded-full border border-white/10 text-white/50"
                            >
                              {skill.name || skill.id}
                            </span>
                          ))}
                        </div>
                      )}
                      {Array.isArray(card.protocols) && (
                        <div className="text-[10px] text-white/40">
                          Protocols: {card.protocols.join(", ")}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Delegate forecast panel */}
                  {delegate?.isOpen && (
                    <div className="mt-3 border-t border-white/10 pt-3 space-y-2">
                      <p className="text-[10px] text-white/50 font-mono">Request forecast from {card?.name ?? conn.url}</p>
                      <div className="flex gap-2">
                        <input
                          value={delegate.question}
                          onChange={(e) =>
                            setDelegates((prev) => ({
                              ...prev,
                              [conn.id]: { ...prev[conn.id], question: e.target.value },
                            }))
                          }
                          placeholder="Enter prediction question..."
                          className="neo-input flex-1 text-[11px]"
                          disabled={delegate.streaming}
                        />
                        <button
                          onClick={() => requestForecast(conn)}
                          disabled={delegate.streaming || !delegate.question.trim()}
                          className="neo-btn-primary px-3 text-[10px] disabled:opacity-40"
                        >
                          {delegate.streaming ? "..." : "Ask"}
                        </button>
                        <button
                          onClick={() => closeDelegate(conn.id)}
                          className="text-[10px] text-white/40 hover:text-white"
                        >
                          Close
                        </button>
                      </div>

                      {delegate.events.length > 0 && (
                        <div className="bg-black/30 rounded p-2 max-h-40 overflow-y-auto space-y-0.5">
                          {delegate.events.map((ev, i) => (
                            <p
                              key={i}
                              className={`text-[10px] font-mono ${
                                ev.type === "error"
                                  ? "text-neo-pink"
                                  : ev.type === "tool_call"
                                    ? "text-neo-blue/70"
                                    : ev.type === "tool_result"
                                      ? "text-white/40"
                                      : ev.type === "result"
                                        ? "text-neo-green font-bold"
                                        : "text-white/70"
                              }`}
                            >
                              {ev.content}
                            </p>
                          ))}
                        </div>
                      )}

                      {delegate.probability !== null && (
                        <div className="text-[11px] font-mono text-neo-green">
                          Forecast: {(delegate.probability * 100).toFixed(1)}% YES
                        </div>
                      )}
                    </div>
                  )}

                  {status?.error && (
                    <p className="text-[10px] text-neo-pink mt-1">
                      {status.error}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function normalizeUrl(input: string): string | null {
  let trimmed = input.trim();
  if (!trimmed) return null;
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `https://${trimmed}`;
  }
  try {
    const url = new URL(trimmed);
    if (url.pathname.endsWith("agent-card.json") || url.pathname.endsWith("agent.json")) {
      return url.toString();
    }
    return `${url.origin}/.well-known/agent-card.json`;
  } catch {
    return null;
  }
}
