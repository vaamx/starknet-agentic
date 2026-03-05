"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const starknet_executor_1 = require("@/lib/starknet-executor");
const agent_identity_1 = require("@/lib/agent-identity");
async function GET() {
    const agentAddress = (0, starknet_executor_1.getAgentAddress)();
    const agentId = process.env.AGENT_ID ?? "1";
    // Try to fetch on-chain identity, fall back to demo
    let identity = await (0, agent_identity_1.getAgentIdentity)(agentId);
    if (!identity && agentAddress) {
        const demoIdentities = (0, agent_identity_1.getDemoAgentIdentities)();
        identity = demoIdentities.get(agentAddress) ?? null;
    }
    return server_1.NextResponse.json({
        agentConfigured: (0, starknet_executor_1.isAgentConfigured)(),
        agentAddress,
        agentId,
        identity,
        contractsDeployed: process.env.MARKET_FACTORY_ADDRESS !== "0x0",
        anthropicConfigured: !!process.env.ANTHROPIC_API_KEY,
        identityRegistryConfigured: !!process.env.IDENTITY_REGISTRY_ADDRESS,
        reputationRegistryConfigured: !!process.env.REPUTATION_REGISTRY_ADDRESS,
    });
}
