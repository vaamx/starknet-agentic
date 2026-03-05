"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.POST = POST;
const agent_spawner_1 = require("@/lib/agent-spawner");
/**
 * Spawned Agents endpoint.
 * GET: List all spawned agents with stats.
 * POST: Spawn a new custom agent.
 */
async function GET() {
    const agents = agent_spawner_1.agentSpawner.list().map(agent_spawner_1.serializeAgent);
    return Response.json({ agents, count: agents.length });
}
async function POST(request) {
    const body = await request.json();
    const config = {
        name: body.name ?? `Agent-${Date.now().toString(36)}`,
        personaId: body.personaId,
        customSystemPrompt: body.systemPrompt,
        budgetStrk: body.budgetStrk ?? 1000,
        maxBetStrk: body.maxBetStrk ?? 100,
        preferredSources: body.preferredSources,
    };
    if (!config.name || config.name.length < 2) {
        return Response.json({ error: "Agent name must be at least 2 characters" }, { status: 400 });
    }
    const agent = agent_spawner_1.agentSpawner.spawn(config);
    return Response.json({
        ok: true,
        message: `Agent "${agent.name}" spawned`,
        agent: (0, agent_spawner_1.serializeAgent)(agent),
    });
}
