"use client";

import type { SerializedSpawnedAgent } from "@/lib/agent-spawner";
import AgentIdentityCard from "../AgentIdentityCard";
import AgentLeaderboard from "../AgentLeaderboard";
import OpenClawConnections from "../OpenClawConnections";
import ResearchLab from "../ResearchLab";
import SurvivalDashboard from "../SurvivalDashboard";
import SwarmDialogue from "../SwarmDialogue";
import AutonomousEngineCard from "./AutonomousEngineCard";
import HardeningTelemetryCard from "./HardeningTelemetryCard";
import SpawnedAgentsCard from "./SpawnedAgentsCard";
import type { AgentMetricsSnapshot, LeaderboardEntry, LoopStatus } from "./types";

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
  onSelectAgent: (agent: string) => void;
  onTriggerTick: () => Promise<void> | void;
}

export default function OperationsSidebar({
  loopStatus,
  factoryConfigured,
  factoryAddress,
  autonomousMode,
  nextTickIn,
  loopActions,
  metrics,
  metricsError,
  leaderboard,
  selectedAgent,
  selectedEntry,
  spawnedAgents,
  onSelectAgent,
  onTriggerTick,
}: OperationsSidebarProps) {
  return (
    <aside className="w-full xl:w-[360px] xl:shrink-0 space-y-4 xl:sticky xl:top-20">
      <AutonomousEngineCard
        loopStatus={loopStatus}
        factoryConfigured={factoryConfigured}
        factoryAddress={factoryAddress}
        autonomousMode={autonomousMode}
        nextTickIn={nextTickIn}
        loopActions={loopActions}
        onTriggerTick={onTriggerTick}
      />

      <HardeningTelemetryCard metrics={metrics} metricsError={metricsError} />

      <SurvivalDashboard />

      <SwarmDialogue isLoopRunning={autonomousMode} />

      <ResearchLab />

      <OpenClawConnections />

      <AgentLeaderboard
        entries={leaderboard}
        selectedAgent={selectedAgent}
        onSelectAgent={onSelectAgent}
      />

      {selectedEntry && (
        <AgentIdentityCard
          agent={selectedEntry.agent}
          avgBrier={selectedEntry.avgBrier}
          predictionCount={selectedEntry.predictionCount}
          rank={selectedEntry.rank}
          identity={selectedEntry.identity}
        />
      )}

      <SpawnedAgentsCard spawnedAgents={spawnedAgents} />
    </aside>
  );
}
