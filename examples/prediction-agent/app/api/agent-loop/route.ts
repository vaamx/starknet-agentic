import { NextRequest } from "next/server";
import { agentLoop } from "@/lib/agent-loop";

/**
 * Agent Loop control endpoint.
 * POST: Start/stop the autonomous loop, or trigger a single tick.
 * GET: Current loop status + recent action log.
 *
 * On Vercel serverless, use action="tick" from client-driven polling
 * instead of action="start" (which requires a long-lived process).
 */
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const body = await request.json();
  const action = body.action as string;
  const intervalMs = body.intervalMs as number | undefined;

  if (action === "tick") {
    // Client-driven tick: run one agent on one market and return results
    const actions = await agentLoop.singleTick();
    return Response.json({
      ok: true,
      message: "Tick completed",
      actions,
      status: agentLoop.getStatus(),
    });
  }

  if (action === "start") {
    agentLoop.start(intervalMs);
    return Response.json({
      ok: true,
      message: "Agent loop started",
      status: agentLoop.getStatus(),
    });
  }

  if (action === "stop") {
    agentLoop.stop();
    return Response.json({
      ok: true,
      message: "Agent loop stopped",
      status: agentLoop.getStatus(),
    });
  }

  return Response.json({ error: "Invalid action. Use 'tick', 'start', or 'stop'." }, { status: 400 });
}

export async function GET() {
  const status = agentLoop.getStatus();
  const actions = agentLoop.getActionLog(50);
  return Response.json({ status, actions });
}
