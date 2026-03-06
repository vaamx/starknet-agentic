"use client";

interface QuantAnalytics {
  calibration: Array<{
    binStart: number;
    binEnd: number;
    avgPredicted: number;
    observedRate: number;
    count: number;
  }>;
  brierTimeline: Array<{
    day: string;
    brier: number;
    count: number;
  }>;
  sourceAttribution: Array<{
    source: string;
    count: number;
  }>;
  sourceReliability: Array<{
    source: string;
    samples: number;
    markets: number;
    avgBrier: number;
    calibrationBias: number;
    reliabilityScore: number;
    confidence: number;
  }>;
  agentCalibration: Array<{
    agentId: string;
    samples: number;
    avgBrier: number;
    calibrationBias: number;
    reliabilityScore: number;
    confidence: number;
    memoryStrength: number;
  }>;
  forecastQuality: {
    avgBrier: number;
    avgLogLoss: number;
    sharpness: number;
    calibrationGap: number;
    brierSkillScore: number;
  };
  strategy: {
    totalExecutions: number;
    successRate: number;
    deployedCapitalStrk: number;
    realizedPnlStrk: number;
    bySurface: Array<{
      executionSurface: string;
      executions: number;
      successRate: number;
    }>;
  };
}

interface QuantAnalyticsPanelProps {
  analytics: QuantAnalytics | null;
  calibrationByModel: Array<{
    modelName: string;
    agentId: string;
    forecasts: number;
    brier: number;
    calibrationGap: number;
  }>;
}

