"use client";

import type { SerializedSpawnedAgent } from "@/lib/agent-spawner";

interface SpawnedAgentsCardProps {
  spawnedAgents: SerializedSpawnedAgent[];
}

export default function SpawnedAgentsCard({ spawnedAgents }: SpawnedAgentsCardProps) {
  if (spawnedAgents.length === 0) return null;

  return (
    <div className="neo-card overflow-hidden">
      <div className="bg-white/5 px-4 py-2.5 border-b border-white/10">
        <h3 className="font-heading font-bold text-white text-xs uppercase tracking-wider">
          Your Custom Agents
        </h3>
      </div>
      <div className="divide-y divide-white/10">
        {spawnedAgents.map((agent) => (
          <div key={agent.id} className="px-4 py-2.5 flex items-center justify-between">
            <div>
              <p className="font-mono text-xs font-medium text-white/90">{agent.name}</p>
              <p className="text-[9px] text-white/40">
                {agent.agentType} · {agent.budgetStrk} STRK
              </p>
            </div>
            <span
              className={`text-[9px] font-mono px-1.5 py-0.5 border ${
                agent.status === "running"
                  ? "border-neo-green/30 text-neo-green bg-neo-green/10"
                  : "border-white/10 text-white/40"
              }`}
            >
              {agent.status.toUpperCase()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
