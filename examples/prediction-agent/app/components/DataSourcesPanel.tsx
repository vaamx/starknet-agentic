"use client";

import { useState, useEffect } from "react";

interface DataPoint {
  label: string;
  value: string | number;
  url?: string;
  confidence?: number;
}

interface DataSourceResult {
  source: string;
  query: string;
  timestamp: number;
  data: DataPoint[];
  summary: string;
  quality?: {
    reliabilityScore: number;
    freshnessScore: number;
    confidenceScore: number;
    coverageScore: number;
    overallScore: number;
    latencyMs: number;
  };
  backtest?: {
    source: string;
    samples: number;
    markets: number;
    avgBrier: number;
    calibrationBias: number;
    reliabilityScore: number;
    confidence: number;
  } | null;
}

interface DataSourcesPanelProps {
  question: string;
  sources?: string[];
  embedded?: boolean;
  defaultCollapsed?: boolean;
}

const SOURCE_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  polymarket: { label: "Polymarket", color: "text-neo-purple", icon: "PM" },
  coingecko: { label: "CoinGecko", color: "text-neo-yellow", icon: "CG" },
  news: { label: "News", color: "text-neo-blue", icon: "NW" },
  web: { label: "Web", color: "text-neo-blue", icon: "WB" },
  social: { label: "Social", color: "text-neo-pink", icon: "SC" },
  espn: { label: "ESPN", color: "text-neo-orange", icon: "ES" },
  github: { label: "GitHub", color: "text-neo-green", icon: "GH" },
  onchain: { label: "On-chain", color: "text-neo-cyan", icon: "ON" },
  rss: { label: "RSS", color: "text-neo-yellow", icon: "RS" },
  x: { label: "X", color: "text-neo-blue", icon: "X" },
  telegram: { label: "Telegram", color: "text-neo-purple", icon: "TG" },
};

