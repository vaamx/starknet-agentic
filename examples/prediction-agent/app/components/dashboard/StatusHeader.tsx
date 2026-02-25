"use client";

import WalletConnect from "../WalletConnect";
import Stat from "./Stat";
import { formatVolume, timeAgo } from "./utils";
import type { Market } from "./types";

interface StatusHeaderProps {
  markets: Market[];
  filteredCount: number;
  activeAgents: number;
  customAgentCount: number;
  autonomousMode: boolean;
  loopToggling: boolean;
  nextTickIn: number | null;
  lastUpdatedAt: number | null;
  marketDataSource: "onchain" | "cache" | "unknown";
  marketDataStale: boolean;
  onToggleAutonomousMode: () => void;
  onOpenSpawner: () => void;
  onOpenCreator: () => void;
}

export default function StatusHeader({
  markets,
  filteredCount,
  activeAgents,
  customAgentCount,
  autonomousMode,
  loopToggling,
  nextTickIn,
  lastUpdatedAt,
  marketDataSource,
  marketDataStale,
  onToggleAutonomousMode,
  onOpenSpawner,
  onOpenCreator,
}: StatusHeaderProps) {
  const sourceLabel =
    marketDataSource === "onchain"
      ? "ON-CHAIN"
      : marketDataSource === "cache"
        ? "CACHE"
        : "UNKNOWN";

  return (
    <>
      <header className="border-b border-white/10 bg-[#060d1f]/90 backdrop-blur sticky top-0 z-50">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            <div className="w-10 h-10 bg-neo-green/15 border border-neo-green/30 flex items-center justify-center shrink-0 rounded-xl shadow-[0_0_24px_rgba(0,229,204,0.18)]">
              <span className="text-neo-green font-mono font-black text-sm">SA</span>
            </div>
            <div className="min-w-0">
              <h1 className="font-heading font-bold text-base sm:text-xl tracking-tight leading-none text-white truncate">
                Starknet Agentic Swarm
              </h1>
              <p className="text-[10px] font-mono text-white/45 tracking-wider uppercase mt-1 hidden sm:block">
                Agentic Superforecasting Market Network
              </p>
            </div>
          </div>

          <div className="flex items-center flex-wrap gap-2 justify-end">
            <nav className="hidden lg:flex items-center gap-4 mr-1">
              <a href="#markets-heading" className="text-[11px] font-mono text-white/55 hover:text-white">
                Markets
              </a>
              <a href="#operations-heading" className="text-[11px] font-mono text-white/55 hover:text-white">
                Agents
              </a>
              <a href="#trade-log-heading" className="text-[11px] font-mono text-white/55 hover:text-white">
                Activity
              </a>
            </nav>

            <div className="relative group flex items-center gap-2">
              <button
                type="button"
                onClick={onToggleAutonomousMode}
                disabled={loopToggling}
                aria-pressed={autonomousMode}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-mono transition-colors ${
                  autonomousMode
                    ? "border-neo-green/50 bg-neo-green/10 text-neo-green"
                    : "border-white/20 text-white/50 hover:border-white/40"
                } ${loopToggling ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    autonomousMode ? "bg-neo-green animate-pulse" : "bg-white/30"
                  }`}
                />
                {loopToggling
                  ? "..."
                  : autonomousMode
                    ? "Autonomous ON"
                    : "Autonomous OFF"}
              </button>
              <span
                className="w-5 h-5 flex items-center justify-center border border-white/20 text-[10px] font-mono text-white/50 bg-white/5 rounded-full"
                aria-hidden="true"
              >
                ?
              </span>
              <div
                className="absolute right-0 top-full mt-2 w-64 text-[10px] text-white/70 bg-neo-dark/90 border border-white/10 p-2 shadow-neo hidden group-hover:block rounded-lg"
                role="tooltip"
              >
                Runs the agent loop every 60s to research markets, record predictions,
                place bets, and auto-create new markets when configured.
              </div>
            </div>
            {autonomousMode && nextTickIn !== null && (
              <span className="text-[10px] font-mono text-white/50">
                Next tick in {nextTickIn}s
              </span>
            )}

            <button
              type="button"
              onClick={onOpenSpawner}
              className="neo-btn-secondary text-xs py-2 px-4 border-neo-purple/30 text-neo-purple hidden sm:flex"
            >
              + Spawn Agent
            </button>

            <div>
              <WalletConnect />
            </div>

            <div className="neo-badge bg-white/5 text-[10px] py-0.5 gap-1.5 hidden sm:flex">
              <span className="relative w-2 h-2 rounded-full bg-neo-green pulse-ring" />
              <span className="font-mono">Sepolia</span>
            </div>

            <div
              className={`neo-badge text-[10px] py-0.5 gap-1.5 ${
                marketDataStale
                  ? "border-neo-yellow/40 text-neo-yellow bg-neo-yellow/10"
                  : "bg-white/5 text-white/70"
              }`}
              title="Live market feed source"
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  marketDataSource === "onchain"
                    ? "bg-neo-green"
                    : marketDataSource === "cache"
                      ? "bg-neo-yellow"
                      : "bg-white/40"
                }`}
              />
              <span className="font-mono">{sourceLabel}</span>
            </div>

            <button
              type="button"
              onClick={onOpenCreator}
              className="neo-btn-primary text-xs py-2 px-4 hidden sm:flex"
            >
              + New Market
            </button>
          </div>
        </div>
      </header>

      <div className="border-b border-white/10 bg-[#081327]/70 text-white">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-2.5 flex items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3 sm:gap-6" role="status" aria-live="polite">
            <Stat label="Live Markets" value={markets.length.toString()} />
            {filteredCount !== markets.length && (
              <Stat label="Shown" value={filteredCount.toString()} />
            )}
            <Stat label="Total Volume" value={formatVolume(markets)} accent />
            <Stat label="Agents" value={activeAgents.toString()} />
            {customAgentCount > 0 && (
              <Stat label="Custom Agents" value={customAgentCount.toString()} />
            )}
            {autonomousMode && <Stat label="Mode" value="AUTONOMOUS" accent />}
          </div>
          <div className="hidden md:flex items-center gap-4 text-[10px] font-mono text-white/30">
            {lastUpdatedAt ? (
              <span>Updated {timeAgo(lastUpdatedAt)}</span>
            ) : (
              <span>Awaiting first data load</span>
            )}
            <span>|</span>
            <span>ERC-8004</span>
            <span>|</span>
            <span>MCP</span>
          </div>
        </div>
      </div>
    </>
  );
}
