/**
 * POST /api/heartbeat — Authenticated external tick trigger.
 *
 * Called by the Cloudflare Worker (every 1 min) and GitHub Actions (every 5 min).
 * Validates HEARTBEAT_SECRET if configured, then triggers a single agent loop tick.
 *
 * Guards:
 *  - tickInProgress flag: prevents concurrent storms from two heartbeat sources.
 *  - Returns HTTP 200 even on tick error (avoids retry loops in the caller).
 *  - Returns HTTP 401 on secret mismatch (no retry value in hammering).
 */

import { NextRequest } from "next/server";
import { agentLoop } from "@/lib/agent-loop";
import { config } from "@/lib/config";

export const maxDuration = 60;

let tickInProgress = false;

export async function POST(request: NextRequest) {
  // ── Auth check ────────────────────────────────────────────────────────────
  if (config.HEARTBEAT_SECRET) {
    let body: { secret?: string } = {};
    try {
      body = await request.json();
    } catch {
      // malformed body
    }
    if (body.secret !== config.HEARTBEAT_SECRET) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
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
  let actions: any[] = [];
  let tickError: string | undefined;

  try {
    actions = await agentLoop.singleTick();
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
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
