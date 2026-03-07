"use client";

import { useCallback, useEffect, useState } from "react";

interface ResolutionAttempt {
  id: string;
  attemptNumber: number;
  strategy: string;
  status: string;
  outcome: number | null;
  confidence: number | null;
  evidence: string | null;
  resolveTxHash: string | null;
  finalizeTxHash: string | null;
  errorMessage: string | null;
  createdAt: number;
}

interface ResolutionStatus {
  orgId: string;
  marketId: number;
  totalAttempts: number;
  lastAttemptAt: number | null;
  lastStatus: string | null;
  escalation: "auto" | "needs_manual_review" | "manually_resolved";
}

interface ResolutionData {
  status: ResolutionStatus | null;
  attempts: ResolutionAttempt[];
  outcome: number | null;
}

interface Props {
  marketId: number;
}

const ESCALATION_CONFIG = {
  auto: {
    label: "Automatic",
    dotClass: "bg-emerald-400",
    bgClass: "border-emerald-400/20 bg-emerald-400/[0.06]",
    textClass: "text-emerald-300",
  },
  needs_manual_review: {
    label: "Needs Review",
    dotClass: "bg-amber-400",
    bgClass: "border-amber-400/20 bg-amber-400/[0.06]",
    textClass: "text-amber-300",
  },
  manually_resolved: {
    label: "Resolved",
    dotClass: "bg-violet-400",
    bgClass: "border-violet-400/20 bg-violet-400/[0.06]",
    textClass: "text-violet-300",
  },
} as const;

const STATUS_COLORS: Record<string, string> = {
  resolved: "text-emerald-400",
  insufficient_evidence: "text-amber-400",
  error: "text-red-400",
};

