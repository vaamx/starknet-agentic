"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.POST = POST;
exports.DELETE = DELETE;
const agent_spawner_1 = require("@/lib/agent-spawner");
/**
 * Single Agent endpoint.
 * GET: Agent detail.
 * POST: Control agent (stop/pause/resume).
 * DELETE: Remove agent.
 */
async function GET(_request, { params }) {
    const { id } = await params;
    const agent = agent_spawner_1.agentSpawner.getAgent(id);
    if (!agent) {
        return Response.json({ error: "Agent not found" }, { status: 404 });
    }
    return Response.json({ agent: (0, agent_spawner_1.serializeAgent)(agent) });
}
async function POST(request, { params }) {
    const { id } = await params;
    const body = await request.json();
    const action = body.action;
    const agent = agent_spawner_1.agentSpawner.getAgent(id);
    if (!agent) {
        return Response.json({ error: "Agent not found" }, { status: 404 });
    }
    switch (action) {
        case "stop":
            agent_spawner_1.agentSpawner.stop(id);
            break;
        case "pause":
            agent_spawner_1.agentSpawner.pause(id);
            break;
        case "resume":
            agent_spawner_1.agentSpawner.resume(id);
            break;
        default:
            return Response.json({ error: "Invalid action. Use 'stop', 'pause', or 'resume'." }, { status: 400 });
    }
    return Response.json({
        ok: true,
        agent: (0, agent_spawner_1.serializeAgent)(agent_spawner_1.agentSpawner.getAgent(id)),
    });
}
async function DELETE(_request, { params }) {
    const { id } = await params;
    const agent = agent_spawner_1.agentSpawner.getAgent(id);
    if (!agent) {
        return Response.json({ error: "Agent not found" }, { status: 404 });
    }
    agent_spawner_1.agentSpawner.remove(id);
    return Response.json({ ok: true, message: `Agent "${agent.name}" removed` });
}
