import { randomBytes } from "node:crypto";
import { db, nowUnix } from "./db";
import { getPrismaClient } from "./prisma";

function makeId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

export interface AnalyticsOverview {
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
  sourceReliability: SourceReliabilityBacktestRow[];
  agentCalibration: AgentCalibrationMemory[];
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

export interface ModelCalibrationRow {
  modelName: string;
  agentId: string;
  forecasts: number;
  brier: number;
  calibrationGap: number;
}

export interface SourceReliabilityBacktestRow {
  source: string;
  samples: number;
  markets: number;
  avgBrier: number;
  calibrationBias: number;
  reliabilityScore: number;
  confidence: number;
}

export interface AgentCalibrationMemory {
  agentId: string;
  samples: number;
  avgBrier: number;
  calibrationBias: number;
  reliabilityScore: number;
  confidence: number;
  memoryStrength: number;
}

type OutcomeRow = {
  probability: number;
  outcome: number;
  createdAt: number;
  modelName?: string | null;
  agentId?: string | null;
};

type SourceOutcomeRow = {
  sourceType: string;
  marketId: number;
  probability: number;
  outcome: number;
  createdAt: number;
};

const SOURCE_PRIOR_RELIABILITY: Record<string, number> = {
  polymarket: 0.72,
  coingecko: 0.76,
  news: 0.62,
  social: 0.52,
};

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizeAgentMemory(row: {
  agentId: string;
  samples: number;
  avgBrier: number;
  calibrationBias: number;
}): AgentCalibrationMemory {
  const confidence = clampUnit(Math.sqrt(row.samples / 48));
  const reliabilityScore = clampUnit(
    (1 - row.avgBrier * 1.7) * (1 - Math.min(0.9, Math.abs(row.calibrationBias)))
  );
  const memoryStrength = clampUnit(confidence * 0.85);

  return {
    agentId: row.agentId,
    samples: row.samples,
    avgBrier: row.avgBrier,
    calibrationBias: row.calibrationBias,
    reliabilityScore,
    confidence,
    memoryStrength,
  };
}

function buildSourceReliabilityBacktests(
  sourceRows: SourceOutcomeRow[]
): SourceReliabilityBacktestRow[] {
  const groups = new Map<
    string,
    {
      source: string;
      samples: number;
      brierSum: number;
      biasSum: number;
      markets: Set<number>;
    }
  >();

  for (const row of sourceRows) {
    const source = row.sourceType.toLowerCase();
    const probability = Math.max(0, Math.min(1, row.probability));
    const outcome = row.outcome === 1 ? 1 : 0;
    const brier = (probability - outcome) * (probability - outcome);
    const bias = probability - outcome;

    const current = groups.get(source) ?? {
      source,
      samples: 0,
      brierSum: 0,
      biasSum: 0,
      markets: new Set<number>(),
    };

    current.samples += 1;
    current.brierSum += brier;
    current.biasSum += bias;
    current.markets.add(row.marketId);
    groups.set(source, current);
  }

  const rows = [...groups.values()].map((group) => {
    const avgBrier = group.samples > 0 ? group.brierSum / group.samples : 0.25;
    const calibrationBias =
      group.samples > 0 ? group.biasSum / group.samples : 0;
    const confidence = clampUnit(Math.sqrt(group.samples / 40));
    const prior = SOURCE_PRIOR_RELIABILITY[group.source] ?? 0.55;
    const skill = clampUnit(1 - avgBrier * 1.65);
    const biasPenalty = clampUnit(1 - Math.min(0.85, Math.abs(calibrationBias)));
    const reliabilityScore = clampUnit(
      prior * 0.25 + skill * 0.45 + biasPenalty * 0.15 + confidence * 0.15
    );

    return {
      source: group.source,
      samples: group.samples,
      markets: group.markets.size,
      avgBrier,
      calibrationBias,
      reliabilityScore,
      confidence,
    };
  });

  for (const [source, prior] of Object.entries(SOURCE_PRIOR_RELIABILITY)) {
    if (!rows.some((row) => row.source === source)) {
      rows.push({
        source,
        samples: 0,
        markets: 0,
        avgBrier: 0.25,
        calibrationBias: 0,
        reliabilityScore: prior,
        confidence: 0,
      });
    }
  }

  return rows.sort((a, b) => b.reliabilityScore - a.reliabilityScore);
}

function buildAgentCalibrationMemoriesFromOutcomes(
  outcomeRows: OutcomeRow[]
): AgentCalibrationMemory[] {
  const groups = new Map<
    string,
    {
      agentId: string;
      samples: number;
      brierSum: number;
      biasSum: number;
    }
  >();

  for (const row of outcomeRows) {
    const agentId = (row.agentId ?? "").trim();
    if (!agentId) continue;

    const probability = Math.max(0, Math.min(1, row.probability));
    const outcome = row.outcome === 1 ? 1 : 0;
    const brier = (probability - outcome) * (probability - outcome);
    const bias = probability - outcome;

    const current = groups.get(agentId) ?? {
      agentId,
      samples: 0,
      brierSum: 0,
      biasSum: 0,
    };

    current.samples += 1;
    current.brierSum += brier;
    current.biasSum += bias;
    groups.set(agentId, current);
  }

  return [...groups.values()]
    .map((group) =>
      normalizeAgentMemory({
        agentId: group.agentId,
        samples: group.samples,
        avgBrier: group.samples > 0 ? group.brierSum / group.samples : 0.25,
        calibrationBias: group.samples > 0 ? group.biasSum / group.samples : 0,
      })
    )
    .sort((a, b) => b.memoryStrength - a.memoryStrength);
}

function buildOverview(
  outcomeRows: OutcomeRow[],
  sourceAttribution: Array<{ source: string; count: number }>,
  sourceReliability: SourceReliabilityBacktestRow[],
  agentCalibration: AgentCalibrationMemory[],
  strategyRows: Array<{
    executionSurface: string;
    status: string;
    notionalStrk: number | null;
    realizedPnlStrk: number | null;
  }>
): AnalyticsOverview {
  const bins = new Array(10).fill(null).map((_, i) => ({
    index: i,
    count: 0,
    probSum: 0,
    outcomeSum: 0,
  }));

  const timelineMap = new Map<string, { scoreSum: number; count: number }>();
  let brierSum = 0;
  let logLossSum = 0;
  let sharpnessSum = 0;
  let predictedSum = 0;
  let outcomeSum = 0;
  for (const row of outcomeRows) {
    const p = Math.max(0, Math.min(1, row.probability));
    const o = row.outcome === 1 ? 1 : 0;
    const brier = (p - o) * (p - o);
    const pClamped = Math.max(1e-6, Math.min(1 - 1e-6, p));
    const logLoss = -(o * Math.log(pClamped) + (1 - o) * Math.log(1 - pClamped));

    const binIndex = Math.min(9, Math.floor(p * 10));
    const bin = bins[binIndex];
    bin.count += 1;
    bin.probSum += p;
    bin.outcomeSum += o;

    const day = new Date(row.createdAt * 1000).toISOString().slice(0, 10);
    const t = timelineMap.get(day) ?? { scoreSum: 0, count: 0 };
    t.scoreSum += brier;
    t.count += 1;
    timelineMap.set(day, t);

    brierSum += brier;
    logLossSum += logLoss;
    sharpnessSum += Math.abs(p - 0.5) * 2;
    predictedSum += p;
    outcomeSum += o;
  }

  const calibration = bins
    .filter((b) => b.count > 0)
    .map((b) => ({
      binStart: b.index / 10,
      binEnd: (b.index + 1) / 10,
      avgPredicted: b.probSum / b.count,
      observedRate: b.outcomeSum / b.count,
      count: b.count,
    }));

  const brierTimeline = [...timelineMap.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([day, t]) => ({
      day,
      brier: t.scoreSum / t.count,
      count: t.count,
    }));

  const forecastCount = outcomeRows.length;
  const avgOutcome = forecastCount > 0 ? outcomeSum / forecastCount : 0.5;
  const baselineBrier =
    forecastCount > 0
      ? outcomeRows.reduce((sum, row) => {
          const outcome = row.outcome === 1 ? 1 : 0;
          const delta = avgOutcome - outcome;
          return sum + delta * delta;
        }, 0) / forecastCount
      : 0;
  const avgBrier = forecastCount > 0 ? brierSum / forecastCount : 0;
  const avgLogLoss = forecastCount > 0 ? logLossSum / forecastCount : 0;
  const sharpness = forecastCount > 0 ? sharpnessSum / forecastCount : 0;
  const avgPredicted = forecastCount > 0 ? predictedSum / forecastCount : 0.5;
  const calibrationGap = Math.abs(avgPredicted - avgOutcome);
  const brierSkillScore =
    baselineBrier > 0 ? 1 - avgBrier / baselineBrier : 0;

  const bySurfaceMap = new Map<string, { executions: number; success: number }>();
  let totalExecutions = 0;
  let success = 0;
  let deployedCapitalStrk = 0;
  let realizedPnlStrk = 0;
  for (const row of strategyRows) {
    totalExecutions += 1;
    if (row.status === "success") success += 1;
    deployedCapitalStrk += row.notionalStrk ?? 0;
    realizedPnlStrk += row.realizedPnlStrk ?? 0;

    const current = bySurfaceMap.get(row.executionSurface) ?? { executions: 0, success: 0 };
    current.executions += 1;
    if (row.status === "success") current.success += 1;
    bySurfaceMap.set(row.executionSurface, current);
  }

  return {
    calibration,
    brierTimeline,
    sourceAttribution,
    sourceReliability,
    agentCalibration,
    forecastQuality: {
      avgBrier,
      avgLogLoss,
      sharpness,
      calibrationGap,
      brierSkillScore,
    },
    strategy: {
      totalExecutions,
      successRate: totalExecutions > 0 ? success / totalExecutions : 0,
      deployedCapitalStrk,
      realizedPnlStrk,
      bySurface: [...bySurfaceMap.entries()].map(([executionSurface, v]) => ({
        executionSurface,
        executions: v.executions,
        successRate: v.executions > 0 ? v.success / v.executions : 0,
      })),
    },
  };
}

function buildModelCalibration(outcomeRows: OutcomeRow[]): ModelCalibrationRow[] {
  const groups = new Map<
    string,
    {
      modelName: string;
      agentId: string;
      count: number;
      brierSum: number;
      probSum: number;
      outcomeSum: number;
    }
  >();

  for (const row of outcomeRows) {
    const modelName = row.modelName ?? "unknown";
    const agentId = row.agentId ?? "unknown";
    const key = `${modelName}::${agentId}`;
    const current = groups.get(key) ?? {
      modelName,
      agentId,
      count: 0,
      brierSum: 0,
      probSum: 0,
      outcomeSum: 0,
    };
    const p = Math.max(0, Math.min(1, row.probability));
    const o = row.outcome === 1 ? 1 : 0;
    const brier = (p - o) * (p - o);
    current.count += 1;
    current.brierSum += brier;
    current.probSum += p;
    current.outcomeSum += o;
    groups.set(key, current);
  }

  return [...groups.values()]
    .map((g) => {
      const avgPred = g.probSum / g.count;
      const obs = g.outcomeSum / g.count;
      return {
        modelName: g.modelName,
        agentId: g.agentId,
        forecasts: g.count,
        brier: g.brierSum / g.count,
        calibrationGap: Math.abs(avgPred - obs),
      };
    })
    .sort((a, b) => a.brier - b.brier);
}

async function getJoinedOutcomeRows(organizationId: string): Promise<OutcomeRow[]> {
  const prisma = await getPrismaClient();
  if (prisma) {
    const rows = (await prisma.$queryRawUnsafe(
      `
      SELECT
        f.probability as "probability",
        mo.outcome as "outcome",
        f.created_at as "createdAt",
        f.model_name as "modelName",
        f.agent_id as "agentId"
      FROM forecasts f
      JOIN market_outcomes mo
        ON mo.org_id = f.org_id
       AND mo.market_id = f.market_id
      WHERE f.org_id = $1
      `,
      organizationId
    )) as OutcomeRow[];
    return rows;
  }

  return db
    .prepare(
      `
      SELECT
        f.probability as probability,
        mo.outcome as outcome,
        f.created_at as createdAt,
        f.model_name as modelName,
        f.agent_id as agentId
      FROM forecasts f
      JOIN market_outcomes mo
        ON mo.org_id = f.org_id
       AND mo.market_id = f.market_id
      WHERE f.org_id = ?
      `
    )
    .all(organizationId) as OutcomeRow[];
}

async function getJoinedSourceOutcomeRows(
  organizationId: string
): Promise<SourceOutcomeRow[]> {
  const prisma = await getPrismaClient();
  if (prisma) {
    const rows = (await prisma.$queryRawUnsafe(
      `
      SELECT
        rs.source_type as "sourceType",
        f.market_id as "marketId",
        f.probability as "probability",
        mo.outcome as "outcome",
        f.created_at as "createdAt"
      FROM forecasts f
      JOIN market_outcomes mo
        ON mo.org_id = f.org_id
       AND mo.market_id = f.market_id
      JOIN (
        SELECT DISTINCT org_id, market_id, source_type
        FROM research_artifacts
        WHERE org_id = $1
      ) rs
        ON rs.org_id = f.org_id
       AND rs.market_id = f.market_id
      WHERE f.org_id = $1
      `,
      organizationId
    )) as SourceOutcomeRow[];
    return rows;
  }

  return db
    .prepare(
      `
      SELECT
        rs.source_type as sourceType,
        f.market_id as marketId,
        f.probability as probability,
        mo.outcome as outcome,
        f.created_at as createdAt
      FROM forecasts f
      JOIN market_outcomes mo
        ON mo.org_id = f.org_id
       AND mo.market_id = f.market_id
      JOIN (
        SELECT DISTINCT org_id, market_id, source_type
        FROM research_artifacts
        WHERE org_id = ?
      ) rs
        ON rs.org_id = f.org_id
       AND rs.market_id = f.market_id
      WHERE f.org_id = ?
      `
    )
    .all(organizationId, organizationId) as SourceOutcomeRow[];
}

export async function recordForecast(params: {
  organizationId: string;
  marketId: number;
  userId?: string;
  agentId?: string;
  probability: number;
  confidence?: number;
  rationale?: string;
  modelName?: string;
}) {
  const prisma = await getPrismaClient();
  if (prisma) {
    await prisma.forecast.create({
      data: {
        id: makeId("fcst"),
        orgId: params.organizationId,
        marketId: params.marketId,
        userId: params.userId ?? null,
        agentId: params.agentId ?? null,
        probability: params.probability,
        confidence: params.confidence ?? null,
        rationale: params.rationale ?? null,
        modelName: params.modelName ?? null,
        createdAt: nowUnix(),
      },
    });
    return;
  }

  db.prepare(
    `
    INSERT INTO forecasts (
      id, org_id, market_id, user_id, agent_id, probability, confidence, rationale, model_name, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    makeId("fcst"),
    params.organizationId,
    params.marketId,
    params.userId ?? null,
    params.agentId ?? null,
    params.probability,
    params.confidence ?? null,
    params.rationale ?? null,
    params.modelName ?? null,
    nowUnix()
  );
}

export async function recordResearchArtifact(params: {
  organizationId: string;
  marketId?: number;
  sourceType: string;
  sourceUrl?: string;
  title?: string;
  summary?: string;
  payloadJson?: string;
}) {
  const prisma = await getPrismaClient();
  if (prisma) {
    await prisma.researchArtifact.create({
      data: {
        id: makeId("rsch"),
        orgId: params.organizationId,
        marketId: params.marketId ?? null,
        sourceType: params.sourceType,
        sourceUrl: params.sourceUrl ?? null,
        title: params.title ?? null,
        summary: params.summary ?? null,
        payloadJson: params.payloadJson ?? null,
        createdAt: nowUnix(),
      },
    });
    return;
  }

  db.prepare(
    `
    INSERT INTO research_artifacts (
      id, org_id, market_id, source_type, source_url, title, summary, payload_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    makeId("rsch"),
    params.organizationId,
    params.marketId ?? null,
    params.sourceType,
    params.sourceUrl ?? null,
    params.title ?? null,
    params.summary ?? null,
    params.payloadJson ?? null,
    nowUnix()
  );
}

export async function recordTradeExecution(params: {
  organizationId: string;
  marketId: number;
  userId?: string;
  executionSurface: string;
  txHash?: string;
  status: string;
  errorCode?: string;
  errorMessage?: string;
  notionalStrk?: number;
  realizedPnlStrk?: number;
}) {
  const prisma = await getPrismaClient();
  if (prisma) {
    await prisma.tradeExecution.create({
      data: {
        id: makeId("exec"),
        orgId: params.organizationId,
        marketId: params.marketId,
        userId: params.userId ?? null,
        executionSurface: params.executionSurface,
        txHash: params.txHash ?? null,
        status: params.status,
        errorCode: params.errorCode ?? null,
        errorMessage: params.errorMessage ?? null,
        notionalStrk: params.notionalStrk ?? null,
        realizedPnlStrk: params.realizedPnlStrk ?? null,
        createdAt: nowUnix(),
      },
    });
    return;
  }

  db.prepare(
    `
    INSERT INTO trade_executions (
      id, org_id, market_id, user_id, execution_surface, tx_hash, status, error_code, error_message, notional_strk, realized_pnl_strk, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    makeId("exec"),
    params.organizationId,
    params.marketId,
    params.userId ?? null,
    params.executionSurface,
    params.txHash ?? null,
    params.status,
    params.errorCode ?? null,
    params.errorMessage ?? null,
    params.notionalStrk ?? null,
    params.realizedPnlStrk ?? null,
    nowUnix()
  );
}

export async function recordAudit(params: {
  organizationId?: string;
  userId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}) {
  const prisma = await getPrismaClient();
  if (prisma) {
    await prisma.auditLog.create({
      data: {
        id: makeId("audit"),
        orgId: params.organizationId ?? null,
        userId: params.userId ?? null,
        action: params.action,
        targetType: params.targetType ?? null,
        targetId: params.targetId ?? null,
        metadataJson: params.metadata ? JSON.stringify(params.metadata) : null,
        createdAt: nowUnix(),
      },
    });
    return;
  }

  db.prepare(
    `
    INSERT INTO audit_logs (
      id, org_id, user_id, action, target_type, target_id, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    makeId("audit"),
    params.organizationId ?? null,
    params.userId ?? null,
    params.action,
    params.targetType ?? null,
    params.targetId ?? null,
    params.metadata ? JSON.stringify(params.metadata) : null,
    nowUnix()
  );
}

export async function recordMarketOutcome(params: {
  organizationId: string;
  marketId: number;
  outcome: 0 | 1;
}) {
  const prisma = await getPrismaClient();
  if (prisma) {
    await prisma.marketOutcome.upsert({
      where: {
        orgId_marketId: {
          orgId: params.organizationId,
          marketId: params.marketId,
        },
      },
      update: {
        outcome: params.outcome,
        finalizedAt: nowUnix(),
      },
      create: {
        id: makeId("out"),
        orgId: params.organizationId,
        marketId: params.marketId,
        outcome: params.outcome,
        finalizedAt: nowUnix(),
      },
    });
    return;
  }

  db.prepare(
    `
    INSERT INTO market_outcomes (id, org_id, market_id, outcome, finalized_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(org_id, market_id) DO UPDATE SET
      outcome = excluded.outcome,
      finalized_at = excluded.finalized_at
    `
  ).run(
    makeId("out"),
    params.organizationId,
    params.marketId,
    params.outcome,
    nowUnix()
  );
}

export async function getAnalyticsOverview(
  organizationId: string
): Promise<AnalyticsOverview> {
  const prisma = await getPrismaClient();
  const [outcomeRows, sourceReliability] = await Promise.all([
    getJoinedOutcomeRows(organizationId),
    listSourceReliabilityBacktests(organizationId),
  ]);
  const agentCalibration = buildAgentCalibrationMemoriesFromOutcomes(
    outcomeRows
  ).slice(0, 10);

  if (prisma) {
    const [sourceRows, strategyRows] = await Promise.all([
      prisma.researchArtifact.groupBy({
        by: ["sourceType"],
        where: { orgId: organizationId },
        _count: { _all: true },
        orderBy: { _count: { sourceType: "desc" } },
      }),
      prisma.tradeExecution.findMany({
        where: { orgId: organizationId },
        select: {
          executionSurface: true,
          status: true,
          notionalStrk: true,
          realizedPnlStrk: true,
        },
      }),
    ]);

    const sourceAttribution = sourceRows.map((r: any) => ({
      source: r.sourceType,
      count: r._count?._all ?? 0,
    }));

    return buildOverview(
      outcomeRows,
      sourceAttribution,
      sourceReliability,
      agentCalibration,
      strategyRows.map((r: any) => ({
        executionSurface: r.executionSurface,
        status: r.status,
        notionalStrk: r.notionalStrk ?? null,
        realizedPnlStrk: r.realizedPnlStrk ?? null,
      }))
    );
  }

  const sourceAttribution = db
    .prepare(
      `
      SELECT source_type as source, COUNT(*) as count
      FROM research_artifacts
      WHERE org_id = ?
      GROUP BY source_type
      ORDER BY count DESC
      `
    )
    .all(organizationId) as Array<{ source: string; count: number }>;

  const strategyRows = db
    .prepare(
      `
      SELECT
        execution_surface as executionSurface,
        status,
        notional_strk as notionalStrk,
        realized_pnl_strk as realizedPnlStrk
      FROM trade_executions
      WHERE org_id = ?
      `
    )
    .all(organizationId) as Array<{
    executionSurface: string;
    status: string;
    notionalStrk: number | null;
    realizedPnlStrk: number | null;
  }>;

  return buildOverview(
    outcomeRows,
    sourceAttribution,
    sourceReliability,
    agentCalibration,
    strategyRows
  );
}

export async function getModelCalibrationComparison(
  organizationId: string
): Promise<ModelCalibrationRow[]> {
  const outcomeRows = await getJoinedOutcomeRows(organizationId);
  return buildModelCalibration(outcomeRows);
}

export async function listSourceReliabilityBacktests(
  organizationId: string
): Promise<SourceReliabilityBacktestRow[]> {
  const sourceRows = await getJoinedSourceOutcomeRows(organizationId);
  return buildSourceReliabilityBacktests(sourceRows);
}

export async function getSourceReliabilityProfile(
  organizationId: string
): Promise<Record<string, SourceReliabilityBacktestRow>> {
  const rows = await listSourceReliabilityBacktests(organizationId);
  return rows.reduce(
    (acc, row) => {
      acc[row.source] = row;
      return acc;
    },
    {} as Record<string, SourceReliabilityBacktestRow>
  );
}

export async function listAgentCalibrationMemories(
  organizationId: string,
  limit = 12
): Promise<AgentCalibrationMemory[]> {
  const rows = buildAgentCalibrationMemoriesFromOutcomes(
    await getJoinedOutcomeRows(organizationId)
  );
  const finalLimit = Math.min(100, Math.max(1, limit));
  return rows.slice(0, finalLimit);
}

export async function getAgentCalibrationMemory(
  organizationId: string,
  agentId: string
): Promise<AgentCalibrationMemory> {
  const normalizedAgentId = agentId.trim();
  if (!normalizedAgentId) {
    return normalizeAgentMemory({
      agentId: "unknown",
      samples: 0,
      avgBrier: 0.25,
      calibrationBias: 0,
    });
  }

  const outcomeRows = await getJoinedOutcomeRows(organizationId);
  const matching = outcomeRows.filter(
    (row) => (row.agentId ?? "").trim() === normalizedAgentId
  );

  if (matching.length === 0) {
    return normalizeAgentMemory({
      agentId: normalizedAgentId,
      samples: 0,
      avgBrier: 0.25,
      calibrationBias: 0,
    });
  }

  const summary = matching.reduce(
    (acc, row) => {
      const p = Math.max(0, Math.min(1, row.probability));
      const o = row.outcome === 1 ? 1 : 0;
      const error = p - o;
      acc.samples += 1;
      acc.brierSum += error * error;
      acc.biasSum += error;
      return acc;
    },
    { samples: 0, brierSum: 0, biasSum: 0 }
  );

  return normalizeAgentMemory({
    agentId: normalizedAgentId,
    samples: summary.samples,
    avgBrier: summary.samples > 0 ? summary.brierSum / summary.samples : 0.25,
    calibrationBias: summary.samples > 0 ? summary.biasSum / summary.samples : 0,
  });
}

export async function listRecentForecasts(organizationId: string, limit = 100) {
  const prisma = await getPrismaClient();
  const finalLimit = Math.min(500, Math.max(1, limit));

  if (prisma) {
    return prisma.forecast.findMany({
      where: { orgId: organizationId },
      orderBy: { createdAt: "desc" },
      take: finalLimit,
      select: {
        id: true,
        marketId: true,
        userId: true,
        agentId: true,
        probability: true,
        confidence: true,
        modelName: true,
        createdAt: true,
      },
    });
  }

  return db
    .prepare(
      `
      SELECT
        id,
        market_id as marketId,
        user_id as userId,
        agent_id as agentId,
        probability,
        confidence,
        model_name as modelName,
        created_at as createdAt
      FROM forecasts
      WHERE org_id = ?
      ORDER BY created_at DESC
      LIMIT ?
      `
    )
    .all(organizationId, finalLimit);
}

export async function listRecentResearchArtifacts(
  organizationId: string,
  limit = 100
) {
  const prisma = await getPrismaClient();
  const finalLimit = Math.min(500, Math.max(1, limit));

  if (prisma) {
    return prisma.researchArtifact.findMany({
      where: { orgId: organizationId },
      orderBy: { createdAt: "desc" },
      take: finalLimit,
      select: {
        id: true,
        marketId: true,
        sourceType: true,
        sourceUrl: true,
        title: true,
        summary: true,
        createdAt: true,
      },
    });
  }

  return db
    .prepare(
      `
      SELECT
        id,
        market_id as marketId,
        source_type as sourceType,
        source_url as sourceUrl,
        title,
        summary,
        created_at as createdAt
      FROM research_artifacts
      WHERE org_id = ?
      ORDER BY created_at DESC
      LIMIT ?
      `
    )
    .all(organizationId, finalLimit);
}

export async function listRecentExecutions(organizationId: string, limit = 100) {
  const prisma = await getPrismaClient();
  const finalLimit = Math.min(500, Math.max(1, limit));

  if (prisma) {
    return prisma.tradeExecution.findMany({
      where: { orgId: organizationId },
      orderBy: { createdAt: "desc" },
      take: finalLimit,
      select: {
        id: true,
        marketId: true,
        userId: true,
        executionSurface: true,
        txHash: true,
        status: true,
        errorCode: true,
        errorMessage: true,
        notionalStrk: true,
        realizedPnlStrk: true,
        createdAt: true,
      },
    });
  }

  return db
    .prepare(
      `
      SELECT
        id,
        market_id as marketId,
        user_id as userId,
        execution_surface as executionSurface,
        tx_hash as txHash,
        status,
        error_code as errorCode,
        error_message as errorMessage,
        notional_strk as notionalStrk,
        realized_pnl_strk as realizedPnlStrk,
        created_at as createdAt
      FROM trade_executions
      WHERE org_id = ?
      ORDER BY created_at DESC
      LIMIT ?
      `
    )
    .all(organizationId, finalLimit);
}
