/**
 * hicecaster market <id> — Detailed view of a single prediction market.
 */

import pc from "picocolors";
import { createSpinner } from "../spinner.js";

export interface MarketDetailOptions {
  marketId: string;
  apiUrl: string;
}

interface MarketData {
  id: string;
  question: string;
  address?: string;
  probability?: number;
  impliedProbYes?: number;
  impliedProbNo?: number;
  totalPool?: string | number;
  yesPool?: string | number;
  noPool?: string | number;
  status?: string | number;
  resolutionTime?: number;
  oracle?: string;
  feeBps?: number;
  tradeCount?: number;
  forecasts?: Array<{
    agent: string;
    predictedProb: number;
    brierScore: number;
  }>;
  weightedProb?: number;
}

function probBar(prob: number, width = 30): string {
  const yes = Math.round(prob * width);
  const no = width - yes;
  return pc.green("█".repeat(yes)) + pc.red("█".repeat(no));
}

function formatStrk(weiStr: string | number): string {
  const wei = BigInt(weiStr || 0);
  const strk = Number(wei) / 1e18;
  return strk < 0.01 ? "<0.01" : strk.toFixed(2);
}

function timeUntil(ts: number): string {
  const diff = ts - Math.floor(Date.now() / 1000);
  if (diff < 0) return pc.red("expired");
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

export async function runMarketDetail(opts: MarketDetailOptions): Promise<void> {
  const spinner = createSpinner("Fetching market");
  spinner.start();

  try {
    const res = await fetch(`${opts.apiUrl}/api/markets/${opts.marketId}`);
    if (!res.ok) throw new Error(`Market not found (${res.status})`);

    const body = (await res.json()) as {
      market?: MarketData;
      predictions?: Array<{ agent: string; predictedProb: number; brierScore: number }>;
      weightedProbability?: number;
    };
    const market = body.market || (body as unknown as MarketData);
    if (body.predictions) market.forecasts = body.predictions;
    if (body.weightedProbability != null) market.weightedProb = body.weightedProbability;
    spinner.stop("");

    const prob = market.probability ?? market.impliedProbYes ?? 0.5;
    const probColor = prob > 0.7 ? pc.green : prob < 0.3 ? pc.red : pc.yellow;

    // Header
    console.log(pc.bold(pc.cyan(`  Market #${market.id}`)));
    console.log();
    console.log(`  ${market.question}`);
    console.log();

    // Probability
    const yesLabel = `YES ${(prob * 100).toFixed(0)}%`;
    const noLabel = `NO ${((1 - prob) * 100).toFixed(0)}%`;
    console.log(`  ${probBar(prob)} ${probColor(pc.bold(`${(prob * 100).toFixed(1)}%`))}`);
    console.log(`  ${pc.green(yesLabel)}  ${pc.red(noLabel)}`);
    console.log();

    // Details
    if (market.totalPool) {
      console.log(`  Volume:      ${formatStrk(market.totalPool)} STRK`);
    }
    if (market.yesPool && market.noPool) {
      console.log(
        `  Pools:       ${pc.green(formatStrk(market.yesPool))} YES / ${pc.red(formatStrk(market.noPool))} NO`
      );
    }
    if (market.tradeCount != null) {
      console.log(`  Trades:      ${market.tradeCount}`);
    }
    if (market.status != null) {
      const STATUS_MAP: Record<number, string> = { 0: "active", 1: "resolved", 2: "cancelled" };
      const statusStr = typeof market.status === "number" ? (STATUS_MAP[market.status] || String(market.status)) : market.status;
      const statusColor = statusStr === "active" ? pc.green : statusStr === "resolved" ? pc.cyan : pc.yellow;
      console.log(`  Status:      ${statusColor(statusStr)}`);
    }
    if (market.resolutionTime) {
      console.log(`  Resolves in: ${timeUntil(market.resolutionTime)}`);
    }
    if (market.feeBps != null) {
      console.log(`  Fee:         ${market.feeBps / 100}%`);
    }

    // Weighted consensus
    if (market.weightedProb != null) {
      console.log();
      console.log(
        `  Consensus:   ${probColor(pc.bold(`${(market.weightedProb * 100).toFixed(1)}%`))} (Brier-weighted)`
      );
    }

    // Agent forecasts
    if (market.forecasts && market.forecasts.length > 0) {
      console.log();
      console.log(pc.bold("  Agent Forecasts"));
      console.log(pc.dim("  " + "─".repeat(50)));
      for (const f of market.forecasts) {
        const fProb = `${(f.predictedProb * 100).toFixed(0)}%`.padEnd(6);
        const brier = f.brierScore > 0 ? pc.dim(`(brier: ${f.brierScore.toFixed(3)})`) : "";
        const agentLabel = f.agent.length > 16 ? f.agent.slice(0, 10) + "..." : f.agent;
        console.log(`  ${pc.cyan(agentLabel.padEnd(16))} ${fProb} ${brier}`);
      }
    }

    // Links
    console.log();
    if (market.address) {
      console.log(pc.dim(`  Contract: ${market.address}`));
    }
    if (market.oracle) {
      console.log(pc.dim(`  Oracle:   ${market.oracle.slice(0, 16)}...`));
    }

    // Actions hint
    console.log();
    console.log(pc.dim(`  Forecast: hicecaster forecast ${market.id}`));
    console.log(pc.dim(`  Bet:      hicecaster bet ${market.id} yes --amount 5`));
  } catch (err) {
    spinner.stop(pc.red("Failed"));
    console.error(pc.red("Failed:"), (err as Error).message);
    process.exit(1);
  }
}
