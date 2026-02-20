import { NextResponse } from "next/server";
import {
  isAgentConfigured,
  getAgentAddress,
  getSignerMode,
  getAllowlistedContracts,
} from "@/lib/starknet-executor";
import { getAgentIdentity } from "@/lib/agent-identity";
import { hasSessionKeyConfigured } from "@/lib/session-policy";
import { config } from "@/lib/config";

export async function GET() {
  const agentAddress = getAgentAddress();
  const agentId = config.AGENT_ID;

  const identity = await getAgentIdentity(agentId);

  return NextResponse.json({
    agentConfigured: isAgentConfigured(),
    agentAddress,
    agentId,
    identity,
    signerMode: getSignerMode(),
    sessionKeyConfigured: hasSessionKeyConfigured(),
    allowlist: getAllowlistedContracts(),
    allowlistAutoAdd: config.AGENT_ALLOWLIST_AUTO_ADD === "true",
    contractsDeployed: process.env.MARKET_FACTORY_ADDRESS !== "0x0",
    anthropicConfigured: !!process.env.ANTHROPIC_API_KEY,
    identityRegistryConfigured: !!process.env.IDENTITY_REGISTRY_ADDRESS,
    reputationRegistryConfigured: !!process.env.REPUTATION_REGISTRY_ADDRESS,
    defiEnabled: config.AGENT_DEFI_ENABLED === "true",
    defiAutoTrade: config.AGENT_DEFI_AUTO_TRADE === "true",
    debateEnabled: config.AGENT_DEBATE_ENABLED === "true",
  });
}
