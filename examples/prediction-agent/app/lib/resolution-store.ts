/**
 * Resolution Store — persistent tracking for resolution oracle attempts.
 *
 * Records each resolution attempt and manages escalation state so that
 * markets that exceed RESOLUTION_MAX_ATTEMPTS get flagged for manual review.
 */

import { randomBytes } from "node:crypto";
import { db, nowUnix } from "./db";
import { getPrismaClient } from "./prisma";

function makeId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

export type ResolutionEscalation = "auto" | "needs_manual_review" | "manually_resolved";

export interface ResolutionAttemptRecord {
  id: string;
  orgId: string;
  marketId: number;
  attemptNumber: number;
  strategy: string;
  status: string;
  outcome: number | null;
  confidence: number | null;
  evidence: string | null;
  reasoning: string | null;
  resolveTxHash: string | null;
  finalizeTxHash: string | null;
  errorMessage: string | null;
  createdAt: number;
}

export interface ResolutionStatusRecord {
  orgId: string;
  marketId: number;
  totalAttempts: number;
  lastAttemptAt: number | null;
  lastStatus: string | null;
  escalation: ResolutionEscalation;
}

export async function recordResolutionAttempt(params: {
  orgId: string;
  marketId: number;
  strategy: string;
  status: string;
  outcome?: number | null;
  confidence?: number | null;
  evidence?: string | null;
  reasoning?: string | null;
  resolveTxHash?: string | null;
  finalizeTxHash?: string | null;
  errorMessage?: string | null;
}): Promise<ResolutionAttemptRecord | null> {
  try {
    const now = nowUnix();
    const id = makeId("rattempt");

    const prisma = await getPrismaClient();
    if (prisma) {
      // Upsert resolution status
      const statusRow = await prisma.$queryRawUnsafe(
        `INSERT INTO resolution_statuses (org_id, market_id, total_attempts, last_attempt_at, last_status, escalation)
         VALUES ($1, $2, 1, $3, $4, 'auto')
         ON CONFLICT(org_id, market_id) DO UPDATE SET
           total_attempts = resolution_statuses.total_attempts + 1,
           last_attempt_at = $3,
           last_status = $4
         RETURNING total_attempts as "totalAttempts"`,
        params.orgId,
        params.marketId,
        now,
        params.status
      ) as Array<{ totalAttempts: number }>;

      const attemptNumber = statusRow[0]?.totalAttempts ?? 1;

      const record: ResolutionAttemptRecord = {
        id,
        orgId: params.orgId,
        marketId: params.marketId,
        attemptNumber,
        strategy: params.strategy,
        status: params.status,
        outcome: params.outcome ?? null,
        confidence: params.confidence ?? null,
        evidence: params.evidence ?? null,
        reasoning: params.reasoning ?? null,
        resolveTxHash: params.resolveTxHash ?? null,
        finalizeTxHash: params.finalizeTxHash ?? null,
        errorMessage: params.errorMessage ?? null,
        createdAt: now,
      };

      await prisma.resolutionAttempt.create({
        data: {
          id: record.id,
          orgId: record.orgId,
          marketId: record.marketId,
          attemptNumber: record.attemptNumber,
          strategy: record.strategy,
          status: record.status,
          outcome: record.outcome,
          confidence: record.confidence,
          evidence: record.evidence,
          reasoning: record.reasoning,
          resolveTxHash: record.resolveTxHash,
          finalizeTxHash: record.finalizeTxHash,
          errorMessage: record.errorMessage,
          createdAt: record.createdAt,
        },
      });

      return record;
    }

    // SQLite fallback
    db.prepare(
      `INSERT INTO resolution_statuses (org_id, market_id, total_attempts, last_attempt_at, last_status, escalation)
       VALUES (?, ?, 1, ?, ?, 'auto')
       ON CONFLICT(org_id, market_id) DO UPDATE SET
         total_attempts = total_attempts + 1,
         last_attempt_at = excluded.last_attempt_at,
         last_status = excluded.last_status`
    ).run(params.orgId, params.marketId, now, params.status);

    const row = db
      .prepare(
        `SELECT total_attempts FROM resolution_statuses WHERE org_id = ? AND market_id = ?`
      )
      .get(params.orgId, params.marketId) as { total_attempts: number };

    const attemptNumber = row.total_attempts;

    const record: ResolutionAttemptRecord = {
      id,
      orgId: params.orgId,
      marketId: params.marketId,
      attemptNumber,
      strategy: params.strategy,
      status: params.status,
      outcome: params.outcome ?? null,
      confidence: params.confidence ?? null,
      evidence: params.evidence ?? null,
      reasoning: params.reasoning ?? null,
      resolveTxHash: params.resolveTxHash ?? null,
      finalizeTxHash: params.finalizeTxHash ?? null,
      errorMessage: params.errorMessage ?? null,
      createdAt: now,
    };

    db.prepare(
      `INSERT INTO resolution_attempts (
        id, org_id, market_id, attempt_number, strategy, status, outcome,
        confidence, evidence, reasoning, resolve_tx_hash, finalize_tx_hash,
        error_message, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id,
      record.orgId,
      record.marketId,
      record.attemptNumber,
      record.strategy,
      record.status,
      record.outcome,
      record.confidence,
      record.evidence,
      record.reasoning,
      record.resolveTxHash,
      record.finalizeTxHash,
      record.errorMessage,
      record.createdAt
    );

    return record;
  } catch (err) {
    console.warn(`[resolution-store] recordResolutionAttempt failed for market ${params.marketId}:`, err);
    return null;
  }
}

export async function getResolutionStatus(
  orgId: string,
  marketId: number
): Promise<ResolutionStatusRecord | null> {
  const prisma = await getPrismaClient();
  if (prisma) {
    const row = await prisma.resolutionStatus.findUnique({
      where: { orgId_marketId: { orgId, marketId } },
    });
    if (!row) return null;
    return {
      orgId: row.orgId,
      marketId: row.marketId,
      totalAttempts: row.totalAttempts,
      lastAttemptAt: row.lastAttemptAt,
      lastStatus: row.lastStatus,
      escalation: row.escalation as ResolutionEscalation,
    };
  }

  const row = db
    .prepare(
      `SELECT
        org_id as orgId,
        market_id as marketId,
        total_attempts as totalAttempts,
        last_attempt_at as lastAttemptAt,
        last_status as lastStatus,
        escalation
      FROM resolution_statuses
      WHERE org_id = ? AND market_id = ?`
    )
    .get(orgId, marketId) as ResolutionStatusRecord | undefined;

  return row ?? null;
}

export async function listResolutionAttempts(
  orgId: string,
  marketId: number,
  limit = 20
): Promise<ResolutionAttemptRecord[]> {
  const finalLimit = Math.min(100, Math.max(1, limit));
  const prisma = await getPrismaClient();

  if (prisma) {
    const rows = await prisma.resolutionAttempt.findMany({
      where: { orgId, marketId },
      orderBy: { createdAt: "desc" },
      take: finalLimit,
    });
    return rows.map((row: any) => ({
      id: row.id,
      orgId: row.orgId,
      marketId: row.marketId,
      attemptNumber: row.attemptNumber,
      strategy: row.strategy,
      status: row.status,
      outcome: row.outcome,
      confidence: row.confidence,
      evidence: row.evidence,
      reasoning: row.reasoning,
      resolveTxHash: row.resolveTxHash,
      finalizeTxHash: row.finalizeTxHash,
      errorMessage: row.errorMessage,
      createdAt: row.createdAt,
    }));
  }

  return db
    .prepare(
      `SELECT
        id,
        org_id as orgId,
        market_id as marketId,
        attempt_number as attemptNumber,
        strategy,
        status,
        outcome,
        confidence,
        evidence,
        reasoning,
        resolve_tx_hash as resolveTxHash,
        finalize_tx_hash as finalizeTxHash,
        error_message as errorMessage,
        created_at as createdAt
      FROM resolution_attempts
      WHERE org_id = ? AND market_id = ?
      ORDER BY created_at DESC
      LIMIT ?`
    )
    .all(orgId, marketId, finalLimit) as ResolutionAttemptRecord[];
}

export async function listNeedsReview(orgId: string): Promise<ResolutionStatusRecord[]> {
  const prisma = await getPrismaClient();
  if (prisma) {
    const rows = await prisma.resolutionStatus.findMany({
      where: { orgId, escalation: "needs_manual_review" },
      orderBy: { lastAttemptAt: "desc" },
    });
    return rows.map((row: any) => ({
      orgId: row.orgId,
      marketId: row.marketId,
      totalAttempts: row.totalAttempts,
      lastAttemptAt: row.lastAttemptAt,
      lastStatus: row.lastStatus,
      escalation: row.escalation as ResolutionEscalation,
    }));
  }

  return db
    .prepare(
      `SELECT
        org_id as orgId,
        market_id as marketId,
        total_attempts as totalAttempts,
        last_attempt_at as lastAttemptAt,
        last_status as lastStatus,
        escalation
      FROM resolution_statuses
      WHERE org_id = ? AND escalation = 'needs_manual_review'
      ORDER BY last_attempt_at DESC`
    )
    .all(orgId) as ResolutionStatusRecord[];
}

export async function escalateToManualReview(orgId: string, marketId: number): Promise<void> {
  const prisma = await getPrismaClient();
  if (prisma) {
    await prisma.resolutionStatus.update({
      where: { orgId_marketId: { orgId, marketId } },
      data: { escalation: "needs_manual_review" },
    });
    return;
  }

  db.prepare(
    `UPDATE resolution_statuses SET escalation = 'needs_manual_review' WHERE org_id = ? AND market_id = ?`
  ).run(orgId, marketId);
}

export async function markManuallyResolved(orgId: string, marketId: number): Promise<void> {
  const prisma = await getPrismaClient();
  if (prisma) {
    await prisma.resolutionStatus.update({
      where: { orgId_marketId: { orgId, marketId } },
      data: { escalation: "manually_resolved" },
    });
    return;
  }

  db.prepare(
    `UPDATE resolution_statuses SET escalation = 'manually_resolved' WHERE org_id = ? AND market_id = ?`
  ).run(orgId, marketId);
}

/** Convenience: returns both the status and the latest attempt in one call. */
export async function getResolutionSummary(
  orgId: string,
  marketId: number
): Promise<{ status: ResolutionStatusRecord | null; latestAttempt: ResolutionAttemptRecord | null }> {
  const [status, attempts] = await Promise.all([
    getResolutionStatus(orgId, marketId),
    listResolutionAttempts(orgId, marketId, 1),
  ]);
  return { status, latestAttempt: attempts[0] ?? null };
}
