"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const market_reader_1 = require("@/lib/market-reader");
const agent_identity_1 = require("@/lib/agent-identity");
const agent_spawner_1 = require("@/lib/agent-spawner");
async function GET() {
    try {
        // TODO: Read from on-chain AccuracyTracker when deployed
        const leaderboard = (0, market_reader_1.getDemoLeaderboard)();
        const identities = (0, agent_identity_1.getDemoAgentIdentities)();
        const enriched = leaderboard.map((entry) => {
            const identity = identities.get(entry.agent);
            return {
                ...entry,
                identity: identity
                    ? {
                        name: identity.name,
                        agentType: identity.agentType,
                        model: identity.model,
                        reputationScore: identity.reputationScore,
                        feedbackCount: identity.feedbackCount,
                    }
                    : null,
            };
        });
        // Merge in spawned agents so they appear in the leaderboard
        const spawned = agent_spawner_1.agentSpawner.list();
        let nextRank = enriched.length + 1;
        for (const agent of spawned) {
            enriched.push({
                agent: agent.name,
                avgBrier: 0.5, // No predictions yet
                predictionCount: agent.stats.predictions,
                rank: nextRank++,
                identity: {
                    name: agent.name,
                    agentType: agent.persona.agentType,
                    model: agent.persona.model,
                    reputationScore: 0,
                    feedbackCount: 0,
                },
            });
        }
        return server_1.NextResponse.json({ leaderboard: enriched });
    }
    catch (err) {
        return server_1.NextResponse.json({ error: err.message }, { status: 500 });
    }
}
