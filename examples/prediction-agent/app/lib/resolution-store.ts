/**
 * Resolution Store — persistent tracking for resolution oracle attempts.
 *
 * Records each resolution attempt and manages escalation state so that
 * markets that exceed RESOLUTION_MAX_ATTEMPTS get flagged for manual review.
 */

import { randomBytes } from "node:crypto";
import { db, nowUnix } from "./db";

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

export function recordResolutionAttempt(params: {
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
}): ResolutionAttemptRecord | null {
  try {
    const now = nowUnix();
    const id = makeId("rattempt");

    // DatabaseSync is synchronous and single-threaded, so sequential
    // calls are inherently atomic within a single request.
    db.prepare(
      `INSERT INTO resolution_statuses (org_id, market_id, total_attempts, last_attempt_at, last_status, escalation)
       VALUES (?, ?, 1, ?, ?, 'auto')
       ON CONFLICT(org_id, market_id) DO UPDATE SET
         total_attempts = total_attempts + 1,
         last_attempt_at = excluded.last_attempt_at,
         last_status = excluded.last_status`
    ).run(params.orgId, params.marketId, now, params.status);

    // Read the authoritative attempt number AFTER the upsert
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

export function getResolutionStatus(
  orgId: string,
  marketId: number
): ResolutionStatusRecord | null {
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

export function listResolutionAttempts(
  orgId: string,
  marketId: number,
  limit = 20
): ResolutionAttemptRecord[] {
  const finalLimit = Math.min(100, Math.max(1, limit));
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

export function listNeedsReview(orgId: string): ResolutionStatusRecord[] {
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

export function escalateToManualReview(orgId: string, marketId: number): void {
  db.prepare(
    `UPDATE resolution_statuses SET escalation = 'needs_manual_review' WHERE org_id = ? AND market_id = ?`
  ).run(orgId, marketId);
}

export function markManuallyResolved(orgId: string, marketId: number): void {
  db.prepare(
    `UPDATE resolution_statuses SET escalation = 'manually_resolved' WHERE org_id = ? AND market_id = ?`
  ).run(orgId, marketId);
}

/** Convenience: returns both the status and the latest attempt in one call. */
export function getResolutionSummary(
  orgId: string,
  marketId: number
): { status: ResolutionStatusRecord | null; latestAttempt: ResolutionAttemptRecord | null } {
  const status = getResolutionStatus(orgId, marketId);
  const attempts = listResolutionAttempts(orgId, marketId, 1);
  return { status, latestAttempt: attempts[0] ?? null };
}
