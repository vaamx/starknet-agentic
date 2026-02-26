/**
 * GET /api/survival — Returns the current survival state as JSON.
 * Used by the SurvivalDashboard component and external agents.
 */

import { getSurvivalState } from "@/lib/survival-engine";
import { agentLoop } from "@/lib/agent-loop";
import { config } from "@/lib/config";

export async function GET() {
  const status = agentLoop.getStatus();
  const survival = await getSurvivalState(status.tickCount);
  const healthyThreshold = Math.max(
    0,
    parseFloat(String(config.SURVIVAL_TIER_HEALTHY ?? "100")) || 100
  );
  const lowThreshold = Math.max(
    0,
    parseFloat(String(config.SURVIVAL_TIER_LOW ?? "10")) || 10
  );
  const criticalThreshold = Math.max(
    0,
    parseFloat(String(config.SURVIVAL_TIER_CRITICAL ?? "0.2")) || 0.2
  );
  const thrivingThreshold = Math.max(
    healthyThreshold,
    parseFloat(String(config.SURVIVAL_TIER_THRIVING ?? "1000")) || 1000
  );
  const targetThreshold =
    survival.tier === "dead" || survival.tier === "critical"
      ? lowThreshold
      : healthyThreshold;
  const topUpToTargetStrk = Math.max(0, targetThreshold - survival.balanceStrk);
  const topUpToHealthyStrk = Math.max(0, healthyThreshold - survival.balanceStrk);
  const network = String(config.STARKNET_CHAIN_ID ?? "SN_SEPOLIA");
  const networkSlug = network === "SN_MAIN" ? "mainnet" : "sepolia";
  const agentAddress = config.AGENT_ADDRESS ?? null;
  const explorerBase =
    networkSlug === "mainnet"
      ? "https://voyager.online"
      : "https://sepolia.voyager.online";
  const explorerUrl = agentAddress ? `${explorerBase}/contract/${agentAddress}` : null;
  const faucetUrl =
    networkSlug === "sepolia" ? "https://starknet-faucet.vercel.app/" : null;

  return new Response(JSON.stringify({
    ...survival,
    agentAddress,
    network,
    explorerUrl,
    faucetUrl,
    thresholds: {
      critical: criticalThreshold,
      low: lowThreshold,
      healthy: healthyThreshold,
      thriving: thrivingThreshold,
    },
    funding: {
      targetThreshold,
      topUpToTargetStrk,
      topUpToHealthyStrk,
      canRunOnChain: survival.tier !== "dead",
    },
  }, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value
  ), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