export default function DataSourcesPanel({
  question,
  sources,
  embedded = false,
  defaultCollapsed = true,
}: DataSourcesPanelProps) {
  const [results, setResults] = useState<DataSourceResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedSource, setExpandedSource] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  useEffect(() => {
    if (!question) return;

    setLoading(true);
    const querySources = sources?.length ? `&sources=${sources.join(",")}` : "";
    fetch(`/api/data-sources?question=${encodeURIComponent(question)}${querySources}`)
      .then((r) => r.json())
      .then((data) => {
        setResults(data.results ?? []);
      })
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }, [question, sources?.join(",")]);

  if (!question) return null;

  const Wrapper = embedded ? "div" : "div";
  const wrapperClass = embedded ? "" : "neo-card overflow-hidden";

  return (
    <Wrapper className={wrapperClass}>
      {/* Header */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/5 transition-colors border-b border-white/10"
      >
        <div className="flex items-center gap-2">
          <span className="font-heading font-bold text-xs uppercase tracking-wider">
            Research Data
          </span>
          {loading && (
            <span className="w-2 h-2 bg-neo-blue rounded-full animate-pulse" />
          )}
          {!loading && results.length > 0 && (
            <span className="text-[10px] font-mono text-white/50">
              {results.length} sources
            </span>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-white/50 transition-transform ${isCollapsed ? "" : "rotate-180"}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {!isCollapsed && (
        <div className="p-3 space-y-2">
          {loading ? (
            <div className="py-6 text-center">
              <span className="font-mono text-xs text-white/50">
                Gathering research data...
              </span>
            </div>
          ) : results.length === 0 ? (
            <div className="py-6 text-center">
              <span className="font-mono text-xs text-white/50">
                No data available
              </span>
            </div>
          ) : (
            results.map((result) => {
              const config = SOURCE_CONFIG[result.source] ?? {
                label: result.source,
                color: "text-white/60",
                icon: "??",
              };
              const isExpanded = expandedSource === result.source;

              return (
                <div
                  key={result.source}
                  className="border border-white/10 bg-white/[0.03] rounded-lg overflow-hidden"
                >
                  <button
                    onClick={() =>
                      setExpandedSource(isExpanded ? null : result.source)
                    }
                    className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/5 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-6 h-6 flex items-center justify-center border border-white/10 text-[9px] font-black ${config.color}`}
                      >
                        {config.icon}
                      </span>
                      <span className="font-heading font-bold text-xs">
                        {config.label}
                      </span>
                      <span className="font-mono text-[10px] text-white/50">
                        {result.data.length} points
                      </span>
                      {result.quality && (
                        <span className="font-mono text-[10px] text-gray-500">
                          Q{Math.round(result.quality.overallScore * 100)}
                        </span>
                      )}
                      {result.backtest && (
                        <span className="font-mono text-[10px] text-gray-500">
                          BT{Math.round(result.backtest.reliabilityScore * 100)}
                        </span>
                      )}
                    </div>
                    <svg
                      className={`w-3 h-3 text-white/50 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </button>

                  {isExpanded && (
                    <div className="px-3 pb-3 space-y-2">
                      {/* Summary */}
                      <p className="font-mono text-[11px] text-white/60 leading-snug">
                        {result.summary}
                      </p>

                      {result.quality && (
                        <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono">
                          <span className="text-gray-500">
                            Reliability:{" "}
                            <span className="font-bold text-gray-700">
                              {Math.round(result.quality.reliabilityScore * 100)}%
                            </span>
                          </span>
                          <span className="text-gray-500">
                            Freshness:{" "}
                            <span className="font-bold text-gray-700">
                              {Math.round(result.quality.freshnessScore * 100)}%
                            </span>
                          </span>
                          <span className="text-gray-500">
                            Confidence:{" "}
                            <span className="font-bold text-gray-700">
                              {Math.round(result.quality.confidenceScore * 100)}%
                            </span>
                          </span>
                          <span className="text-gray-500">
                            Latency:{" "}
                            <span className="font-bold text-gray-700">
                              {result.quality.latencyMs}ms
                            </span>
                          </span>
                        </div>
                      )}

                      {result.backtest && (
                        <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono border border-black/10 bg-white p-2">
                          <span className="text-gray-500">
                            Backtest score:{" "}
                            <span className="font-bold text-gray-700">
                              {Math.round(result.backtest.reliabilityScore * 100)}%
                            </span>
                          </span>
                          <span className="text-gray-500">
                            Samples:{" "}
                            <span className="font-bold text-gray-700">
                              {result.backtest.samples}
                            </span>
                          </span>
                          <span className="text-gray-500">
                            Markets:{" "}
                            <span className="font-bold text-gray-700">
                              {result.backtest.markets}
                            </span>
                          </span>
                          <span className="text-gray-500">
                            Avg Brier:{" "}
                            <span className="font-bold text-gray-700">
                              {result.backtest.avgBrier.toFixed(3)}
                            </span>
                          </span>
                        </div>
                      )}

                      {/* Data points */}
                      <div className="space-y-1">
                        {result.data.map((point, i) => (
                          <div
                            key={i}
                            className="flex items-start gap-2 text-[11px]"
                          >
                            <span className="text-white/50 shrink-0 font-mono">
                              {point.label}:
                            </span>
                            {point.url ? (
                              <a
                                href={point.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono font-bold text-neo-green hover:text-neo-green/80 underline underline-offset-2"
                              >
                                {String(point.value)}
                              </a>
                            ) : (
                              <span className="font-mono font-bold text-white/80">
                                {String(point.value)}
                              </span>
                            )}
                            {point.confidence !== undefined && (
                              <div className="shrink-0 w-12 h-1.5 bg-white/10 mt-1.5">
                                <div
                                  className={`h-full ${config.color.replace("text-", "bg-")}`}
                                  style={{
                                    width: `${Math.min(100, point.confidence * 100)}%`,
                                  }}
                                />
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </Wrapper>
  );
}
