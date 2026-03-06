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
      <div className="bg-white/[0.03] px-4 py-3.5 border-b border-white/[0.08]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-neo-cyan/10 border border-neo-cyan/20 flex items-center justify-center">
              <svg className="w-3 h-3 text-neo-cyan" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
            </div>
            <h2 className="font-heading font-bold text-white text-sm tracking-tight">
              Hardening Telemetry
            </h2>
          </div>
          <a
            href="/api/metrics?format=prometheus"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-md border border-white/[0.1] text-neo-blue/70 hover:text-neo-blue hover:border-neo-blue/25 transition-colors"
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
