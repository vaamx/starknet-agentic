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
}

export default function AutonomousEngineCard({
  loopStatus,
  factoryConfigured,
  factoryAddress,
  autonomousMode,
  nextTickIn,
  loopActions,
  onTriggerTick,
}: AutonomousEngineCardProps) {
  const sessionStatusLabel =
    loopStatus?.signerMode === "owner"
      ? "N/A (OWNER)"
      : loopStatus?.sessionKeyConfigured
        ? "READY"
        : "MISSING";
  const sessionStatusClass =
    loopStatus?.signerMode === "owner"
      ? "text-white/40"
      : loopStatus?.sessionKeyConfigured
        ? "text-neo-green"
        : "text-neo-pink";

  return (
    <div className="neo-card overflow-hidden">
      <div className="bg-white/5 px-4 py-3.5 border-b border-white/10">
        <div className="flex items-center justify-between">
          <h2 className="font-heading font-bold text-white text-sm tracking-tight">
            Autonomous Engine
          </h2>
          <span className="font-mono text-[10px] text-neo-green/70 tracking-wider">
            PULSE
          </span>
        </div>
      </div>
      <div className="p-4 text-[11px] text-white/60 space-y-2">
        <div className="flex items-center justify-between">
          <span>On-chain</span>
          <span
            className={`font-mono ${
              loopStatus?.onChainEnabled ? "text-neo-green" : "text-neo-pink"
            }`}
          >
            {loopStatus?.onChainEnabled ? "ENABLED" : "OFFLINE"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>Factory</span>
          <span
            className={`font-mono ${
              factoryConfigured ? "text-neo-green" : "text-neo-pink"
            }`}
          >
            {factoryConfigured ? "READY" : "MISSING"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>AI Model</span>
          <span
            className={`font-mono ${
              loopStatus?.aiEnabled ? "text-neo-green" : "text-neo-pink"
            }`}
          >
            {loopStatus?.aiEnabled ? "ENABLED" : "MISSING KEY"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>Signer</span>
          <span className="font-mono text-white/80">
            {loopStatus?.signerMode?.toUpperCase() ?? "--"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>Session Key</span>
          <span className={`font-mono ${sessionStatusClass}`}>{sessionStatusLabel}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Auto Resolve</span>
          <span
            className={`font-mono ${
              loopStatus?.autoResolveEnabled ? "text-neo-green" : "text-white/40"
            }`}
          >
            {loopStatus?.autoResolveEnabled ? "ON" : "OFF"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>DeFi Pulse</span>
          <span
            className={`font-mono ${
              loopStatus?.defiEnabled ? "text-neo-green" : "text-white/40"
            }`}
          >
            {loopStatus?.defiEnabled
              ? loopStatus?.defiAutoTrade
                ? "AUTO"
                : "OBSERVE"
              : "OFF"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>Debate Mode</span>
          <span
            className={`font-mono ${
              loopStatus?.debateEnabled ? "text-neo-green" : "text-white/40"
            }`}
          >
            {loopStatus?.debateEnabled ? "LIVE" : "OFF"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>Last tick</span>
          <span className="font-mono">
            {loopStatus?.lastTickAt ? timeAgo(loopStatus.lastTickAt) : "--"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>Next tick</span>
          <span className="font-mono">
            {autonomousMode && nextTickIn !== null ? `${nextTickIn}s` : "--"}
          </span>
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
          className="neo-btn-secondary w-full text-xs mt-2"
        >
          Run One Tick
        </button>
        {factoryAddress && (
          <p className="text-[9px] text-white/30 mt-1 truncate">
            Factory: {factoryAddress}
          </p>
        )}
        {loopActions.length > 0 && (
          <div className="pt-2 border-t border-white/10">
            <p className="text-[10px] text-white/40 mb-1">Last action</p>
            <p className="font-mono text-[11px] text-white/70">
              {loopActions.slice(-1)[0]?.detail ?? "—"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
