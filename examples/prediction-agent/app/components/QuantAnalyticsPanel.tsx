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
        <h2 className="font-heading font-bold text-sm uppercase tracking-wider text-gray-500">
          Quant Analytics
        </h2>
        <div className="flex items-center gap-2">
          <a
            href="/api/analytics/export?dataset=forecasts"
            className="text-[10px] font-mono border border-black px-2 py-1 hover:bg-neo-blue/20"
          >
            CSV Forecasts
          </a>
          <a
            href="/api/analytics/export?dataset=research"
            className="text-[10px] font-mono border border-black px-2 py-1 hover:bg-neo-yellow/20"
          >
            CSV Research
          </a>
          <a
            href="/api/analytics/export?dataset=executions"
            className="text-[10px] font-mono border border-black px-2 py-1 hover:bg-neo-purple/20"
          >
            CSV Executions
          </a>
        </div>
      </div>

      {!analytics ? (
        <p className="text-xs text-gray-500">No analytics yet.</p>
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
            <div className="border-2 border-black p-3">
              <h3 className="text-xs font-bold uppercase tracking-wide mb-2">
                Calibration (Predicted vs Observed)
              </h3>
              <div className="space-y-2">
                {analytics.calibration.length === 0 ? (
                  <p className="text-xs text-gray-500">No resolved forecasts yet.</p>
                ) : (
                  analytics.calibration.map((row) => (
                    <div key={`${row.binStart}-${row.binEnd}`}>
                      <div className="flex justify-between text-[10px] font-mono mb-1">
                        <span>
                          {Math.round(row.binStart * 100)}-{Math.round(row.binEnd * 100)}%
                        </span>
                        <span>n={row.count}</span>
                      </div>
                      <div className="h-2 border border-black bg-gray-100 relative">
                        <div
                          className="absolute top-0 left-0 h-full bg-neo-blue/60"
                          style={{ width: `${Math.max(0, Math.min(100, row.avgPredicted * 100))}%` }}
                        />
                        <div
                          className="absolute top-0 left-0 h-full border-r-2 border-neo-green"
                          style={{ width: `${Math.max(0, Math.min(100, row.observedRate * 100))}%` }}
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="border-2 border-black p-3">
              <h3 className="text-xs font-bold uppercase tracking-wide mb-2">
                Brier Timeline
              </h3>
              <div className="space-y-2">
                {analytics.brierTimeline.length === 0 ? (
                  <p className="text-xs text-gray-500">No Brier history yet.</p>
                ) : (
                  analytics.brierTimeline.slice(-8).map((row) => (
                    <div key={row.day} className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-gray-500 w-20">{row.day.slice(5)}</span>
                      <div className="flex-1 h-2 border border-black bg-gray-100">
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
            <div className="border-2 border-black p-3">
              <h3 className="text-xs font-bold uppercase tracking-wide mb-2">
                Source Attribution
              </h3>
              <div className="space-y-2">
                {analytics.sourceAttribution.length === 0 ? (
                  <p className="text-xs text-gray-500">No research artifacts yet.</p>
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

            <div className="border-2 border-black p-3">
              <h3 className="text-xs font-bold uppercase tracking-wide mb-2">
                Execution Surfaces
              </h3>
              <div className="space-y-2">
                {analytics.strategy.bySurface.length === 0 ? (
                  <p className="text-xs text-gray-500">No execution data yet.</p>
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
            <div className="border-2 border-black p-3">
              <h3 className="text-xs font-bold uppercase tracking-wide mb-2">
                Source Reliability Backtesting
              </h3>
              <div className="space-y-2">
                {sourceReliability.length === 0 ? (
                  <p className="text-xs text-gray-500">
                    No source backtesting yet.
                  </p>
                ) : (
                  sourceReliability.map((row) => (
                    <div
                      key={row.source}
                      className="border border-black/10 p-2 bg-gray-50"
                    >
                      <div className="flex items-center justify-between text-[11px] font-mono">
                        <span className="font-bold">{row.source}</span>
                        <span>{Math.round(row.reliabilityScore * 100)}%</span>
                      </div>
                      <div className="mt-1 h-1.5 border border-black/20 bg-white">
                        <div
                          className="h-full bg-neo-blue/70"
                          style={{
                            width: `${Math.round(row.reliabilityScore * 100)}%`,
                          }}
                        />
                      </div>
                      <div className="mt-1 text-[10px] font-mono text-gray-500 flex justify-between">
                        <span>n={row.samples}</span>
                        <span>m={row.markets}</span>
                        <span>brier {row.avgBrier.toFixed(3)}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="border-2 border-black p-3">
              <h3 className="text-xs font-bold uppercase tracking-wide mb-2">
                Agent Calibration Memory
              </h3>
              <div className="space-y-2">
                {agentCalibration.length === 0 ? (
                  <p className="text-xs text-gray-500">
                    No calibration memory yet.
                  </p>
                ) : (
                  agentCalibration.map((row) => (
                    <div key={row.agentId} className="text-xs font-mono border border-black/10 p-2 bg-gray-50">
                      <div className="flex items-center justify-between">
                        <span>{row.agentId}</span>
                        <span>{Math.round(row.memoryStrength * 100)}%</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[10px] text-gray-500">
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

          <div className="border-2 border-black p-3">
            <h3 className="text-xs font-bold uppercase tracking-wide mb-2">
              Model Calibration Comparison
            </h3>
            {calibrationByModel.length === 0 ? (
              <p className="text-xs text-gray-500">No model comparison data yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="text-left border-b border-black/30">
                      <th className="py-1 pr-2 font-mono">Model</th>
                      <th className="py-1 pr-2 font-mono">Agent</th>
                      <th className="py-1 pr-2 font-mono">Forecasts</th>
                      <th className="py-1 pr-2 font-mono">Brier</th>
                      <th className="py-1 font-mono">Cal Gap</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calibrationByModel.map((row) => (
                      <tr
                        key={`${row.modelName}-${row.agentId}`}
                        className="border-b border-black/10"
                      >
                        <td className="py-1 pr-2 font-mono">{row.modelName}</td>
                        <td className="py-1 pr-2 font-mono">{row.agentId}</td>
                        <td className="py-1 pr-2 font-mono">{row.forecasts}</td>
                        <td className="py-1 pr-2 font-mono">{row.brier.toFixed(3)}</td>
                        <td className="py-1 font-mono">{row.calibrationGap.toFixed(3)}</td>
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
        : "text-neo-dark";

  return (
    <div className="border-2 border-black p-2.5 bg-white">
      <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">
        {label}
      </p>
      <p className={`text-sm font-mono font-bold mt-1 ${accentClass}`}>{value}</p>
    </div>
  );
}
