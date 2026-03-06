"use client";

import type {
  AgentBriefView,
  AutomationRunView,
  AutomationSummaryView,
} from "./automation/types";

interface AgentBriefPanelProps {
  open: boolean;
  brief: AgentBriefView | null;
  summary: AutomationSummaryView | null;
  runs: AutomationRunView[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function asSigned(value: number): string {
  const fixed = value.toFixed(2);
  return value >= 0 ? `+${fixed}` : fixed;
}

function runStatusTone(status: AutomationRunView["status"]): string {
  if (status === "success") return "text-neo-green bg-neo-green/[0.14] border-neo-green/25";
  if (status === "error") return "text-rose-200 bg-rose-500/[0.14] border-rose-300/25";
  return "text-neo-yellow bg-neo-yellow/[0.14] border-neo-yellow/25";
}

export default function AgentBriefPanel({
  open,
  brief,
  summary,
  runs,
  loading,
  error,
  onClose,
}: AgentBriefPanelProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[130]">
      <button
        type="button"
        onClick={onClose}
        className="absolute inset-0 bg-[#02050f]/75 backdrop-blur-[3px]"
        aria-label="Close brief panel"
      />
      <aside className="absolute right-0 top-0 h-full w-full max-w-[420px] border-l border-white/[0.12] bg-[linear-gradient(180deg,#0c1120,#070b15)] shadow-[0_18px_88px_rgba(4,10,24,0.7)]">
        <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-neo-cyan/10 border border-neo-cyan/20 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-neo-cyan" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m5.231 13.481L15 17.25m-4.5-15H5.625c-.621 0-1.125.504-1.125 1.125v16.5c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9zm3.75 11.625a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
              </svg>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
                Agent Brief
              </p>
              <h3 className="mt-0.5 text-[16px] font-semibold text-white">
                Source Reliability + Backtest
              </h3>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/20 bg-white/[0.04] px-2.5 py-1.5 text-[12px] font-semibold text-white/75 transition-colors hover:bg-white/[0.09]"
          >
            Close
          </button>
        </div>

        <div className="h-[calc(100%-74px)] overflow-y-auto px-5 py-4">
          {loading && (
            <div className="space-y-2">
              <div className="h-16 animate-pulse rounded-xl border border-white/[0.08] bg-white/[0.04]" />
              <div className="h-24 animate-pulse rounded-xl border border-white/[0.08] bg-white/[0.04]" />
              <div className="h-24 animate-pulse rounded-xl border border-white/[0.08] bg-white/[0.04]" />
            </div>
          )}

          {!loading && error && (
            <p className="rounded-xl border border-rose-300/25 bg-rose-500/[0.12] px-3 py-2 text-[12px] text-rose-100">
              {error}
            </p>
          )}

          {!loading && !error && brief && (
            <>
              <div className="rounded-2xl border border-white/[0.1] bg-white/[0.03] p-3.5">
                <p className="text-[11px] uppercase tracking-[0.12em] text-white/45">
                  Market
                </p>
                <h4 className="mt-1.5 text-[15px] font-semibold text-white">
                  {brief.marketQuestion}
                </h4>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-2">
                    <p className="text-[11px] text-white/45">Signal</p>
                    <p className="mt-0.5 text-[13px] font-semibold text-white/90 uppercase">
                      {brief.signal.side}
                    </p>
                  </div>
                  <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-2">
                    <p className="text-[11px] text-white/45">Confidence</p>
                    <p className="mt-0.5 text-[13px] font-semibold text-white/90">
                      {pct(brief.signal.confidence)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-2">
                    <p className="text-[11px] text-white/45">Backtest</p>
                    <p className="mt-0.5 text-[13px] font-semibold text-white/90">
                      {pct(brief.backtestConfidence)}
                    </p>
                  </div>
                </div>
                <p className="mt-2 text-[12px] text-cyan-100/90">
                  Recommended stake: {brief.recommendedStakeStrk.toFixed(2)} STRK
                </p>
              </div>

              {brief.riskFlags.length > 0 && (
                <div className="mt-3 rounded-2xl border border-neo-yellow/25 bg-neo-yellow/[0.1] p-3.5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-neo-yellow/80">
                    Risk Flags
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {brief.riskFlags.map((flag) => (
                      <li key={flag} className="text-[12px] text-neo-yellow/90">
                        • {flag}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-3 rounded-2xl border border-white/[0.1] bg-white/[0.03] p-3.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">
                  Source Reliability
                </p>
                <div className="mt-2 space-y-2">
                  {brief.sourceReliability.slice(0, 4).map((row) => (
                    <div
                      key={row.source}
                      className="flex items-center justify-between rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-2"
                    >
                      <div>
                        <p className="text-[12px] font-semibold text-white/90 capitalize">
                          {row.source}
                        </p>
                        <p className="text-[11px] text-white/45">
                          samples {row.samples} • markets {row.markets}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[12px] font-semibold text-cyan-200">
                          {pct(row.reliabilityScore)}
                        </p>
                        <p className="text-[11px] text-white/45">
                          conf {pct(row.confidence)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-3 rounded-2xl border border-white/[0.1] bg-white/[0.03] p-3.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">
                  Agent Calibration Memory
                </p>
                <div className="mt-2 space-y-2">
                  {brief.agentCalibration.slice(0, 4).map((row) => (
                    <div
                      key={row.agentId}
                      className="flex items-center justify-between rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-2"
                    >
                      <div>
                        <p className="text-[12px] font-semibold text-white/90">
                          {row.agentId}
                        </p>
                        <p className="text-[11px] text-white/45">
                          brier {row.avgBrier.toFixed(3)} • samples {row.samples}
                        </p>
                      </div>
                      <p className="text-[12px] font-semibold text-neo-green">
                        {pct(row.memoryStrength)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-3 rounded-2xl border border-white/[0.1] bg-white/[0.03] p-3.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">
                  Automation Runtime
                </p>
                {summary ? (
                  <div className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
                    <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-2">
                      <p className="text-white/45">Runs</p>
                      <p className="font-semibold text-white/90">{summary.runCount}</p>
                    </div>
                    <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-2">
                      <p className="text-white/45">Success</p>
                      <p className="font-semibold text-neo-green">
                        {summary.successfulRuns}
                      </p>
                    </div>
                    <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-2">
                      <p className="text-white/45">Stake</p>
                      <p className="font-semibold text-white/90">
                        {summary.stakeSpentStrk.toFixed(2)} STRK
                      </p>
                    </div>
                    <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-2">
                      <p className="text-white/45">PnL</p>
                      <p
                        className={`font-semibold ${
                          summary.realizedPnlStrk >= 0
                            ? "text-neo-green"
                            : "text-rose-200"
                        }`}
                      >
                        {asSigned(summary.realizedPnlStrk)} STRK
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-[12px] text-white/55">
                    No runtime data yet.
                  </p>
                )}

                {runs.length > 0 && (
                  <div className="mt-2.5 space-y-2">
                    {runs.slice(0, 5).map((run) => (
                      <div
                        key={run.id}
                        className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-2.5 py-2"
                      >
                        <div className="flex items-center justify-between">
                          <span
                            className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase ${runStatusTone(run.status)}`}
                          >
                            {run.status}
                          </span>
                          <span className="text-[11px] text-white/45">
                            {new Date(run.executedAt * 1000).toLocaleString()}
                          </span>
                        </div>
                        <p className="mt-1 text-[12px] text-white/75">
                          {(run.executionSurface ?? "none").toUpperCase()} •{" "}
                          {run.amountStrk ? `${run.amountStrk.toFixed(2)} STRK` : "no stake"}
                        </p>
                        {run.errorMessage && (
                          <p className="mt-1 text-[11px] text-rose-200/85">
                            {run.errorMessage}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
