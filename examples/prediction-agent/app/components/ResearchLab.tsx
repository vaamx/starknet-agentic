"use client";

import { useMemo, useState } from "react";
import DataSourcesPanel from "./DataSourcesPanel";

const SOURCE_OPTIONS = [
  { id: "polymarket", label: "Polymarket", hint: "Market odds" },
  { id: "coingecko", label: "CoinGecko", hint: "Crypto prices" },
  { id: "news", label: "News", hint: "Headlines" },
  { id: "web", label: "Web", hint: "General search" },
  { id: "social", label: "Social", hint: "Sentiment" },
  { id: "espn", label: "ESPN", hint: "Sports data" },
  { id: "github", label: "GitHub", hint: "Dev activity" },
  { id: "onchain", label: "On-chain", hint: "Starknet pulse" },
  { id: "rss", label: "RSS", hint: "Configured feeds" },
  { id: "x", label: "X", hint: "Social chatter" },
  { id: "telegram", label: "Telegram", hint: "Channel updates" },
];

export default function ResearchLab() {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [sources, setSources] = useState<string[]>([
    "polymarket",
    "coingecko",
    "news",
    "social",
    "github",
    "onchain",
  ]);
  const [lastRun, setLastRun] = useState<number | null>(null);

  const sourceSet = useMemo(() => new Set(sources), [sources]);

  const toggleSource = (id: string) => {
    setSources((prev) => {
      if (prev.includes(id)) {
        const next = prev.filter((s) => s !== id);
        return next.length === 0 ? prev : next;
      }
      return [...prev, id];
    });
  };

  const runResearch = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    setQuery(trimmed);
    setLastRun(Date.now());
  };

  const clearResearch = () => {
    setInput("");
    setQuery("");
    setLastRun(null);
  };

  return (
    <div className="neo-card overflow-hidden">
      <div className="px-4 py-3 border-b border-white/10 bg-white/5">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-heading font-bold text-sm">Research Lab</p>
            <p className="text-[11px] text-white/50">
              Pull live signals before you forecast or bet.
            </p>
          </div>
          {lastRun && (
            <span className="text-[10px] font-mono text-white/40">
              Last run {timeAgo(lastRun)}
            </span>
          )}
        </div>
      </div>

      <div className="p-4 space-y-3">
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-widest text-white/40 mb-2">
            Question
          </label>
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  runResearch();
                }
              }}
              placeholder="e.g. Will ETH break $5k this quarter?"
              className="neo-input flex-1"
            />
            <button
              onClick={runResearch}
              disabled={!input.trim()}
              className="neo-btn-primary px-4 disabled:opacity-40"
            >
              Run
            </button>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-white/40">
              Sources
            </span>
            <button
              onClick={clearResearch}
              className="text-[10px] text-white/40 hover:text-white/70"
            >
              Clear
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {SOURCE_OPTIONS.map((source) => {
              const active = sourceSet.has(source.id);
              return (
                <button
                  key={source.id}
                  onClick={() => toggleSource(source.id)}
                  className={`px-2.5 py-1 rounded-full text-[10px] font-mono border transition-colors ${
                    active
                      ? "border-neo-green/60 text-neo-green bg-neo-green/10"
                      : "border-white/10 text-white/50 hover:text-white/70"
                  }`}
                >
                  {source.label}
                  <span className="ml-1 text-[9px] text-white/30">{source.hint}</span>
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-white/30 mt-2">
            Sources return empty when API keys are missing or rate-limited.
          </p>
        </div>
      </div>

      {query && (
        <div className="border-t border-white/10">
          <DataSourcesPanel
            question={query}
            sources={sources}
            defaultCollapsed={false}
            embedded
          />
        </div>
      )}
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
