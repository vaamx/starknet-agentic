/**
 * hicecaster markets — Browse prediction markets.
 *
 * Fetches from the hicecaster API or directly from on-chain.
 */

import pc from "picocolors";
import { createSpinner } from "../spinner.js";

interface MarketSummary {
  id: number;
  question: string;
  probability?: number;
  impliedProbYes?: number;
  totalPool?: string;
  status: number | string;
  resolutionTime?: number;
}

export interface MarketsOptions {
  apiUrl: string;
  limit: number;
  status?: string;
}

export async function runMarkets(opts: MarketsOptions): Promise<void> {
  const spinner = createSpinner("Fetching markets");
  spinner.start();

  try {
    const url = new URL("/api/markets", opts.apiUrl);
    url.searchParams.set("limit", opts.limit.toString());
    if (opts.status) url.searchParams.set("status", opts.status);

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`API returned ${res.status}`);

    const data = (await res.json()) as { markets: MarketSummary[] };
    const markets = data.markets;
    spinner.stop("");

    if (markets.length === 0) {
      console.log(pc.dim("No markets found."));
      return;
    }

    const STATUS_MAP: Record<number, string> = { 0: "active", 1: "resolved", 2: "cancelled" };

    // Table header
    console.log(
      pc.bold(
        `  ${"ID".padEnd(5)} ${"Prob".padEnd(7)} ${"Volume".padEnd(14)} ${"Status".padEnd(10)} Question`
      )
    );
    console.log(pc.dim("  " + "─".repeat(78)));

    for (const m of markets) {
      const p = m.probability ?? m.impliedProbYes ?? 0.5;
      const prob = `${(p * 100).toFixed(0)}%`.padEnd(7);
      const poolWei = BigInt(m.totalPool || 0);
      const poolStrk = Number(poolWei) / 1e18;
      const vol = `${poolStrk < 0.01 ? "0" : poolStrk.toFixed(1)} STRK`.padEnd(14);
      const statusStr = typeof m.status === "number" ? (STATUS_MAP[m.status] || String(m.status)) : m.status;
      const status = statusStr.padEnd(10);
      const probColor = p > 0.7 ? pc.green : p < 0.3 ? pc.red : pc.yellow;

      console.log(
        `  ${pc.dim(String(m.id).padEnd(5))} ${probColor(prob)} ${pc.dim(vol)} ${status} ${(m.question || "").slice(0, 45)}`
      );
    }

    console.log();
    console.log(pc.dim(`  ${markets.length} market(s) shown`));
  } catch (err) {
    spinner.stop(pc.red("Failed"));
    console.error(
      pc.red("Failed to fetch markets:"),
      (err as Error).message
    );
    console.log(
      pc.dim(
        "Make sure the hicecaster app is running or set --api-url"
      )
    );
    process.exit(1);
  }
}
