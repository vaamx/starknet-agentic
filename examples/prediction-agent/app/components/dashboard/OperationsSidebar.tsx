"use client";

import type { SerializedSpawnedAgent } from "@/lib/agent-spawner";
import AgentIdentityCard from "../AgentIdentityCard";
import AgentLeaderboard from "../AgentLeaderboard";
import SurvivalDashboard from "../SurvivalDashboard";
import SwarmDialogue from "../SwarmDialogue";
import BreakingMarkets from "../BreakingMarkets";
import CompactActivityTicker from "../CompactActivityTicker";
import AutonomousEngineCard from "./AutonomousEngineCard";
import SpawnedAgentsCard from "./SpawnedAgentsCard";
import type {
  AgentMetricsSnapshot,
  AgentPrediction,
  LeaderboardEntry,
  LoopStatus,
  Market,
} from "./types";

interface OperationsSidebarProps {
  loopStatus: LoopStatus | null;
  factoryConfigured: boolean;
  factoryAddress: string | null;
  autonomousMode: boolean;
  nextTickIn: number | null;
  loopActions: Array<{ detail?: string }>;
  metrics: AgentMetricsSnapshot | null;
  metricsError: string | null;
  leaderboard: LeaderboardEntry[];
  selectedAgent: string | null;
  selectedEntry: LeaderboardEntry | undefined;
  spawnedAgents: SerializedSpawnedAgent[];
  markets: Market[];
  predictions: Record<number, AgentPrediction[]>;
  onSelectAgent: (agent: string) => void;
  onTriggerTick: () => Promise<void> | void;
  onAnalyze: (marketId: number) => void;
  onBet: (marketId: number) => void;
}

/* Left sidebar: visible xl only */
export function LeftSidebar({
  loopStatus,
  factoryConfigured,
  factoryAddress,
  autonomousMode,
  nextTickIn,
  loopActions,
  spawnedAgents,
  selectedEntry,
  onTriggerTick,
}: Pick<
  OperationsSidebarProps,
  | "loopStatus"
  | "factoryConfigured"
  | "factoryAddress"
  | "autonomousMode"
  | "nextTickIn"
  | "loopActions"
  | "spawnedAgents"
  | "selectedEntry"
  | "onTriggerTick"
>) {
  return (
    <aside className="hidden xl:block w-[280px] shrink-0 space-y-3 sticky top-16">
      <AutonomousEngineCard
        loopStatus={loopStatus}
        factoryConfigured={factoryConfigured}
        factoryAddress={factoryAddress}
        autonomousMode={autonomousMode}
        nextTickIn={nextTickIn}
        loopActions={loopActions}
        onTriggerTick={onTriggerTick}
      />

      <SwarmDialogue isLoopRunning={autonomousMode} />

      <SpawnedAgentsCard spawnedAgents={spawnedAgents} />

      {selectedEntry && (
        <AgentIdentityCard
          agent={selectedEntry.agent}
          avgBrier={selectedEntry.avgBrier}
          predictionCount={selectedEntry.predictionCount}
          rank={selectedEntry.rank}
          identity={selectedEntry.identity}
        />
      )}
    </aside>
  );
}

/* Right sidebar: visible lg+ */
export function RightSidebar({
  autonomousMode,
  leaderboard,
  selectedAgent,
  markets,
  predictions,
  onSelectAgent,
  onAnalyze,
  onBet,
}: Pick<
  OperationsSidebarProps,
  | "autonomousMode"
  | "leaderboard"
  | "selectedAgent"
  | "markets"
  | "predictions"
  | "onSelectAgent"
  | "onAnalyze"
  | "onBet"
>) {
  return (
    <aside className="hidden lg:block w-[320px] shrink-0 space-y-3 sticky top-16">
      <BreakingMarkets
        markets={markets}
        predictions={predictions}
        onAnalyze={onAnalyze}
        onBet={onBet}
      />

      <AgentLeaderboard
        entries={leaderboard}
        selectedAgent={selectedAgent}
        onSelectAgent={onSelectAgent}
      />

      <CompactActivityTicker isLoopRunning={autonomousMode} />

      <SurvivalDashboard />
    </aside>
  );
}

/* Default export: backward compat wrapper (used in mobile view) */
export default function OperationsSidebar(props: OperationsSidebarProps) {
  return (
    <aside
      id="operations-heading"
      className="w-full space-y-3"
      aria-label="Agent Operations"
    >
      <BreakingMarkets
        markets={props.markets}
        predictions={props.predictions}
        onAnalyze={props.onAnalyze}
        onBet={props.onBet}
      />

      <AutonomousEngineCard
        loopStatus={props.loopStatus}
        factoryConfigured={props.factoryConfigured}
        factoryAddress={props.factoryAddress}
        autonomousMode={props.autonomousMode}
        nextTickIn={props.nextTickIn}
        loopActions={props.loopActions}
        onTriggerTick={props.onTriggerTick}
      />

      <AgentLeaderboard
        entries={props.leaderboard}
        selectedAgent={props.selectedAgent}
        onSelectAgent={props.onSelectAgent}
      />

      <SwarmDialogue isLoopRunning={props.autonomousMode} />

      <SpawnedAgentsCard spawnedAgents={props.spawnedAgents} />

      <CompactActivityTicker isLoopRunning={props.autonomousMode} />

      <SurvivalDashboard />

      {props.selectedEntry && (
        <AgentIdentityCard
          agent={props.selectedEntry.agent}
          avgBrier={props.selectedEntry.avgBrier}
          predictionCount={props.selectedEntry.predictionCount}
          rank={props.selectedEntry.rank}
          identity={props.selectedEntry.identity}
        />
      )}
    </aside>
  );
}
