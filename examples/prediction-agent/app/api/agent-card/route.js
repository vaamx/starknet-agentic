"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const agent_identity_1 = require("@/lib/agent-identity");
async function GET(request) {
    try {
        const agentId = process.env.AGENT_ID ?? "1";
        const baseUrl = request.headers.get("x-forwarded-host")
            ? `https://${request.headers.get("x-forwarded-host")}`
            : `http://localhost:${process.env.PORT ?? 3000}`;
        const card = await (0, agent_identity_1.generateAgentCard)(agentId, baseUrl);
        return server_1.NextResponse.json(card, {
            headers: {
                "Cache-Control": "public, max-age=300",
            },
        });
    }
    catch (err) {
        return server_1.NextResponse.json({ error: err.message }, { status: 500 });
    }
}
