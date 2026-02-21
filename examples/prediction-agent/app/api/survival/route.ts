/**
 * GET /api/survival — Returns the current survival state as JSON.
 * Used by the SurvivalDashboard component and external agents.
 */

import { getSurvivalState } from "@/lib/survival-engine";
import { agentLoop } from "@/lib/agent-loop";

export async function GET() {
  const status = agentLoop.getStatus();
  const survival = await getSurvivalState(status.tickCount);

  return new Response(JSON.stringify(survival, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value
  ), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
