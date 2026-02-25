/**
 * POST /api/heartbeat — Authenticated external tick trigger.
 *
 * Called by the Cloudflare Worker (every 1 min) and GitHub Actions (every 5 min).
 * Validates HEARTBEAT_SECRET if configured, then triggers a single agent loop tick.
 * Secret can be supplied via `x-heartbeat-secret`, `Authorization: Bearer ...`,
 * or JSON body `{ "secret": "..." }` for backward compatibility.
 *
 * Guards:
 *  - tickInProgress flag: prevents concurrent storms from two heartbeat sources.
 *  - Returns HTTP 200 even on tick error (avoids retry loops in the caller).
 *  - Returns HTTP 401 on secret mismatch (no retry value in hammering).
 */

import { NextRequest } from "next/server";
import { agentLoop } from "@/lib/agent-loop";
import { config } from "@/lib/config";
import { z } from "zod";
import { enforceRateLimit, getRequestSecret, jsonError } from "@/lib/api-guard";
import { evaluateAndDispatchMetricAlerts } from "@/lib/agent-alerting";

export const maxDuration = 60;

let tickInProgress = false;
const heartbeatBodySchema = z
  .object({
    secret: z.string().optional(),
  })
  .optional();

export async function POST(request: NextRequest) {
  const rateLimited = await enforceRateLimit(request, "heartbeat", {
    windowMs: 60_000,
    maxRequests: 40,
  });
  if (rateLimited) return rateLimited;

  let body: z.infer<typeof heartbeatBodySchema> = {};
  try {
    body = heartbeatBodySchema.parse(await request.json());
  } catch {
    body = {};
  }

  // ── Auth check ────────────────────────────────────────────────────────────
  if (config.HEARTBEAT_SECRET) {
    const providedSecret = getRequestSecret(request) ?? body?.secret ?? null;
    if (providedSecret !== config.HEARTBEAT_SECRET) {
      return jsonError("Unauthorized", 401);
    }
  }

  // ── Concurrency guard ────────────────────────────────────────────────────
  if (tickInProgress) {
    return new Response(
      JSON.stringify({ ok: false, message: "Tick in progress — skipping" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  tickInProgress = true;
  let actions: unknown[] = [];
  let tickError: string | undefined;
  let alertDispatch:
    | Awaited<ReturnType<typeof evaluateAndDispatchMetricAlerts>>
    | undefined;

  try {
    actions = await agentLoop.singleTick();
    try {
      alertDispatch = await evaluateAndDispatchMetricAlerts({
        source: "heartbeat",
      });
    } catch (alertErr: any) {
      console.error(
        "[heartbeat] alert dispatch failed:",
        alertErr?.message ?? String(alertErr)
      );
    }
  } catch (err: any) {
    tickError = err?.message ?? String(err);
    console.error("[heartbeat] singleTick failed:", tickError);
  } finally {
    tickInProgress = false;
  }

  return new Response(
    JSON.stringify({
      ok: !tickError,
      actions,
      status: agentLoop.getStatus(),
      error: tickError,
      alerts: alertDispatch
        ? {
            enabled: alertDispatch.enabled,
            sent: alertDispatch.sent,
            failed: alertDispatch.failed,
            triggered: alertDispatch.triggered,
            resolved: alertDispatch.resolved,
          }
        : undefined,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