function timeAgo(unixSec: number): string {
  const delta = Math.floor(Date.now() / 1000) - unixSec;
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

export default function ResolutionStatusPanel({ marketId }: Props) {
  const [data, setData] = useState<ResolutionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [manualResolving, setManualResolving] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/resolution/${marketId}`);
      if (res.ok) {
        setData(await res.json());
        setFetchError(null);
      } else {
        setFetchError(`Resolution fetch failed (${res.status})`);
      }
    } catch (err: any) {
      setFetchError(err?.message ?? "Unable to load resolution data");
    } finally {
      setLoading(false);
    }
  }, [marketId]);

  const handleManualResolve = useCallback(async () => {
    setManualResolving(true);
    setManualError(null);
    try {
      const res = await fetch(`/api/resolution/${marketId}/resolve`, { method: "POST" });
      if (res.ok) {
        await fetchData();
      } else {
        const body = await res.json().catch(() => ({}));
        setManualError(body.error ?? `Failed (${res.status})`);
      }
    } catch (err: any) {
      setManualError(err?.message ?? "Network error");
    } finally {
      setManualResolving(false);
    }
  }, [marketId, fetchData]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading) {
    return (
      <div className="neo-card p-5 space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-white/[0.04] animate-pulse" />
          <div className="h-4 w-36 rounded bg-white/[0.06] animate-pulse" />
        </div>
        <div className="h-16 rounded-lg bg-white/[0.03] animate-pulse" />
      </div>
    );
  }

  if (fetchError && !data) {
    return (
      <div className="neo-card p-5">
        <p className="text-[11px] text-red-400/60 text-center">{fetchError}</p>
      </div>
    );
  }

  const status = data?.status;
  const attempts = data?.attempts ?? [];
  const escalation = status?.escalation ?? "auto";
  const cfg = ESCALATION_CONFIG[escalation];

  return (
    <div className="neo-card p-5 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-violet-400/10 border border-violet-300/25 flex items-center justify-center">
            <svg className="w-3.5 h-3.5 text-violet-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="font-heading font-bold text-sm text-white">Resolution Status</h2>
        </div>

        {/* Escalation badge */}
        <span role="status" aria-live="polite" className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-wide uppercase ${cfg.bgClass} ${cfg.textClass}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${cfg.dotClass}`} />
          {cfg.label}
        </span>
      </div>

      {/* Summary stats */}
      {status ? (
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-2.5 text-center">
            <p className="text-[10px] uppercase tracking-wider text-white/35 mb-0.5">Attempts</p>
            <p className="font-mono font-bold text-lg text-white/80">{status.totalAttempts}</p>
          </div>
          <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-2.5 text-center">
            <p className="text-[10px] uppercase tracking-wider text-white/35 mb-0.5">Last Status</p>
            <p className={`font-semibold text-xs ${STATUS_COLORS[status.lastStatus ?? ""] ?? "text-white/60"}`}>
              {status.lastStatus === "resolved" ? "Resolved" :
               status.lastStatus === "insufficient_evidence" ? "No Evidence" :
               status.lastStatus === "error" ? "Error" : "Pending"}
            </p>
          </div>
          <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-2.5 text-center">
            <p className="text-[10px] uppercase tracking-wider text-white/35 mb-0.5">Last Try</p>
            <p className="font-mono text-xs text-white/60">
              {status.lastAttemptAt ? timeAgo(status.lastAttemptAt) : "--"}
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
          <p className="text-[11px] text-white/40 text-center">No resolution attempts yet</p>
        </div>
      )}

      {/* Manual resolve button — shown only for needs_manual_review */}
      {escalation === "needs_manual_review" && (
        <button
          onClick={handleManualResolve}
          disabled={manualResolving}
          className="w-full rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-[11px] font-semibold text-amber-300 hover:bg-amber-400/[0.12] transition-colors disabled:opacity-50"
        >
          {manualResolving ? "Resolving..." : "Manual Resolve"}
        </button>
      )}
      {manualError && (
        <p className="text-[10px] text-red-400/80" role="alert">{manualError}</p>
      )}

      {/* Last attempt detail */}
      {attempts.length > 0 && (
        <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-wider text-white/35">Latest Attempt</p>
            <span className={`text-[10px] font-mono ${STATUS_COLORS[attempts[0].status] ?? "text-white/50"}`}>
              #{attempts[0].attemptNumber}
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <div>
              <span className="text-white/40">Strategy: </span>
              <span className="text-white/70 font-medium capitalize">{attempts[0].strategy}</span>
            </div>
            {typeof attempts[0].confidence === "number" && (
              <div>
                <span className="text-white/40">Confidence: </span>
                <span className="text-white/70 font-mono">{(attempts[0].confidence * 100).toFixed(0)}%</span>
              </div>
            )}
            {typeof attempts[0].outcome === "number" && (
              <div>
                <span className="text-white/40">Outcome: </span>
                <span className={attempts[0].outcome === 1 ? "text-emerald-400 font-bold" : "text-red-400 font-bold"}>
                  {attempts[0].outcome === 1 ? "YES" : "NO"}
                </span>
              </div>
            )}
          </div>
          {attempts[0].resolveTxHash && (
            <a
              href={`https://sepolia.voyager.online/tx/${attempts[0].resolveTxHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[10px] text-sky-400/80 hover:text-sky-300 font-mono transition-colors"
            >
              <span>tx: {attempts[0].resolveTxHash.slice(0, 14)}...</span>
              <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
              </svg>
            </a>
          )}
          {attempts[0].errorMessage && (
            <p className="text-[10px] text-red-400/70 truncate">{attempts[0].errorMessage}</p>
          )}
        </div>
      )}

      {/* Collapsible attempt history */}
      {attempts.length > 1 && (
        <div>
          <button
            aria-label={expanded ? "Collapse attempt history" : "Expand attempt history"}
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1.5 text-[11px] text-white/40 hover:text-white/60 transition-colors w-full"
          >
            <svg
              className={`w-3 h-3 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
            <span>{expanded ? "Hide" : "Show"} attempt history ({attempts.length} total)</span>
          </button>

          {expanded && (
            <div className="mt-2 space-y-1 max-h-48 overflow-y-auto scrollbar-thin">
              {attempts.map((attempt) => (
                <div
                  key={attempt.id}
                  className="flex items-center gap-3 rounded-md border border-white/[0.04] bg-white/[0.01] px-3 py-2 text-[11px]"
                >
                  <span className="font-mono text-white/30 w-5 text-right shrink-0">#{attempt.attemptNumber}</span>
                  <div className="relative flex items-center justify-center w-3 shrink-0">
                    <div className={`w-1.5 h-1.5 rounded-full ${
                      attempt.status === "resolved" ? "bg-emerald-400" :
                      attempt.status === "insufficient_evidence" ? "bg-amber-400" :
                      "bg-red-400"
                    }`} />
                  </div>
                  <span className="text-white/50 capitalize truncate flex-1">{attempt.strategy}</span>
                  {typeof attempt.confidence === "number" && (
                    <span className="font-mono text-white/40 shrink-0">{(attempt.confidence * 100).toFixed(0)}%</span>
                  )}
                  <span className="text-white/25 font-mono shrink-0">{timeAgo(attempt.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