export default function QuantAnalyticsPanel({
  analytics,
  calibrationByModel,
}: QuantAnalyticsPanelProps) {
  const forecastQuality = analytics?.forecastQuality ?? {
    avgBrier: 0,
    avgLogLoss: 0,
    sharpness: 0,
    calibrationGap: 0,
    brierSkillScore: 0,
  };
  const sourceReliability = analytics?.sourceReliability ?? [];
  const agentCalibration = analytics?.agentCalibration ?? [];

  return (
    <section className="neo-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-neo-cyan/10 border border-neo-cyan/20 flex items-center justify-center">
            <svg className="w-3 h-3 text-neo-cyan" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
            </svg>
          </div>
          <h2 className="font-heading font-bold text-sm uppercase tracking-wider text-white/50">
            Quant Analytics
          </h2>
        </div>
        <div className="flex items-center gap-1.5">
          <a
            href="/api/analytics/export?dataset=forecasts"
            className="text-[10px] font-mono rounded-md border border-white/[0.1] bg-white/[0.03] px-2 py-1 text-white/50 hover:bg-neo-blue/15 hover:text-neo-blue hover:border-neo-blue/25 transition-colors"
          >
            CSV Forecasts
          </a>
          <a
            href="/api/analytics/export?dataset=research"
            className="text-[10px] font-mono rounded-md border border-white/[0.1] bg-white/[0.03] px-2 py-1 text-white/50 hover:bg-neo-yellow/15 hover:text-neo-yellow hover:border-neo-yellow/25 transition-colors"
          >
            CSV Research
          </a>
          <a
            href="/api/analytics/export?dataset=executions"
            className="text-[10px] font-mono rounded-md border border-white/[0.1] bg-white/[0.03] px-2 py-1 text-white/50 hover:bg-neo-purple/15 hover:text-neo-purple hover:border-neo-purple/25 transition-colors"
          >
            CSV Executions
          </a>
        </div>
      </div>

      {!analytics ? (
        <p className="text-xs text-white/40">No analytics yet.</p>
      ) : (
        <div className="space-y-5">
          <div className="grid md:grid-cols-4 gap-3">
            <Metric label="Executions" value={String(analytics.strategy.totalExecutions)} />
            <Metric
              label="Success Rate"
              value={`${Math.round(analytics.strategy.successRate * 100)}%`}
            />
            <Metric
              label="Capital Deployed"
              value={`${analytics.strategy.deployedCapitalStrk.toFixed(2)} STRK`}
            />
            <Metric
              label="Realized PnL"
              value={`${analytics.strategy.realizedPnlStrk.toFixed(2)} STRK`}
              accent={analytics.strategy.realizedPnlStrk >= 0 ? "green" : "pink"}
            />
          </div>

          <div className="grid md:grid-cols-5 gap-3">
            <Metric
              label="Avg Brier"
              value={forecastQuality.avgBrier.toFixed(3)}
              accent={forecastQuality.avgBrier <= 0.2 ? "green" : "pink"}
            />
            <Metric
              label="Log Loss"
              value={forecastQuality.avgLogLoss.toFixed(3)}
            />
            <Metric
              label="Sharpness"
              value={`${Math.round(forecastQuality.sharpness * 100)}%`}
            />
            <Metric
              label="Cal Gap"
              value={forecastQuality.calibrationGap.toFixed(3)}
              accent={forecastQuality.calibrationGap <= 0.08 ? "green" : "pink"}
            />
            <Metric
              label="Brier Skill"
              value={`${(forecastQuality.brierSkillScore * 100).toFixed(1)}%`}
              accent={forecastQuality.brierSkillScore >= 0 ? "green" : "pink"}
            />
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
              <h3 className="text-xs font-bold uppercase tracking-wide mb-2">
                Calibration (Predicted vs Observed)
              </h3>
              <div className="space-y-2">
                {analytics.calibration.length === 0 ? (
                  <p className="text-xs text-white/40">No resolved forecasts yet.</p>
                ) : (
                  analytics.calibration.map((row) => (
                    <div key={`${row.binStart}-${row.binEnd}`}>
                      <div className="flex justify-between text-[10px] font-mono mb-1">
                        <span>
                          {Math.round(row.binStart * 100)}-{Math.round(row.binEnd * 100)}%
                        </span>
                        <span>n={row.count}</span>
                      </div>
                      <div className="h-2 rounded-full bg-white/[0.06] relative overflow-hidden">
                        <div
                          className="absolute top-0 left-0 h-full bg-neo-blue/60"
                          style={{ width: `${Math.max(0, Math.min(100, row.avgPredicted * 100))}%` }}
                        />
                        <div
                          className="absolute top-0 left-0 h-full border-r-2 border-neo-green rounded-full"
                          style={{ width: `${Math.max(0, Math.min(100, row.observedRate * 100))}%` }}
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
              <h3 className="text-xs font-bold uppercase tracking-wide mb-2">
                Brier Timeline
              </h3>
              <div className="space-y-2">
                {analytics.brierTimeline.length === 0 ? (
                  <p className="text-xs text-white/40">No Brier history yet.</p>
                ) : (
                  analytics.brierTimeline.slice(-8).map((row) => (
                    <div key={row.day} className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-white/40 w-20">{row.day.slice(5)}</span>
                      <div className="flex-1 h-2 rounded-full bg-white/[0.06] overflow-hidden">
                        <div
                          className="h-full bg-neo-purple/70"
                          style={{ width: `${Math.max(0, Math.min(100, (1 - row.brier) * 100))}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-mono w-12 text-right">
                        {row.brier.toFixed(3)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
              <h3 className="text-xs font-bold uppercase tracking-wide mb-2">
                Source Attribution
              </h3>
              <div className="space-y-2">
                {analytics.sourceAttribution.length === 0 ? (
                  <p className="text-xs text-white/40">No research artifacts yet.</p>
                ) : (
                  analytics.sourceAttribution.map((row) => (
                    <div key={row.source} className="flex items-center justify-between text-xs">
                      <span className="font-mono">{row.source}</span>
                      <span className="font-mono font-bold">{row.count}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
              <h3 className="text-xs font-bold uppercase tracking-wide mb-2">
                Execution Surfaces
              </h3>
              <div className="space-y-2">
                {analytics.strategy.bySurface.length === 0 ? (
                  <p className="text-xs text-white/40">No execution data yet.</p>
                ) : (
                  analytics.strategy.bySurface.map((row) => (
                    <div key={row.executionSurface} className="flex items-center justify-between text-xs">
                      <span className="font-mono">{row.executionSurface}</span>
                      <span className="font-mono">
                        {row.executions} / {Math.round(row.successRate * 100)}%
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
              <h3 className="text-xs font-bold uppercase tracking-wide mb-2">
                Source Reliability Backtesting
              </h3>
              <div className="space-y-2">
                {sourceReliability.length === 0 ? (
                  <p className="text-xs text-white/40">
                    No source backtesting yet.
                  </p>
                ) : (
                  sourceReliability.map((row) => (
                    <div
                      key={row.source}
                      className="rounded-lg border border-white/[0.06] p-2 bg-white/[0.02]"
                    >
                      <div className="flex items-center justify-between text-[11px] font-mono">
                        <span className="font-bold">{row.source}</span>
                        <span>{Math.round(row.reliabilityScore * 100)}%</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                        <div
                          className="h-full bg-neo-blue/70"
                          style={{
                            width: `${Math.round(row.reliabilityScore * 100)}%`,
                          }}
                        />
                      </div>
                      <div className="mt-1 text-[10px] font-mono text-white/40 flex justify-between">
                        <span>n={row.samples}</span>
                        <span>m={row.markets}</span>
                        <span>brier {row.avgBrier.toFixed(3)}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
              <h3 className="text-xs font-bold uppercase tracking-wide mb-2">
                Agent Calibration Memory
              </h3>
              <div className="space-y-2">
                {agentCalibration.length === 0 ? (
                  <p className="text-xs text-white/40">
                    No calibration memory yet.
                  </p>
                ) : (
                  agentCalibration.map((row) => (
                    <div key={row.agentId} className="text-xs font-mono rounded-lg border border-white/[0.06] p-2 bg-white/[0.02]">
                      <div className="flex items-center justify-between">
                        <span>{row.agentId}</span>
                        <span>{Math.round(row.memoryStrength * 100)}%</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[10px] text-white/40">
                        <span>n={row.samples}</span>
                        <span>brier {row.avgBrier.toFixed(3)}</span>
                        <span>bias {(row.calibrationBias * 100).toFixed(1)}pt</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
            <h3 className="text-xs font-bold uppercase tracking-wide mb-2">
              Model Calibration Comparison
            </h3>
            {calibrationByModel.length === 0 ? (
              <p className="text-xs text-white/40">No model comparison data yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse text-white/70">
                  <thead>
                    <tr className="text-left border-b border-white/[0.1]">
                      <th className="py-1.5 pr-2 font-mono text-white/40 font-semibold">Model</th>
                      <th className="py-1.5 pr-2 font-mono text-white/40 font-semibold">Agent</th>
                      <th className="py-1.5 pr-2 font-mono text-white/40 font-semibold">Forecasts</th>
                      <th className="py-1.5 pr-2 font-mono text-white/40 font-semibold">Brier</th>
                      <th className="py-1.5 font-mono text-white/40 font-semibold">Cal Gap</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calibrationByModel.map((row) => (
                      <tr
                        key={`${row.modelName}-${row.agentId}`}
                        className="border-b border-white/[0.05]"
                      >
                        <td className="py-1.5 pr-2 font-mono text-white/60">{row.modelName}</td>
                        <td className="py-1.5 pr-2 font-mono text-white/60">{row.agentId}</td>
                        <td className="py-1.5 pr-2 font-mono text-white/80">{row.forecasts}</td>
                        <td className="py-1.5 pr-2 font-mono text-white/80">{row.brier.toFixed(3)}</td>
                        <td className="py-1.5 font-mono text-white/80">{row.calibrationGap.toFixed(3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function Metric({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "green" | "pink";
}) {
  const accentClass =
    accent === "green"
      ? "text-neo-green"
      : accent === "pink"
        ? "text-neo-pink"
        : "text-white/80";

  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-2.5">
      <p className="text-[10px] font-bold uppercase tracking-wide text-white/35">
        {label}
      </p>
      <p className={`text-sm font-mono font-bold mt-1 ${accentClass}`}>{value}</p>
    </div>
  );
}
