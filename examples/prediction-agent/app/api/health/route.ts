import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { agentLoop } from "@/lib/agent-loop";
import { isAgentConfigured } from "@/lib/starknet-executor";
import { hasSessionKeyConfigured } from "@/lib/session-policy";

export async function GET() {
  try {
    const loop = agentLoop.getStatus();
    const checks = {
      rpcConfigured: !!config.STARKNET_RPC_URL,
      anthropicConfigured: !!process.env.ANTHROPIC_API_KEY,
      agentConfigured: isAgentConfigured(),
      marketFactoryConfigured: config.MARKET_FACTORY_ADDRESS !== "0x0",
      accuracyTrackerConfigured: config.ACCURACY_TRACKER_ADDRESS !== "0x0",
      heartbeatProtected: !!config.HEARTBEAT_SECRET,
      sessionKeyConfigured: hasSessionKeyConfigured(),
      upstashRateLimitEnabled: config.upstashRateLimitEnabled,
    };

    const hardFailures = [
      !checks.rpcConfigured,
      !checks.agentConfigured,
      !checks.marketFactoryConfigured,
      !checks.accuracyTrackerConfigured,
    ].some(Boolean);

    const warningState = [
      !checks.anthropicConfigured,
      !checks.heartbeatProtected,
    ].some(Boolean);

    const status = hardFailures
      ? "unhealthy"
      : warningState
        ? "degraded"
        : "healthy";

    return NextResponse.json({
      ok: status !== "unhealthy",
      status,
      serverTime: new Date().toISOString(),
      network: config.STARKNET_CHAIN_ID,
      checks,
      loop: {
        tickCount: loop.tickCount,
        lastTickAt: loop.lastTickAt,
        activeAgentCount: loop.activeAgentCount,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        status: "unhealthy",
        error: err?.message ?? "Health check failed",
        serverTime: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
