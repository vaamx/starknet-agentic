import { randomBytes } from "node:crypto";
import { db, nowUnix } from "./db";
import { getPrismaClient } from "./prisma";
import type { ExecutionSurface } from "./starknet-executor";

export type AutomationPolicyStatus =
  | "active"
  | "paused"
  | "stop_loss"
  | "budget_exhausted";

export type AutomationSignalSide = "yes" | "no";

export interface AutomationPolicyRecord {
  id: string;
  organizationId: string;
  userId: string;
  marketId: number;
  enabled: boolean;
  status: AutomationPolicyStatus;
  cadenceMinutes: number;
  maxStakeStrk: number;
  riskLimitStrk: number;
  stopLossPct: number;
  confidenceThreshold: number;
  preferredSurface: ExecutionSurface;
  allowFallbackToDirect: boolean;
  lastRunAt: number | null;
  nextRunAt: number | null;
  lastSignalSide: AutomationSignalSide | null;
  lastSignalProb: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface AutomationRunRecord {
  id: string;
  policyId: string;
  organizationId: string;
  userId: string;
  marketId: number;
  scheduledFor: number;
  executedAt: number;
  status: "success" | "error" | "skipped";
  executionSurface: ExecutionSurface | null;
  amountStrk: number | null;
  side: 0 | 1 | null;
  probability: number | null;
  txHash: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  realizedPnlStrk: number | null;
  metadataJson: string | null;
}

export interface AutomationRunSummary {
  runCount: number;
  successfulRuns: number;
  stakeSpentStrk: number;
  realizedPnlStrk: number;
  lastExecutedAt: number | null;
}

interface AutomationPolicyRow {
  id: string;
  organizationId: string;
  userId: string;
  marketId: number;
  enabled: number | boolean;
  status: string;
  cadenceMinutes: number;
  maxStakeStrk: number;
  riskLimitStrk: number;
  stopLossPct: number;
  confidenceThreshold: number;
  preferredSurface: string;
  allowFallbackToDirect: number | boolean;
  lastRunAt: number | null;
  nextRunAt: number | null;
  lastSignalSide: string | null;
  lastSignalProb: number | null;
  createdAt: number;
  updatedAt: number;
}

interface UpsertAutomationPolicyInput {
  organizationId: string;
  userId: string;
  marketId: number;
  enabled: boolean;
  cadenceMinutes: number;
  maxStakeStrk: number;
  riskLimitStrk: number;
  stopLossPct: number;
  confidenceThreshold: number;
  preferredSurface: ExecutionSurface;
  allowFallbackToDirect: boolean;
  status?: AutomationPolicyStatus;
}

function makeId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toBool(value: number | boolean): boolean {
  if (typeof value === "boolean") return value;
  return value === 1;
}

function normalizeSurface(value: string): ExecutionSurface {
  if (value === "starkzap" || value === "avnu" || value === "direct") {
    return value;
  }
  return "starkzap";
}

function normalizeStatus(value: string): AutomationPolicyStatus {
  if (
    value === "active" ||
    value === "paused" ||
    value === "stop_loss" ||
    value === "budget_exhausted"
  ) {
    return value;
  }
  return "active";
}

function normalizeSignalSide(value: string | null): AutomationSignalSide | null {
  if (value === "yes" || value === "no") return value;
  return null;
}

function normalizePolicyRow(row: AutomationPolicyRow): AutomationPolicyRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    marketId: row.marketId,
    enabled: toBool(row.enabled),
    status: normalizeStatus(row.status),
    cadenceMinutes: clamp(Math.round(row.cadenceMinutes), 5, 1440),
    maxStakeStrk: clamp(Number(row.maxStakeStrk ?? 5), 0.1, 1_000_000),
    riskLimitStrk: clamp(Number(row.riskLimitStrk ?? 25), 0.1, 1_000_000),
    stopLossPct: clamp(Number(row.stopLossPct ?? 20), 1, 99),
    confidenceThreshold: clamp(Number(row.confidenceThreshold ?? 0.12), 0.01, 0.49),
    preferredSurface: normalizeSurface(row.preferredSurface),
    allowFallbackToDirect: toBool(row.allowFallbackToDirect),
    lastRunAt:
      typeof row.lastRunAt === "number" && Number.isFinite(row.lastRunAt)
        ? row.lastRunAt
        : null,
    nextRunAt:
      typeof row.nextRunAt === "number" && Number.isFinite(row.nextRunAt)
        ? row.nextRunAt
        : null,
    lastSignalSide: normalizeSignalSide(row.lastSignalSide),
    lastSignalProb:
      typeof row.lastSignalProb === "number" && Number.isFinite(row.lastSignalProb)
        ? clamp(row.lastSignalProb, 0, 1)
        : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function sanitizePolicyInput(
  input: UpsertAutomationPolicyInput
): UpsertAutomationPolicyInput {
  const normalizedMaxStake = clamp(Number(input.maxStakeStrk), 0.1, 1_000_000);
  const normalizedRiskLimit = clamp(
    Number(input.riskLimitStrk),
    normalizedMaxStake,
    1_000_000
  );
  return {
    ...input,
    cadenceMinutes: clamp(Math.round(Number(input.cadenceMinutes)), 5, 1440),
    maxStakeStrk: normalizedMaxStake,
    riskLimitStrk: normalizedRiskLimit,
    stopLossPct: clamp(Number(input.stopLossPct), 1, 99),
    confidenceThreshold: clamp(Number(input.confidenceThreshold), 0.01, 0.49),
    preferredSurface: normalizeSurface(input.preferredSurface),
    status: input.status ? normalizeStatus(input.status) : undefined,
  };
}

function nextRunFromCadence(
  nowSec: number,
  cadenceMinutes: number,
  enabled: boolean,
  status: AutomationPolicyStatus
): number | null {
  if (!enabled || status !== "active") return null;
  return nowSec + cadenceMinutes * 60;
}

export async function listAutomationPolicies(
  organizationId: string,
  userId: string
): Promise<AutomationPolicyRecord[]> {
  const prisma = await getPrismaClient();
  if (prisma) {
    const rows = await prisma.automationPolicy.findMany({
      where: { orgId: organizationId, userId },
      orderBy: { updatedAt: "desc" },
    });
    return rows.map((row: any) =>
      normalizePolicyRow({
        id: row.id,
        organizationId: row.orgId,
        userId: row.userId,
        marketId: row.marketId,
        enabled: row.enabled,
        status: row.status,
        cadenceMinutes: row.cadenceMinutes,
        maxStakeStrk: row.maxStakeStrk,
        riskLimitStrk: row.riskLimitStrk,
        stopLossPct: row.stopLossPct,
        confidenceThreshold: row.confidenceThreshold,
        preferredSurface: row.preferredSurface,
        allowFallbackToDirect: row.allowFallbackToDirect,
        lastRunAt: row.lastRunAt,
        nextRunAt: row.nextRunAt,
        lastSignalSide: row.lastSignalSide,
        lastSignalProb: row.lastSignalProb,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })
    );
  }

  const rows = db
    .prepare(
      `
      SELECT
        id,
        org_id as organizationId,
        user_id as userId,
        market_id as marketId,
        enabled,
        status,
        cadence_minutes as cadenceMinutes,
        max_stake_strk as maxStakeStrk,
        risk_limit_strk as riskLimitStrk,
        stop_loss_pct as stopLossPct,
        confidence_threshold as confidenceThreshold,
        preferred_surface as preferredSurface,
        allow_fallback_to_direct as allowFallbackToDirect,
        last_run_at as lastRunAt,
        next_run_at as nextRunAt,
        last_signal_side as lastSignalSide,
        last_signal_prob as lastSignalProb,
        created_at as createdAt,
        updated_at as updatedAt
      FROM automation_policies
      WHERE org_id = ? AND user_id = ?
      ORDER BY updated_at DESC
      `
    )
    .all(organizationId, userId) as AutomationPolicyRow[];

  return rows.map(normalizePolicyRow);
}

export async function getAutomationPolicy(
  organizationId: string,
  userId: string,
  marketId: number
): Promise<AutomationPolicyRecord | null> {
  const prisma = await getPrismaClient();
  if (prisma) {
    const row = await prisma.automationPolicy.findUnique({
      where: {
        orgId_userId_marketId: {
          orgId: organizationId,
          userId,
          marketId,
        },
      },
    });
    if (!row) return null;
    return normalizePolicyRow({
      id: row.id,
      organizationId: row.orgId,
      userId: row.userId,
      marketId: row.marketId,
      enabled: row.enabled,
      status: row.status,
      cadenceMinutes: row.cadenceMinutes,
      maxStakeStrk: row.maxStakeStrk,
      riskLimitStrk: row.riskLimitStrk,
      stopLossPct: row.stopLossPct,
      confidenceThreshold: row.confidenceThreshold,
      preferredSurface: row.preferredSurface,
      allowFallbackToDirect: row.allowFallbackToDirect,
      lastRunAt: row.lastRunAt,
      nextRunAt: row.nextRunAt,
      lastSignalSide: row.lastSignalSide,
      lastSignalProb: row.lastSignalProb,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  const row = db
    .prepare(
      `
      SELECT
        id,
        org_id as organizationId,
        user_id as userId,
        market_id as marketId,
        enabled,
        status,
        cadence_minutes as cadenceMinutes,
        max_stake_strk as maxStakeStrk,
        risk_limit_strk as riskLimitStrk,
        stop_loss_pct as stopLossPct,
        confidence_threshold as confidenceThreshold,
        preferred_surface as preferredSurface,
        allow_fallback_to_direct as allowFallbackToDirect,
        last_run_at as lastRunAt,
        next_run_at as nextRunAt,
        last_signal_side as lastSignalSide,
        last_signal_prob as lastSignalProb,
        created_at as createdAt,
        updated_at as updatedAt
      FROM automation_policies
      WHERE org_id = ? AND user_id = ? AND market_id = ?
      LIMIT 1
      `
    )
    .get(organizationId, userId, marketId) as AutomationPolicyRow | undefined;

  return row ? normalizePolicyRow(row) : null;
}

export async function upsertAutomationPolicy(
  input: UpsertAutomationPolicyInput
): Promise<AutomationPolicyRecord> {
  const nowSec = nowUnix();
  const normalized = sanitizePolicyInput(input);
  const existing = await getAutomationPolicy(
    normalized.organizationId,
    normalized.userId,
    normalized.marketId
  );

  const enabled = normalized.enabled;
  const status: AutomationPolicyStatus =
    normalized.status ?? (enabled ? "active" : "paused");
  const nextRunAt = nextRunFromCadence(
    nowSec,
    normalized.cadenceMinutes,
    enabled,
    status
  );

  const id = existing?.id ?? makeId("auto");
  const createdAt = existing?.createdAt ?? nowSec;
  const lastRunAt = existing?.lastRunAt ?? null;
  const lastSignalSide = existing?.lastSignalSide ?? null;
  const lastSignalProb = existing?.lastSignalProb ?? null;

  const prisma = await getPrismaClient();
  if (prisma) {
    const row = await prisma.automationPolicy.upsert({
      where: {
        orgId_userId_marketId: {
          orgId: normalized.organizationId,
          userId: normalized.userId,
          marketId: normalized.marketId,
        },
      },
      update: {
        enabled,
        status,
        cadenceMinutes: normalized.cadenceMinutes,
        maxStakeStrk: normalized.maxStakeStrk,
        riskLimitStrk: normalized.riskLimitStrk,
        stopLossPct: normalized.stopLossPct,
        confidenceThreshold: normalized.confidenceThreshold,
        preferredSurface: normalized.preferredSurface,
        allowFallbackToDirect: normalized.allowFallbackToDirect,
        nextRunAt,
        updatedAt: nowSec,
      },
      create: {
        id,
        orgId: normalized.organizationId,
        userId: normalized.userId,
        marketId: normalized.marketId,
        enabled,
        status,
        cadenceMinutes: normalized.cadenceMinutes,
        maxStakeStrk: normalized.maxStakeStrk,
        riskLimitStrk: normalized.riskLimitStrk,
        stopLossPct: normalized.stopLossPct,
        confidenceThreshold: normalized.confidenceThreshold,
        preferredSurface: normalized.preferredSurface,
        allowFallbackToDirect: normalized.allowFallbackToDirect,
        lastRunAt,
        nextRunAt,
        lastSignalSide,
        lastSignalProb,
        createdAt,
        updatedAt: nowSec,
      },
    });

    return normalizePolicyRow({
      id: row.id,
      organizationId: row.orgId,
      userId: row.userId,
      marketId: row.marketId,
      enabled: row.enabled,
      status: row.status,
      cadenceMinutes: row.cadenceMinutes,
      maxStakeStrk: row.maxStakeStrk,
      riskLimitStrk: row.riskLimitStrk,
      stopLossPct: row.stopLossPct,
      confidenceThreshold: row.confidenceThreshold,
      preferredSurface: row.preferredSurface,
      allowFallbackToDirect: row.allowFallbackToDirect,
      lastRunAt: row.lastRunAt,
      nextRunAt: row.nextRunAt,
      lastSignalSide: row.lastSignalSide,
      lastSignalProb: row.lastSignalProb,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  db.prepare(
    `
    INSERT INTO automation_policies (
      id,
      org_id,
      user_id,
      market_id,
      enabled,
      status,
      cadence_minutes,
      max_stake_strk,
      risk_limit_strk,
      stop_loss_pct,
      confidence_threshold,
      preferred_surface,
      allow_fallback_to_direct,
      last_run_at,
      next_run_at,
      last_signal_side,
      last_signal_prob,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(org_id, user_id, market_id) DO UPDATE SET
      enabled = excluded.enabled,
      status = excluded.status,
      cadence_minutes = excluded.cadence_minutes,
      max_stake_strk = excluded.max_stake_strk,
      risk_limit_strk = excluded.risk_limit_strk,
      stop_loss_pct = excluded.stop_loss_pct,
      confidence_threshold = excluded.confidence_threshold,
      preferred_surface = excluded.preferred_surface,
      allow_fallback_to_direct = excluded.allow_fallback_to_direct,
      next_run_at = excluded.next_run_at,
      updated_at = excluded.updated_at
    `
  ).run(
    id,
    normalized.organizationId,
    normalized.userId,
    normalized.marketId,
    enabled ? 1 : 0,
    status,
    normalized.cadenceMinutes,
    normalized.maxStakeStrk,
    normalized.riskLimitStrk,
    normalized.stopLossPct,
    normalized.confidenceThreshold,
    normalized.preferredSurface,
    normalized.allowFallbackToDirect ? 1 : 0,
    lastRunAt,
    nextRunAt,
    lastSignalSide,
    lastSignalProb,
    createdAt,
    nowSec
  );

  const updated = await getAutomationPolicy(
    normalized.organizationId,
    normalized.userId,
    normalized.marketId
  );
  if (!updated) {
    throw new Error("Failed to persist automation policy");
  }
  return updated;
}

export async function updateAutomationPolicyRuntime(params: {
  policyId: string;
  status?: AutomationPolicyStatus;
  lastRunAt?: number | null;
  nextRunAt?: number | null;
  lastSignalSide?: AutomationSignalSide | null;
  lastSignalProb?: number | null;
}): Promise<void> {
  const nowSec = nowUnix();
  const prisma = await getPrismaClient();

  if (prisma) {
    const updateData: Record<string, unknown> = {
      updatedAt: nowSec,
    };
    if (params.status) updateData.status = normalizeStatus(params.status);
    if (params.lastRunAt !== undefined) updateData.lastRunAt = params.lastRunAt;
    if (params.nextRunAt !== undefined) updateData.nextRunAt = params.nextRunAt;
    if (params.lastSignalSide !== undefined) {
      updateData.lastSignalSide = params.lastSignalSide;
    }
    if (params.lastSignalProb !== undefined) {
      updateData.lastSignalProb = params.lastSignalProb;
    }
    await prisma.automationPolicy.update({
      where: { id: params.policyId },
      data: updateData,
    });
    return;
  }

  const fragments: string[] = ["updated_at = ?"];
  const values: Array<number | string | null> = [nowSec];
  if (params.status) {
    fragments.push("status = ?");
    values.push(normalizeStatus(params.status));
  }
  if (params.lastRunAt !== undefined) {
    fragments.push("last_run_at = ?");
    values.push(params.lastRunAt);
  }
  if (params.nextRunAt !== undefined) {
    fragments.push("next_run_at = ?");
    values.push(params.nextRunAt);
  }
  if (params.lastSignalSide !== undefined) {
    fragments.push("last_signal_side = ?");
    values.push(params.lastSignalSide);
  }
  if (params.lastSignalProb !== undefined) {
    fragments.push("last_signal_prob = ?");
    values.push(params.lastSignalProb);
  }

  values.push(params.policyId);
  db.prepare(
    `
    UPDATE automation_policies
    SET ${fragments.join(", ")}
    WHERE id = ?
    `
  ).run(...values);
}

export async function listDueAutomationPolicies(params: {
  organizationId: string;
  userId: string;
  nowSec?: number;
  limit?: number;
}): Promise<AutomationPolicyRecord[]> {
  const nowSec = params.nowSec ?? nowUnix();
  const limit = clamp(Math.round(params.limit ?? 10), 1, 100);
  const prisma = await getPrismaClient();

  if (prisma) {
    const rows = await prisma.automationPolicy.findMany({
      where: {
        orgId: params.organizationId,
        userId: params.userId,
        enabled: true,
        status: "active",
        OR: [{ nextRunAt: null }, { nextRunAt: { lte: nowSec } }],
      },
      orderBy: [{ nextRunAt: "asc" }, { updatedAt: "asc" }],
      take: limit,
    });
    return rows.map((row: any) =>
      normalizePolicyRow({
        id: row.id,
        organizationId: row.orgId,
        userId: row.userId,
        marketId: row.marketId,
        enabled: row.enabled,
        status: row.status,
        cadenceMinutes: row.cadenceMinutes,
        maxStakeStrk: row.maxStakeStrk,
        riskLimitStrk: row.riskLimitStrk,
        stopLossPct: row.stopLossPct,
        confidenceThreshold: row.confidenceThreshold,
        preferredSurface: row.preferredSurface,
        allowFallbackToDirect: row.allowFallbackToDirect,
        lastRunAt: row.lastRunAt,
        nextRunAt: row.nextRunAt,
        lastSignalSide: row.lastSignalSide,
        lastSignalProb: row.lastSignalProb,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })
    );
  }

  const rows = db
    .prepare(
      `
      SELECT
        id,
        org_id as organizationId,
        user_id as userId,
        market_id as marketId,
        enabled,
        status,
        cadence_minutes as cadenceMinutes,
        max_stake_strk as maxStakeStrk,
        risk_limit_strk as riskLimitStrk,
        stop_loss_pct as stopLossPct,
        confidence_threshold as confidenceThreshold,
        preferred_surface as preferredSurface,
        allow_fallback_to_direct as allowFallbackToDirect,
        last_run_at as lastRunAt,
        next_run_at as nextRunAt,
        last_signal_side as lastSignalSide,
        last_signal_prob as lastSignalProb,
        created_at as createdAt,
        updated_at as updatedAt
      FROM automation_policies
      WHERE org_id = ?
        AND user_id = ?
        AND enabled = 1
        AND status = 'active'
        AND (next_run_at IS NULL OR next_run_at <= ?)
      ORDER BY COALESCE(next_run_at, 0) ASC, updated_at ASC
      LIMIT ?
      `
    )
    .all(params.organizationId, params.userId, nowSec, limit) as AutomationPolicyRow[];

  return rows.map(normalizePolicyRow);
}

export async function recordAutomationRun(params: {
  policyId: string;
  organizationId: string;
  userId: string;
  marketId: number;
  scheduledFor: number;
  executedAt?: number;
  status: "success" | "error" | "skipped";
  executionSurface?: ExecutionSurface | null;
  amountStrk?: number | null;
  side?: 0 | 1 | null;
  probability?: number | null;
  txHash?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  realizedPnlStrk?: number | null;
  metadataJson?: string | null;
}): Promise<AutomationRunRecord> {
  const executedAt = params.executedAt ?? nowUnix();
  const id = makeId("arun");
  const prisma = await getPrismaClient();

  if (prisma) {
    const row = await prisma.automationRun.create({
      data: {
        id,
        policyId: params.policyId,
        orgId: params.organizationId,
        userId: params.userId,
        marketId: params.marketId,
        scheduledFor: params.scheduledFor,
        executedAt,
        status: params.status,
        executionSurface: params.executionSurface ?? null,
        amountStrk: params.amountStrk ?? null,
        side: params.side ?? null,
        probability: params.probability ?? null,
        txHash: params.txHash ?? null,
        errorCode: params.errorCode ?? null,
        errorMessage: params.errorMessage ?? null,
        realizedPnlStrk: params.realizedPnlStrk ?? null,
        metadataJson: params.metadataJson ?? null,
      },
    });
    return {
      id: row.id,
      policyId: row.policyId,
      organizationId: row.orgId,
      userId: row.userId,
      marketId: row.marketId,
      scheduledFor: row.scheduledFor,
      executedAt: row.executedAt,
      status: row.status,
      executionSurface: row.executionSurface,
      amountStrk: row.amountStrk,
      side: row.side,
      probability: row.probability,
      txHash: row.txHash,
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
      realizedPnlStrk: row.realizedPnlStrk,
      metadataJson: row.metadataJson,
    };
  }

  db.prepare(
    `
    INSERT INTO automation_runs (
      id,
      policy_id,
      org_id,
      user_id,
      market_id,
      scheduled_for,
      executed_at,
      status,
      execution_surface,
      amount_strk,
      side,
      probability,
      tx_hash,
      error_code,
      error_message,
      realized_pnl_strk,
      metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    id,
    params.policyId,
    params.organizationId,
    params.userId,
    params.marketId,
    params.scheduledFor,
    executedAt,
    params.status,
    params.executionSurface ?? null,
    params.amountStrk ?? null,
    params.side ?? null,
    params.probability ?? null,
    params.txHash ?? null,
    params.errorCode ?? null,
    params.errorMessage ?? null,
    params.realizedPnlStrk ?? null,
    params.metadataJson ?? null
  );

  return {
    id,
    policyId: params.policyId,
    organizationId: params.organizationId,
    userId: params.userId,
    marketId: params.marketId,
    scheduledFor: params.scheduledFor,
    executedAt,
    status: params.status,
    executionSurface: params.executionSurface ?? null,
    amountStrk: params.amountStrk ?? null,
    side: params.side ?? null,
    probability: params.probability ?? null,
    txHash: params.txHash ?? null,
    errorCode: params.errorCode ?? null,
    errorMessage: params.errorMessage ?? null,
    realizedPnlStrk: params.realizedPnlStrk ?? null,
    metadataJson: params.metadataJson ?? null,
  };
}

export async function getAutomationRunSummary(
  policyId: string
): Promise<AutomationRunSummary> {
  const prisma = await getPrismaClient();
  if (prisma) {
    const rows = (await prisma.$queryRawUnsafe(
      `
      SELECT
        COUNT(*)::int as "runCount",
        COUNT(*) FILTER (WHERE status = 'success')::int as "successfulRuns",
        COALESCE(SUM(CASE WHEN status = 'success' THEN COALESCE(amount_strk, 0) ELSE 0 END), 0)::float as "stakeSpentStrk",
        COALESCE(SUM(COALESCE(realized_pnl_strk, 0)), 0)::float as "realizedPnlStrk",
        MAX(executed_at)::int as "lastExecutedAt"
      FROM automation_runs
      WHERE policy_id = $1
      `,
      policyId
    )) as Array<{
      runCount: number;
      successfulRuns: number;
      stakeSpentStrk: number;
      realizedPnlStrk: number;
      lastExecutedAt: number | null;
    }>;
    const row = rows[0];
    return {
      runCount: Number(row?.runCount ?? 0),
      successfulRuns: Number(row?.successfulRuns ?? 0),
      stakeSpentStrk: Number(row?.stakeSpentStrk ?? 0),
      realizedPnlStrk: Number(row?.realizedPnlStrk ?? 0),
      lastExecutedAt:
        typeof row?.lastExecutedAt === "number" ? row.lastExecutedAt : null,
    };
  }

  const row = db
    .prepare(
      `
      SELECT
        COUNT(*) as runCount,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successfulRuns,
        COALESCE(SUM(CASE WHEN status = 'success' THEN COALESCE(amount_strk, 0) ELSE 0 END), 0) as stakeSpentStrk,
        COALESCE(SUM(COALESCE(realized_pnl_strk, 0)), 0) as realizedPnlStrk,
        MAX(executed_at) as lastExecutedAt
      FROM automation_runs
      WHERE policy_id = ?
      `
    )
    .get(policyId) as
    | {
        runCount: number;
        successfulRuns: number;
        stakeSpentStrk: number;
        realizedPnlStrk: number;
        lastExecutedAt: number | null;
      }
    | undefined;

  return {
    runCount: Number(row?.runCount ?? 0),
    successfulRuns: Number(row?.successfulRuns ?? 0),
    stakeSpentStrk: Number(row?.stakeSpentStrk ?? 0),
    realizedPnlStrk: Number(row?.realizedPnlStrk ?? 0),
    lastExecutedAt:
      typeof row?.lastExecutedAt === "number" ? row.lastExecutedAt : null,
  };
}

export async function listRecentAutomationRuns(params: {
  organizationId: string;
  userId: string;
  marketId?: number;
  limit?: number;
}): Promise<AutomationRunRecord[]> {
  const limit = clamp(Math.round(params.limit ?? 20), 1, 200);
  const prisma = await getPrismaClient();
  const marketFilter = typeof params.marketId === "number" ? params.marketId : null;

  if (prisma) {
    const rows = await prisma.automationRun.findMany({
      where: {
        orgId: params.organizationId,
        userId: params.userId,
        ...(marketFilter !== null ? { marketId: marketFilter } : {}),
      },
      orderBy: { executedAt: "desc" },
      take: limit,
    });
    return rows.map((row: any) => ({
      id: row.id,
      policyId: row.policyId,
      organizationId: row.orgId,
      userId: row.userId,
      marketId: row.marketId,
      scheduledFor: row.scheduledFor,
      executedAt: row.executedAt,
      status: row.status,
      executionSurface: row.executionSurface,
      amountStrk: row.amountStrk,
      side: row.side,
      probability: row.probability,
      txHash: row.txHash,
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
      realizedPnlStrk: row.realizedPnlStrk,
      metadataJson: row.metadataJson,
    }));
  }

  const rows = db
    .prepare(
      `
      SELECT
        id,
        policy_id as policyId,
        org_id as organizationId,
        user_id as userId,
        market_id as marketId,
        scheduled_for as scheduledFor,
        executed_at as executedAt,
        status,
        execution_surface as executionSurface,
        amount_strk as amountStrk,
        side,
        probability,
        tx_hash as txHash,
        error_code as errorCode,
        error_message as errorMessage,
        realized_pnl_strk as realizedPnlStrk,
        metadata_json as metadataJson
      FROM automation_runs
      WHERE org_id = ?
        AND user_id = ?
        AND (? IS NULL OR market_id = ?)
      ORDER BY executed_at DESC
      LIMIT ?
      `
    )
    .all(
      params.organizationId,
      params.userId,
      marketFilter,
      marketFilter,
      limit
    ) as AutomationRunRecord[];

  return rows;
}
