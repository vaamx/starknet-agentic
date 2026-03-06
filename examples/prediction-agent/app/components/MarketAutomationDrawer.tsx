"use client";

import type { Market } from "./dashboard/types";
import type {
  AutomationDraft,
  AutomationSummaryView,
} from "./automation/types";

interface MarketAutomationDrawerProps {
  open: boolean;
  market: Market | null;
  draft: AutomationDraft;
  summary: AutomationSummaryView | null;
  nextRunAt: number | null;
  status: string | null;
  authenticated: boolean;
  executionReady: boolean;
  executionBlockers: string[];
  busy: boolean;
  runBusy: boolean;
  error: string | null;
  runMessage: string | null;
  onClose: () => void;
  onChange: (next: AutomationDraft) => void;
  onSave: () => void;
  onRunNow: () => void;
  onOpenBrief: () => void;
}

function formatDateTime(timestampSec: number | null): string {
  if (!timestampSec) return "Not scheduled";
  const date = new Date(timestampSec * 1000);
  return date.toLocaleString();
}

function asFixed(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "0.00";
  return value.toFixed(digits);
}

export default function MarketAutomationDrawer({
  open,
  market,
  draft,
  summary,
  nextRunAt,
  status,
  authenticated,
  executionReady,
  executionBlockers,
  busy,
  runBusy,
  error,
  runMessage,
  onClose,
  onChange,
  onSave,
  onRunNow,
  onOpenBrief,
}: MarketAutomationDrawerProps) {
  if (!open || !market) return null;

  return (
    <div className="fixed inset-0 z-[120]">
      <button
        type="button"
        onClick={onClose}
        aria-label="Close automation drawer"
        className="absolute inset-0 bg-[#03070f]/70 backdrop-blur-[2px]"
      />
      <aside className="absolute right-0 top-0 h-full w-full max-w-[430px] border-l border-white/[0.12] bg-[linear-gradient(180deg,#0d1222,#0a0f1b)] shadow-[0_20px_90px_rgba(3,8,20,0.65)]">
        <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-6 h-6 rounded-md bg-neo-green/10 border border-neo-green/20 flex items-center justify-center">
                <svg className="w-3 h-3 text-neo-green" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12a7.5 7.5 0 0015 0m-15 0a7.5 7.5 0 1115 0m-15 0H3m16.5 0H21m-1.5 0H12m-8.457 3.077l1.41-.513m14.095-5.13l1.41-.513M5.106 17.785l1.15-.964m11.49-9.642l1.149-.964M7.501 19.795l.75-1.3m7.5-12.99l.75-1.3m-6.063 16.658l.26-1.477m2.605-14.772l.26-1.477m0 17.726l-.26-1.477M10.698 4.614l-.26-1.477M16.5 19.794l-.75-1.299M7.5 4.205L12 12" />
                </svg>
              </div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
                Market Automation
              </p>
            </div>
            <h3 className="text-[16px] font-semibold text-white line-clamp-2 leading-snug">
              {market.question}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg border border-white/15 bg-white/[0.04] px-2.5 py-1.5 text-[12px] font-semibold text-white/60 transition-colors hover:bg-white/[0.09] hover:text-white/80"
          >
            Close
          </button>
        </div>

        <div className="h-[calc(100%-76px)] overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5">
              <p className="text-[11px] text-white/45">Status</p>
              <p className="mt-1 text-[13px] font-semibold text-white/90">
                {status ?? (draft.enabled ? "active" : "paused")}
              </p>
            </div>
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5">
              <p className="text-[11px] text-white/45">Next Run</p>
              <p className="mt-1 text-[12px] font-semibold text-white/85">
                {formatDateTime(nextRunAt)}
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3.5">
            <button
              type="button"
              disabled={!authenticated}
              onClick={() => onChange({ ...draft, enabled: !draft.enabled })}
              className="flex items-center justify-between rounded-xl border border-white/[0.1] bg-white/[0.03] px-3 py-2.5 w-full disabled:opacity-50"
            >
              <span className="text-[13px] font-semibold text-white/85">
                Enable automation
              </span>
              <span className={`w-9 h-5 rounded-full p-0.5 transition-colors ${draft.enabled ? "bg-neo-green" : "bg-white/15"}`}>
                <span className={`block w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${draft.enabled ? "translate-x-4" : ""}`} />
              </span>
            </button>

            <label className="block">
              <span className="mb-1 block text-[12px] font-semibold text-white/70">
                Cadence
              </span>
              <select
                value={draft.cadenceMinutes}
                disabled={!authenticated}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    cadenceMinutes: Number(event.target.value),
                  })
                }
                className="w-full rounded-xl border border-white/[0.16] bg-[#10172a] px-3 py-2 text-[13px] text-white outline-none transition-colors focus:border-cyan-300/45"
              >
                <option value={5}>Every 5 minutes</option>
                <option value={15}>Every 15 minutes</option>
                <option value={60}>Every hour</option>
              </select>
            </label>

            <div className="grid grid-cols-2 gap-2.5">
              <label className="block">
                <span className="mb-1 block text-[12px] font-semibold text-white/70">
                  Max stake (STRK)
                </span>
                <input
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={draft.maxStakeStrk}
                  disabled={!authenticated}
                  onChange={(event) =>
                    onChange({
                      ...draft,
                      maxStakeStrk: Number(event.target.value || "0"),
                    })
                  }
                  className="w-full rounded-xl border border-white/[0.16] bg-[#10172a] px-3 py-2 text-[13px] text-white outline-none transition-colors focus:border-cyan-300/45"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] font-semibold text-white/70">
                  Risk budget (STRK)
                </span>
                <input
                  type="number"
                  min={0.1}
                  step={0.5}
                  value={draft.riskLimitStrk}
                  disabled={!authenticated}
                  onChange={(event) =>
                    onChange({
                      ...draft,
                      riskLimitStrk: Number(event.target.value || "0"),
                    })
                  }
                  className="w-full rounded-xl border border-white/[0.16] bg-[#10172a] px-3 py-2 text-[13px] text-white outline-none transition-colors focus:border-cyan-300/45"
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <label className="block">
                <span className="mb-1 block text-[12px] font-semibold text-white/70">
                  Stop-loss (%)
                </span>
                <input
                  type="number"
                  min={1}
                  max={99}
                  step={1}
                  value={draft.stopLossPct}
                  disabled={!authenticated}
                  onChange={(event) =>
                    onChange({
                      ...draft,
                      stopLossPct: Number(event.target.value || "0"),
                    })
                  }
                  className="w-full rounded-xl border border-white/[0.16] bg-[#10172a] px-3 py-2 text-[13px] text-white outline-none transition-colors focus:border-cyan-300/45"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] font-semibold text-white/70">
                  Signal threshold
                </span>
                <input
                  type="number"
                  min={0.01}
                  max={0.49}
                  step={0.01}
                  value={draft.confidenceThreshold}
                  disabled={!authenticated}
                  onChange={(event) =>
                    onChange({
                      ...draft,
                      confidenceThreshold: Number(event.target.value || "0"),
                    })
                  }
                  className="w-full rounded-xl border border-white/[0.16] bg-[#10172a] px-3 py-2 text-[13px] text-white outline-none transition-colors focus:border-cyan-300/45"
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <label className="block">
                <span className="mb-1 block text-[12px] font-semibold text-white/70">
                  Preferred route
                </span>
                <select
                  value={draft.preferredSurface}
                  disabled={!authenticated}
                  onChange={(event) =>
                    onChange({
                      ...draft,
                      preferredSurface: event.target.value as
                        | "starkzap"
                        | "avnu"
                        | "direct",
                    })
                  }
                  className="w-full rounded-xl border border-white/[0.16] bg-[#10172a] px-3 py-2 text-[13px] text-white outline-none transition-colors focus:border-cyan-300/45"
                >
                  <option value="starkzap">StarkZap</option>
                  <option value="avnu">AVNU</option>
                  <option value="direct">Direct</option>
                </select>
              </label>

              <button
                type="button"
                disabled={!authenticated}
                onClick={() => onChange({ ...draft, allowFallbackToDirect: !draft.allowFallbackToDirect })}
                className="flex items-center justify-between rounded-xl border border-white/[0.12] bg-[#10172a] px-3 py-2.5 w-full disabled:opacity-50"
              >
                <span className="text-[12px] font-semibold text-white/75">
                  Fallback direct
                </span>
                <span className={`w-8 h-4.5 rounded-full p-0.5 transition-colors ${draft.allowFallbackToDirect ? "bg-neo-brand" : "bg-white/15"}`}>
                  <span className={`block w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform ${draft.allowFallbackToDirect ? "translate-x-3.5" : ""}`} />
                </span>
              </button>
            </div>
          </div>

          {summary && (
            <div className="mt-4 rounded-2xl border border-white/[0.09] bg-white/[0.03] p-3.5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">
                Runtime Snapshot
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
                <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-2">
                  <p className="text-white/45">Runs</p>
                  <p className="mt-0.5 font-semibold text-white/90">
                    {summary.runCount}
                  </p>
                </div>
                <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-2">
                  <p className="text-white/45">Success</p>
                  <p className="mt-0.5 font-semibold text-neo-green">
                    {summary.successfulRuns}
                  </p>
                </div>
                <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-2">
                  <p className="text-white/45">Stake Spent</p>
                  <p className="mt-0.5 font-semibold text-white/90">
                    {asFixed(summary.stakeSpentStrk, 2)} STRK
                  </p>
                </div>
                <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-2">
                  <p className="text-white/45">Realized PnL</p>
                  <p
                    className={`mt-0.5 font-semibold ${
                      summary.realizedPnlStrk >= 0
                        ? "text-neo-green"
                        : "text-rose-300"
                    }`}
                  >
                    {summary.realizedPnlStrk >= 0 ? "+" : ""}
                    {asFixed(summary.realizedPnlStrk, 2)} STRK
                  </p>
                </div>
              </div>
            </div>
          )}

          {error && (
            <p className="mt-4 rounded-xl border border-rose-300/25 bg-rose-500/[0.12] px-3 py-2 text-[12px] text-rose-100">
              {error}
            </p>
          )}
          {runMessage && (
            <p className="mt-3 rounded-xl border border-neo-green/25 bg-neo-green/[0.12] px-3 py-2 text-[12px] text-neo-green">
              {runMessage}
            </p>
          )}
          {!executionReady && (
            <p className="mt-3 rounded-xl border border-neo-yellow/25 bg-neo-yellow/[0.12] px-3 py-2 text-[12px] text-neo-yellow">
              Execution blocked: {executionBlockers[0] ?? "Readiness requirements are not met."}
            </p>
          )}
        </div>

        <div className="border-t border-white/[0.08] px-5 py-3.5">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onSave}
              disabled={busy || !authenticated}
              className="rounded-xl border border-cyan-300/35 bg-cyan-400/16 px-4 py-2 text-[13px] font-semibold text-cyan-100 transition-colors hover:bg-cyan-400/24 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Saving..." : "Save Policy"}
            </button>
            <button
              type="button"
              onClick={onRunNow}
              disabled={runBusy || !authenticated || !executionReady}
              className="rounded-xl border border-neo-green/35 bg-neo-green/16 px-4 py-2 text-[13px] font-semibold text-neo-green transition-colors hover:bg-neo-green/24 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {runBusy ? "Running..." : "Run Now"}
            </button>
            <button
              type="button"
              onClick={onOpenBrief}
              className="rounded-xl border border-fuchsia-300/35 bg-fuchsia-400/14 px-4 py-2 text-[13px] font-semibold text-fuchsia-100 transition-colors hover:bg-fuchsia-400/22"
            >
              Agent Brief
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
