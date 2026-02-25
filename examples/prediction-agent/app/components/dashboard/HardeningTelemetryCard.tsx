"use client";

import type { AgentMetricsSnapshot } from "./types";
import { timeAgo } from "./utils";

interface HardeningTelemetryCardProps {
  metrics: AgentMetricsSnapshot | null;
  metricsError: string | null;
}

export default function HardeningTelemetryCard({
  metrics,
  metricsError,
}: HardeningTelemetryCardProps) {
  return (
    <div className="neo-card overflow-hidden">
      <div className="bg-white/5 px-4 py-3.5 border-b border-white/10">
        <div className="flex items-center justify-between">
          <h2 className="font-heading font-bold text-white text-sm tracking-tight">
            Hardening Telemetry
          </h2>
          <a
            href="/api/metrics?format=prometheus"
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[10px] text-neo-blue/80 hover:text-neo-blue"
          >
            PROM
          </a>
        </div>
      </div>
      <div className="p-4 text-[11px] text-white/60 space-y-2">
        {metrics ? (
          <>
            <div className="flex items-center justify-between">
              <span>Action window</span>
              <span className="font-mono text-white/80">{metrics.actions.windowSize}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Error rate</span>
              <span
                className={`font-mono ${
                  metrics.actions.errorRate > 0.2 ? "text-neo-pink" : "text-neo-green"
                }`}
              >
                {(metrics.actions.errorRate * 100).toFixed(1)}%
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Consensus applied</span>
              <span className="font-mono text-white/80">
                {metrics.consensus.appliedCount}/{metrics.consensus.sampleCount}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Consensus blocked</span>
              <span
                className={`font-mono ${
                  metrics.consensus.blockedCount > 0 ? "text-neo-yellow" : "text-neo-green"
                }`}
              >
                {metrics.consensus.blockedCount}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Guardrails</span>
              <span className="font-mono text-white/80">
                p{metrics.consensus.guardrailCounts.insufficient_peer_count} w
                {metrics.consensus.guardrailCounts.insufficient_peer_weight} c
                {metrics.consensus.guardrailCounts.delta_clamped}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Consensus Δ avg</span>
              <span className="font-mono text-white/80">
                {metrics.consensus.avgAbsDeltaPct.toFixed(2)}pp
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Brier drift (auto)</span>
              <span className="font-mono text-white/80">
                {metrics.consensus.avgAutotuneDrift.toFixed(4)} ·{" "}
                {(metrics.consensus.avgAutotuneNormalizedDrift * 100).toFixed(0)}%
              </span>
            </div>
            <div className="pt-2 border-t border-white/10 space-y-2">
              <div className="flex items-center justify-between">
                <span>Active runtimes</span>
                <span className="font-mono text-white/80">{metrics.runtime.activeRuntimes}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Failovers</span>
                <span className="font-mono text-neo-yellow">
                  {metrics.runtime.events.failedOver}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Heartbeat errors</span>
                <span className="font-mono text-neo-pink">
                  {metrics.runtime.events.heartbeatError}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Quarantined regions</span>
                <span className="font-mono text-white/80">
                  {metrics.runtime.quarantinedRegionCount}
                </span>
              </div>
              {metrics.runtime.quarantinedRegions.slice(0, 2).map((region) => (
                <div
                  key={region.region}
                  className="flex items-center justify-between text-[10px]"
                >
                  <span className="font-mono text-white/50 uppercase">{region.region}</span>
                  <span className="font-mono text-white/60">
                    {Math.ceil(region.remainingSecs / 60)}m · {region.impactedAgents} ag
                  </span>
                </div>
              ))}
              <div className="text-[10px] text-white/40">
                Updated {timeAgo(metrics.generatedAt)} · max failover depth{" "}
                {metrics.runtime.maxFailoverCount}
              </div>
            </div>
          </>
        ) : (
          <p className="text-[10px] text-white/40">Metrics loading...</p>
        )}
        {metricsError && (
          <p className="text-[10px] text-neo-pink/80">Metrics unavailable: {metricsError}</p>
        )}
      </div>
    </div>
  );
}
