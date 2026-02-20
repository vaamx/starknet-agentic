"use client";

import { useEffect, useMemo, useState } from "react";

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

export default function OpenClawConnections() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [statuses, setStatuses] = useState<Record<string, ConnectionStatus>>({});
  const [input, setInput] = useState("");
  const [label, setLabel] = useState("");

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
    const updated = connections.filter((c) => c.id !== id);
    saveConnections(updated);
    setStatuses((prev) => {
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

  return (
    <div className="neo-card overflow-hidden">
      <div className="px-4 py-3 border-b border-white/10 bg-white/5">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-heading font-bold text-sm">OpenClaw Connections</p>
            <p className="text-[11px] text-white/50">
              Connect external agents via A2A agent cards.
            </p>
          </div>
          <button
            onClick={refreshAll}
            className="text-[10px] font-mono text-white/50 hover:text-white"
          >
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
                      <span className={`text-[10px] font-mono ${statusColor}`}>
                        {status?.state === "online"
                          ? "ONLINE"
                          : status?.state === "error"
                            ? "ERROR"
                            : status?.state === "loading"
                              ? "PING"
                              : "IDLE"}
                      </span>
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
