"use client";

import type { LoopStatus } from "./types";
import { timeAgo } from "./utils";

interface AutonomousEngineCardProps {
  loopStatus: LoopStatus | null;
  factoryConfigured: boolean;
  factoryAddress: string | null;
  autonomousMode: boolean;
  nextTickIn: number | null;
  loopActions: Array<{ detail?: string }>;
  onTriggerTick: () => Promise<void> | void;
  triggerDisabled?: boolean;
  triggerDisabledReason?: string | null;
}

export default function AutonomousEngineCard({
  loopStatus,
  factoryConfigured,
  factoryAddress,
  autonomousMode,
  nextTickIn,
  loopActions,
  onTriggerTick,
  triggerDisabled = false,
  triggerDisabledReason = null,
}: AutonomousEngineCardProps) {
  const sessionStatusLabel =
    loopStatus?.signerMode === "owner"
      ? "N/A (OWNER WALLET)"
      : loopStatus?.sessionKeyConfigured
        ? "READY"
        : "MISSING";
  const sessionStatusClass =
    loopStatus?.signerMode === "owner"
      ? "text-white/40"
      : loopStatus?.sessionKeyConfigured
        ? "text-neo-green"
        : "text-neo-pink";
  const lastActionDetail = loopActions.slice(-1)[0]?.detail ?? "";
  const clippedLastAction =
    lastActionDetail.length > 260
      ? `${lastActionDetail.slice(0, 257)}...`
      : lastActionDetail;

  return (
    <div className="neo-card overflow-hidden">
      <div className="bg-white/[0.03] px-4 py-3.5 border-b border-white/[0.08]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-neo-green/10 border border-neo-green/20 flex items-center justify-center">
              <svg className="w-3 h-3 text-neo-green" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
              </svg>
            </div>
            <h2 className="font-heading font-bold text-white text-sm tracking-tight">
              Autonomous Engine
            </h2>
          </div>
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[9px] font-mono font-bold tracking-wider ${
            autonomousMode
              ? "bg-neo-green/10 text-neo-green border-neo-green/25"
              : "bg-white/[0.04] text-white/40 border-white/[0.08]"
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${autonomousMode ? "bg-neo-green animate-pulse" : "bg-white/25"}`} />
            {autonomousMode ? "LIVE" : "IDLE"}
          </span>
        </div>
      </div>
      <div className="p-4 text-[11px] text-white/60 space-y-0">
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] divide-y divide-white/[0.05]">
          {[
            {
              label: "On-chain",
              active: loopStatus?.onChainEnabled,
              text: loopStatus?.onChainEnabled ? "ENABLED" : "OFFLINE",
            },
            {
              label: "Factory",
              active: factoryConfigured,
              text: factoryConfigured ? "READY" : "MISSING",
            },
            {
              label: "AI Model",
              active: loopStatus?.aiEnabled,
              text: loopStatus?.aiEnabled ? "ENABLED" : "MISSING KEY",
            },
            {
              label: "Signer",
              active: true,
              neutral: true,
              text: loopStatus?.signerMode === "owner"
                ? "OWNER (SERVER)"
                : loopStatus?.signerMode?.toUpperCase() ?? "--",
            },
            {
              label: "Session Key",
              active: loopStatus?.signerMode === "owner" ? undefined : loopStatus?.sessionKeyConfigured,
              neutral: loopStatus?.signerMode === "owner",
              text: sessionStatusLabel,
            },
            {
              label: "Auto Resolve",
              active: loopStatus?.autoResolveEnabled,
              optional: true,
              text: loopStatus?.autoResolveEnabled ? "ON" : "OFF",
            },
            {
              label: "DeFi Pulse",
              active: loopStatus?.defiEnabled,
              optional: true,
              text: loopStatus?.defiEnabled
                ? loopStatus?.defiAutoTrade ? "AUTO" : "OBSERVE"
                : "OFF",
            },
            {
              label: "Debate Mode",
              active: loopStatus?.debateEnabled,
              optional: true,
              text: loopStatus?.debateEnabled ? "LIVE" : "OFF",
            },
          ].map((row) => (
            <div key={row.label} className="flex items-center justify-between px-3 py-2">
              <div className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full ${
                  row.neutral ? "bg-white/25"
                    : row.active ? "bg-neo-green"
                    : row.active === false ? "bg-neo-pink"
                    : "bg-white/15"
                }`} />
                <span className="text-white/60">{row.label}</span>
              </div>
              <span className={`font-mono text-[10px] font-semibold ${
                row.neutral ? "text-white/70"
                  : row.active ? "text-neo-green"
                  : row.active === false ? "text-neo-pink"
                  : "text-white/35"
              }`}>
                {row.text}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
            <p className="text-[9px] text-white/35 uppercase tracking-wider">Last tick</p>
            <p className="mt-0.5 font-mono text-[11px] font-semibold text-white/80">
              {loopStatus?.lastTickAt ? timeAgo(loopStatus.lastTickAt) : "--"}
            </p>
          </div>
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
            <p className="text-[9px] text-white/35 uppercase tracking-wider">Next tick</p>
            <p className="mt-0.5 font-mono text-[11px] font-semibold text-white/80">
              {autonomousMode && nextTickIn !== null ? `${nextTickIn}s` : "--"}
            </p>
          </div>
        </div>
        <div className="pt-2 border-t border-white/10">
          <p className="text-[10px] text-white/40">
            Runs research → forecasts → on-chain predictions/bets, resolves overdue
            markets, and auto-creates new markets.
          </p>
        </div>
        <button
          type="button"
          onClick={onTriggerTick}
          disabled={triggerDisabled}
          title={triggerDisabledReason ?? undefined}
          className="mt-3 w-full rounded-xl border border-neo-green/30 bg-neo-green/10 px-4 py-2.5 text-[12px] font-heading font-bold text-neo-green transition-colors hover:bg-neo-green/20 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-neo-green/10"
        >
          <span className="flex items-center justify-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347a1.125 1.125 0 01-1.667-.986V5.653z" />
            </svg>
            Run One Tick
          </span>
        </button>
        {triggerDisabled && triggerDisabledReason && (
          <p className="mt-1 text-[10px] text-neo-yellow/85">{triggerDisabledReason}</p>
        )}
        {factoryAddress && (
          <p className="text-[9px] text-white/30 mt-1 truncate">
            Factory: {factoryAddress}
          </p>
        )}
        {loopActions.length > 0 && (
          <div className="pt-2 border-t border-white/10">
            <p className="text-[10px] text-white/40 mb-1">Last action</p>
            <p className="font-mono text-[11px] text-white/70 break-words">
              {clippedLastAction || "—"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
