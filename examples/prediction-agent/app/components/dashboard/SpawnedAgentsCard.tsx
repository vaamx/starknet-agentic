"use client";

import type { SerializedSpawnedAgent } from "@/lib/agent-spawner";

interface SpawnedAgentsCardProps {
  spawnedAgents: SerializedSpawnedAgent[];
}

export default function SpawnedAgentsCard({ spawnedAgents }: SpawnedAgentsCardProps) {
  if (spawnedAgents.length === 0) return null;

  return (
    <div className="neo-card overflow-hidden">
      <div className="bg-white/[0.03] px-4 py-2.5 border-b border-white/[0.08]">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-md bg-neo-purple/10 border border-neo-purple/20 flex items-center justify-center">
            <svg className="w-2.5 h-2.5 text-neo-purple" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
            </svg>
          </div>
          <h3 className="font-heading font-bold text-white text-xs uppercase tracking-wider">
            Your Custom Agents
          </h3>
          <span className="ml-auto text-[10px] font-mono text-white/30">{spawnedAgents.length}</span>
        </div>
      </div>
      <div className="divide-y divide-white/[0.06]">
        {spawnedAgents.map((agent) => (
          <div key={agent.id} className="px-4 py-2.5 flex items-center justify-between">
            <div>
              <p className="font-mono text-xs font-medium text-white/90">{agent.name}</p>
              <p className="text-[9px] text-white/40">
                {agent.agentType} · {agent.budgetStrk} STRK
              </p>
            </div>
            <span
              className={`inline-flex items-center gap-1 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-md border ${
                agent.status === "running"
                  ? "border-neo-green/25 text-neo-green bg-neo-green/10"
                  : agent.status === "paused"
                    ? "border-neo-yellow/25 text-neo-yellow bg-neo-yellow/10"
                    : "border-white/[0.08] text-white/40 bg-white/[0.03]"
              }`}
            >
              <span className={`w-1 h-1 rounded-full ${
                agent.status === "running" ? "bg-neo-green animate-pulse"
                  : agent.status === "paused" ? "bg-neo-yellow"
                  : "bg-white/25"
              }`} />
              {agent.status.toUpperCase()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
