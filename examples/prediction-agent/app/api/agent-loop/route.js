"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
exports.GET = GET;
const agent_loop_1 = require("@/lib/agent-loop");
/**
 * Agent Loop control endpoint.
 * POST: Start/stop the autonomous loop.
 * GET: Current loop status + recent action log.
 */
async function POST(request) {
    const body = await request.json();
    const action = body.action;
    const intervalMs = body.intervalMs;
    if (action === "start") {
        agent_loop_1.agentLoop.start(intervalMs);
        return Response.json({
            ok: true,
            message: "Agent loop started",
            status: agent_loop_1.agentLoop.getStatus(),
        });
    }
    if (action === "stop") {
        agent_loop_1.agentLoop.stop();
        return Response.json({
            ok: true,
            message: "Agent loop stopped",
            status: agent_loop_1.agentLoop.getStatus(),
        });
    }
    return Response.json({ error: "Invalid action. Use 'start' or 'stop'." }, { status: 400 });
}
async function GET() {
    const status = agent_loop_1.agentLoop.getStatus();
    const actions = agent_loop_1.agentLoop.getActionLog(50);
    return Response.json({ status, actions });
}
